"""fal.ai TRELLIS provider.

输入默认就是一张主体清晰的家具图，不做抠图。fal 队列接口是异步：
POST queue.fal.run/<endpoint> -> status_url/response_url -> 轮询完成后拿 GLB。
"""
import base64
import json
import mimetypes
from typing import Any, Optional

import httpx

from .base import Gen3DProvider, Gen3DResult
from ..config import settings


def _to_data_uri(image_path: str) -> str:
    mime = mimetypes.guess_type(image_path)[0] or "image/jpeg"
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return f"data:{mime};base64,{b64}"


def _deep_url(value: Any, keys: tuple[str, ...]) -> Optional[str]:
    if isinstance(value, dict):
        for key in keys:
            nested = value.get(key)
            if isinstance(nested, str) and nested.startswith(("http://", "https://")):
                return nested
        for nested in value.values():
            found = _deep_url(nested, keys)
            if found:
                return found
    if isinstance(value, list):
        for nested in value:
            found = _deep_url(nested, keys)
            if found:
                return found
    return None


class FalTrellisProvider(Gen3DProvider):
    name = "fal"

    def __init__(self) -> None:
        endpoint = settings.FAL_TRELLIS_ENDPOINT.strip("/")
        self._submit_url = f"https://queue.fal.run/{endpoint}"
        self._headers = {
            "Authorization": f"Key {settings.FAL_KEY}",
            "Content-Type": "application/json",
        }

    async def submit(self, image_path: str, *, texture: bool = True, prompt: str = "",
                     extra_image_paths: list[str] | None = None) -> str:
        payload: dict[str, Any] = {
            "ss_sampling_steps": settings.TRELLIS_SS_STEPS,
            "slat_sampling_steps": settings.TRELLIS_SLAT_STEPS,
            "mesh_simplify": settings.TRELLIS_MESH_SIMPLIFY,
            "texture_size": settings.TRELLIS_TEXTURE_SIZE,
        }
        image_paths = [image_path, *(extra_image_paths or [])]
        if len(image_paths) > 1:
            payload["image_urls"] = [_to_data_uri(path) for path in image_paths]
            payload["multiimage_algo"] = settings.TRELLIS_MULTIIMAGE_ALGO
        else:
            payload["image_url"] = _to_data_uri(image_path)
        if prompt:
            payload["prompt"] = prompt
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            r = await client.post(self._submit_url, headers=self._headers, json=payload)
            r.raise_for_status()
            data = r.json()
        return json.dumps({
            "request_id": data.get("request_id"),
            "status_url": data.get("status_url"),
            "response_url": data.get("response_url"),
        })

    async def poll(self, provider_job_id: str) -> Gen3DResult:
        ref = json.loads(provider_job_id)
        status_url = ref.get("status_url")
        response_url = ref.get("response_url")
        if not status_url or not response_url:
            return Gen3DResult(status="failed", error="fal response missing status_url/response_url")

        async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
            s = await client.get(status_url, headers=self._headers)
            s.raise_for_status()
            status_payload = s.json()

            raw_status = str(status_payload.get("status", "")).upper()
            if raw_status == "COMPLETED":
                r = await client.get(response_url, headers=self._headers)
                r.raise_for_status()
                result = r.json()
                model_url = _deep_url(result, ("model_url", "model", "glb", "url"))
                thumbnail_url = _deep_url(result, ("thumbnail_url", "image_url", "preview_url"))
                return Gen3DResult(
                    status="succeeded" if model_url else "failed",
                    progress=100,
                    model_url=model_url,
                    thumbnail_url=thumbnail_url,
                    error=None if model_url else "fal result missing model url",
                    raw=result,
                )

        if raw_status in {"FAILED", "ERROR", "CANCELLED"}:
            return Gen3DResult(status="failed", progress=0, error=raw_status, raw=status_payload)
        progress = 8 if raw_status in {"IN_QUEUE", "QUEUED"} else 55
        return Gen3DResult(status="running", progress=progress, raw=status_payload)
