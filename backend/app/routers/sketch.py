"""能力3(其一)：画画 → 3D。

画板导出的线稿 PNG → 洗干净(二值化去纸底) → 生成 3D。
"""
import json
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form
from ..schemas import SubmitResponse
from ..utils import save_upload, workpath
from ..services.sketch import clean_sketch
from ..store import create_job

router = APIRouter(prefix="/api/sketch-to-3d", tags=["sketch"])


@router.post("", response_model=SubmitResponse)
async def sketch_to_3d(
    file: UploadFile = File(..., description="手绘线稿 PNG"),
    texture: bool = Form(True),
    meta: Optional[str] = Form(None),
):
    sketch_path = await save_upload(file, "sketch")
    clean_path = clean_sketch(sketch_path, workpath("sketch-clean", ".png"))
    meta_dict = json.loads(meta) if meta else {}
    job = create_job("sketch", clean_path, texture=texture, meta=meta_dict)
    return SubmitResponse(job_id=job.job_id, status=job.status)
