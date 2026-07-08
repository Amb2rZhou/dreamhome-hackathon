"""能力2：拍照 → 3D。

线下逛店拍一张(或几张)家具照 → 抠图去背景 → 生成 3D。
支持传 bbox(用户在照片上框出目标)，不传则整图抠主体。
"""
import json
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form
from ..schemas import SubmitResponse
from ..utils import save_upload, workpath
from ..services.segment import isolate_object
from ..store import create_job

router = APIRouter(prefix="/api/photo-to-3d", tags=["photo"])


@router.post("", response_model=SubmitResponse)
async def photo_to_3d(
    file: UploadFile = File(..., description="家具照片"),
    bbox: Optional[str] = Form(None, description="框选目标 x,y,w,h"),
    texture: bool = Form(True),
    meta: Optional[str] = Form(None),
):
    photo_path = await save_upload(file, "photo")
    box = None
    if bbox:
        try:
            x, y, w, h = (int(v) for v in bbox.split(","))
            box = (x, y, w, h)
        except Exception:
            box = None
    clean_path = isolate_object(photo_path, workpath("seg", ".png"), bbox=box)
    meta_dict = json.loads(meta) if meta else {}
    job = create_job("photo", clean_path, texture=texture, meta=meta_dict)
    return SubmitResponse(job_id=job.job_id, status=job.status)
