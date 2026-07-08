"""Tripo API provider（demo 首选，~30s 级、默认带 PBR 贴图）。

流程：上传图片拿 file_token → 建 image_to_model 任务 → 轮询 task。
文档：https://platform.tripo3d.ai/docs
"""
import os
import httpx
from .base import Gen3DProvider, Gen3DResult
from ..config import settings

_STATUS_MAP = {
    "queued": "queued",
    "running": "running",
    "success": "succeeded",
    "failed": "failed",
    "cancelled": "failed",
    "unknown": "running",
    "banned": "failed",
    "expired": "failed",
}


class TripoProvider(Gen3DProvider):
    name = "tripo"

    def __init__(self) -> None:
        self._headers = {"Authorization": f"Bearer {settings.TRIPO_API_KEY}"}
        self._base = settings.TRIPO_BASE_URL.rstrip("/")

    async def submit(self, image_path: str, *, texture: bool = True, prompt: str = "") -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            # 1) 上传图片
            ext = os.path.splitext(image_path)[1].lstrip(".").lower() or "jpg"
            with open(image_path, "rb") as f:
                files = {"file": (os.path.basename(image_path), f, f"image/{ext}")}
                up = await client.post(f"{self._base}/upload", headers=self._headers, files=files)
            up.raise_for_status()
            file_token = up.json()["data"]["image_token"]

            # 2) 建任务
            payload = {
                "type": "image_to_model",
                "file": {"type": ext, "file_token": file_token},
                "texture": texture,
                "pbr": texture,
            }
            if prompt:
                payload["model_seed"] = 0  # 占位，保留将来传 prompt 的扩展位
            task = await client.post(f"{self._base}/task", headers=self._headers, json=payload)
            task.raise_for_status()
            return task.json()["data"]["task_id"]

    async def poll(self, provider_job_id: str) -> Gen3DResult:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{self._base}/task/{provider_job_id}", headers=self._headers)
            r.raise_for_status()
            data = r.json()["data"]
        status = _STATUS_MAP.get(data.get("status", "unknown"), "running")
        output = data.get("output", {}) or {}
        model_url = output.get("pbr_model") or output.get("model")
        return Gen3DResult(
            status=status,
            progress=int(data.get("progress", 0)),
            model_url=model_url if status == "succeeded" else None,
            thumbnail_url=output.get("rendered_image"),
            error=None if status != "failed" else str(data.get("status")),
            raw=data,
        )
