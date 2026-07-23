"""内存 job store + 后台轮询。demo 够用；生产换 Redis/DB + 独立 worker。

一次生成的生命周期：
create_job() 建 Job → 起 asyncio 后台任务 _run() → submit 给 provider →
循环 poll 更新 progress/status → 落地 model 信息。前端只管轮询 get_job()。
"""
import asyncio
import uuid
from typing import Dict, Optional
from .schemas import Job, JobStatus
from .providers import get_provider

_JOBS: Dict[str, Job] = {}


def get_job(job_id: str) -> Optional[Job]:
    return _JOBS.get(job_id)


def create_job(kind: str, image_path: str, *, texture: bool = True,
               meta: Optional[dict] = None) -> Job:
    """建任务并在后台开始生成。meta 可带识别出的 category/style 等。"""
    provider = get_provider()
    job = Job(
        job_id=uuid.uuid4().hex,
        kind=kind,               # video | photo | sketch
        status=JobStatus.queued,
        provider=provider.name,
        **(meta or {}),
    )
    _JOBS[job.job_id] = job
    asyncio.create_task(_run(job, image_path, texture))
    return job


async def _run(job: Job, image_path: str, texture: bool) -> None:
    provider = get_provider()
    try:
        src = image_path
        if job.kind == "photo":
            # 拍一张：进 TRELLIS 前走 单体化→补全→单体闸→一致性闸(与离线管线同一 SOP)。
            # ENHANCE_PROVIDER=off 时内部直接返回原图，行为与接入前一致。
            from .services.prepare import prepare_photo
            src, prep = await prepare_photo(image_path, category=job.category or "")
            if prep.get("prepped"):
                print(f"[photo {job.job_id[:8]}] 预处理: {prep}")
        pjid = await provider.submit(src, texture=texture)
        job.provider_job_id = pjid
        job.status = JobStatus.running
        # 轮询直到终态，最多 ~5 分钟
        for _ in range(150):
            await asyncio.sleep(2)
            res = await provider.poll(pjid)
            job.progress = res.progress
            if res.status == "succeeded":
                job.status = JobStatus.succeeded
                job.model_url = res.model_url
                job.thumbnail_url = res.thumbnail_url or job.thumbnail_url
                return
            if res.status == "failed":
                job.status = JobStatus.failed
                job.error = res.error or "generation failed"
                return
            job.status = JobStatus.running
        job.status = JobStatus.failed
        job.error = "timeout"
    except Exception as e:  # 网络/权限/解码等
        job.status = JobStatus.failed
        job.error = f"{type(e).__name__}: {e}"
