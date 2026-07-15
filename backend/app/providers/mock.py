"""Mock provider：不调外网，本地假进度 + 返回一个内置示例 GLB。

作用：让整条链路(上传→分割→生成→轮询→前端渲染)在没有任何 API key、
甚至在没有外发权限的监管机上也能端到端跑通、录 demo。
真跑时把 GEN3D_PROVIDER 换成 tripo/meshy 即可，前端零改动。
"""
import time
from typing import Dict
from .base import Gen3DProvider, Gen3DResult
from ..config import settings

# 内置示例 GLB(backend/samples,随仓库分发)。不用境外 URL——评委/联调都在国内。
_SAMPLE_GLB = f"{settings.PUBLIC_BASE_URL}/samples/Duck.glb"


class MockProvider(Gen3DProvider):
    name = "mock"

    def __init__(self) -> None:
        # provider_job_id -> 起始时间戳，用于模拟进度
        self._jobs: Dict[str, float] = {}

    async def submit(self, image_path: str, *, texture: bool = True, prompt: str = "") -> str:
        job_id = f"mock-{int(time.time() * 1000)}"
        self._jobs[job_id] = time.time()
        return job_id

    async def poll(self, provider_job_id: str) -> Gen3DResult:
        started = self._jobs.get(provider_job_id)
        if started is None:
            return Gen3DResult(status="failed", error="unknown mock job")
        elapsed = time.time() - started
        # 模拟：4 秒内线性进度，之后完成
        if elapsed < 4:
            return Gen3DResult(status="running", progress=min(95, int(elapsed / 4 * 100)))
        return Gen3DResult(
            status="succeeded",
            progress=100,
            model_url=_SAMPLE_GLB,
            thumbnail_url=None,
        )
