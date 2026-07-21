"""SAM2 追踪客户端:上传视频+种子框 → GPU 全帧传播 → 轨迹+mask抠图向量。

带内容哈希缓存(视频+种子指纹),重跑零成本。
"""
import asyncio
import hashlib
import json
import os

import httpx

from ..config import settings


async def sam2_track(video_path: str, seeds: list[dict]) -> dict | None:
    """seeds: [{obj_id, t, bbox}] → {objects: [{obj_id, merged_from, frames, embedding}]}
    失败/未配置返回 None(pipeline 回退 IoU 轨迹)。"""
    if not settings.REMOTE_GPU_URL:
        return None
    from . import cache
    seed_sig = hashlib.md5(json.dumps(seeds, sort_keys=True).encode()).hexdigest()[:12]
    key = cache.content_key(video_path, extra=f"sam2track|{seed_sig}")
    hit = cache.get("sam2track", key)
    if hit:
        return hit["result"]
    try:
        async with httpx.AsyncClient(timeout=180, trust_env=False) as client:
            with open(video_path, "rb") as f:
                r = await client.post(f"{settings.REMOTE_GPU_URL}/track",
                                      files={"file": ("v.mp4", f, "video/mp4")},
                                      data={"seeds": json.dumps(seeds)})
            r.raise_for_status()
            job_id = r.json()["job_id"]
            print(f"      SAM2 任务 {job_id}")
            last_progress = ""
            # 僵死判定:进度多久不动才算死(总时长不设限——大视频传播 2h+ 是正常的)
            stall_max = int(os.environ.get("SAM2_STALL_MIN", "20")) * 12
            stall = 0
            while stall < stall_max:
                await asyncio.sleep(5)
                s = await client.get(f"{settings.REMOTE_GPU_URL}/track/{job_id}")
                s.raise_for_status()
                data = s.json()
                if data.get("progress") and data["progress"] != last_progress:
                    last_progress = data["progress"]
                    stall = 0
                    print(f"      SAM2 {last_progress}")
                else:
                    stall += 1
                if data["status"] == "succeeded":
                    cache.put("sam2track", key, {"result": data["result"]})
                    return data["result"]
                if data["status"] == "failed":
                    print(f"      ⚠️ SAM2 失败({data.get('error','')[:120]}),回退 IoU 轨迹")
                    return None
            print(f"      ⚠️ SAM2 僵死(进度 {stall_max*5//60} 分钟未动),回退 IoU 轨迹")
    except Exception as e:  # noqa: BLE001
        print(f"      ⚠️ SAM2 不可用({type(e).__name__}),回退 IoU 轨迹")
    return None
