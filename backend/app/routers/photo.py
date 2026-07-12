"""能力2：拍照 → 3D。

线下逛店拍一张主体清晰的家具照 → 直接生成 3D。
这里不做抠图：调用方保证传进来的图已经有明确主体。
"""
import json
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form
from ..schemas import SubmitResponse
from ..utils import save_upload
from ..store import create_job

router = APIRouter(prefix="/api/photo-to-3d", tags=["photo"])


@router.post("", response_model=SubmitResponse)
async def photo_to_3d(
    file: UploadFile = File(..., description="家具照片"),
    bbox: Optional[str] = Form(None, description="保留兼容字段；当前不做抠图"),
    texture: bool = Form(True),
    meta: Optional[str] = Form(None),
):
    photo_path = await save_upload(file, "photo")
    meta_dict = json.loads(meta) if meta else {}
    job = create_job("photo", photo_path, texture=texture, meta=meta_dict)
    return SubmitResponse(job_id=job.job_id, status=job.status)
