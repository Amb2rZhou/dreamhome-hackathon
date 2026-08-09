"""自部署 TRELLIS provider:调 GPU 云服务器上的 gpu/server.py。

fal 实测 $0.1+/张后改走自部署(docs/cost-evaluation.md v2)。
成功后把 GLB 拉回本机 storage 下发——模型文件从自己服务端出,不依赖外网 CDN。
"""
import base64
import mimetypes
import os
import uuid

import httpx

from .base import Gen3DProvider, Gen3DResult
from ..config import settings


class SelfhostTrellisProvider(Gen3DProvider):
    name = "selfhost"

    def __init__(self) -> None:
        self._base = settings.GEN3D_REMOTE_URL.rstrip("/")
        self._files_base = settings.GEN3D_FILES_URL.rstrip("/")

    async def submit(self, image_path: str, *, texture: bool = True, prompt: str = "",
                     extra_image_paths: list[str] | None = None) -> str:
        def to_uri(p: str) -> str:
            mime = mimetypes.guess_type(p)[0] or "image/jpeg"
            with open(p, "rb") as f:
                return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"

        uris = [to_uri(image_path)] + [to_uri(p) for p in (extra_image_paths or [])]
        # trust_env=False: GPU 机直连,不走本机系统代理(macOS 会读系统级代理设置)
        async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
            r = await client.post(f"{self._base}/gen3d", json={"image_data_uris": uris})
            r.raise_for_status()
        return r.json()["job_id"]

    async def poll(self, provider_job_id: str) -> Gen3DResult:
        async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
            r = await client.get(f"{self._base}/gen3d/{provider_job_id}")
            if r.status_code == 404:
                return Gen3DResult(status="failed", error="gpu job not found")
            r.raise_for_status()
            data = r.json()

            if data["status"] == "succeeded":
                # 拉回本机 storage,前端从自己服务端取 GLB
                glb_url = f"{self._files_base}{data['glb_path']}"
                local = os.path.join(os.path.abspath(settings.STORAGE_DIR),
                                     "models", f"{uuid.uuid4().hex}.glb")
                os.makedirs(os.path.dirname(local), exist_ok=True)
                dl = await client.get(glb_url, timeout=120)
                dl.raise_for_status()
                with open(local, "wb") as f:
                    f.write(dl.content)
                rel = os.path.relpath(local, os.path.abspath(settings.STORAGE_DIR))
                return Gen3DResult(status="succeeded", progress=100,
                                   model_url=f"{settings.PUBLIC_BASE_URL}/storage/{rel}")

        if data["status"] == "failed":
            return Gen3DResult(status="failed", error=data.get("error") or "gen failed")
        progress = 10 if data["status"] == "queued" else 55
        return Gen3DResult(status="running", progress=progress)
