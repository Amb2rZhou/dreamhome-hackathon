"""Meshy API provider（稳妥备选，文档最好、image-to-3D + PBR）。

Meshy 接受图片 URL 或 base64 data URI；这里用 data URI，省得先把图片传上公网。
文档：https://docs.meshy.ai
"""
import base64
import mimetypes
import httpx
from .base import Gen3DProvider, Gen3DResult
from ..config import settings

_STATUS_MAP = {
    "PENDING": "queued",
    "IN_PROGRESS": "running",
    "SUCCEEDED": "succeeded",
    "FAILED": "failed",
    "EXPIRED": "failed",
}


def _to_data_uri(image_path: str) -> str:
    mime = mimetypes.guess_type(image_path)[0] or "image/jpeg"
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return f"data:{mime};base64,{b64}"


class MeshyProvider(Gen3DProvider):
    name = "meshy"

    def __init__(self) -> None:
        self._headers = {"Authorization": f"Bearer {settings.MESHY_API_KEY}"}
        self._base = settings.MESHY_BASE_URL.rstrip("/")

    async def submit(self, image_path: str, *, texture: bool = True, prompt: str = "") -> str:
        payload = {
            "image_url": _to_data_uri(image_path),
            "enable_pbr": texture,
            "should_texture": texture,
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{self._base}/image-to-3d", headers=self._headers, json=payload)
            r.raise_for_status()
            return r.json()["result"]

    async def poll(self, provider_job_id: str) -> Gen3DResult:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{self._base}/image-to-3d/{provider_job_id}", headers=self._headers)
            r.raise_for_status()
            data = r.json()
        status = _STATUS_MAP.get(data.get("status", "IN_PROGRESS"), "running")
        model_url = (data.get("model_urls") or {}).get("glb")
        return Gen3DResult(
            status=status,
            progress=int(data.get("progress", 0)),
            model_url=model_url if status == "succeeded" else None,
            thumbnail_url=data.get("thumbnail_url"),
            error=(data.get("task_error") or {}).get("message") if status == "failed" else None,
            raw=data,
        )
