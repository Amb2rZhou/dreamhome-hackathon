"""实时单帧检测：暂停帧 → 家具 bbox 列表。

provider:
- remote：自部署 GPU 推理服务(gpu/server.py，Grounding DINO)，demo 时段启用
- mock：确定性伪检测(同一 video_id+t 永远返回同样的框)，本地联调用

检测结果由调用方(videos router)写回 track 索引缓存(lazy indexing)。
"""
import hashlib
from typing import Optional

import httpx

from ..config import settings

_CATEGORIES = ["沙发", "单椅", "柜子", "灯具", "绿植"]


async def detect_frame(video_id: str, t: float,
                       frame_data_uri: Optional[str] = None) -> list[dict]:
    """返回 [{bbox:[x,y,w,h], category, score}]，bbox 归一化。"""
    if settings.effective_detect_provider == "remote":
        return await _remote(frame_data_uri, video_id, t)
    return _mock(video_id, t)


async def _remote(frame_data_uri: Optional[str], video_id: str, t: float) -> list[dict]:
    payload = {"video_id": video_id, "t": t, "frame_data_uri": frame_data_uri}
    # trust_env=False: GPU 机直连,不走本机系统代理
    async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
        r = await client.post(f"{settings.REMOTE_GPU_URL.rstrip('/')}/detect", json=payload)
        r.raise_for_status()
        return r.json().get("boxes", [])


def _mock(video_id: str, t: float) -> list[dict]:
    """伪检测：由 (video_id, 取整秒) 哈希出 2-4 个稳定的框。
    取整秒 → 同一秒内暂停结果一致，模拟"该帧的确定性检测结果"。
    """
    seed = hashlib.md5(f"{video_id}:{int(t)}".encode()).digest()
    n = 2 + seed[0] % 3
    boxes = []
    for i in range(n):
        b = seed[i * 4:(i + 1) * 4]
        x = 0.05 + (b[0] / 255) * 0.55
        y = 0.10 + (b[1] / 255) * 0.45
        w = 0.15 + (b[2] / 255) * 0.25
        h = 0.15 + (b[3] / 255) * 0.30
        boxes.append({
            "bbox": [round(x, 3), round(y, 3), round(min(w, 0.98 - x), 3), round(min(h, 0.98 - y), 3)],
            "category": _CATEGORIES[b[0] % len(_CATEGORIES)],
            "score": round(0.6 + (b[1] / 255) * 0.35, 2),
        })
    return boxes
