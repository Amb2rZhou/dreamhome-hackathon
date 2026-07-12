"""能力1：视频 → 3D。

暂停视频得到一段短视频/或整段 → 抽最清晰主体帧 → 直接生成 3D。
这里不做抠图；bbox 只用于从视频帧里裁出用户圈选区域。
"""
import json
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form
from ..schemas import SubmitResponse
from ..utils import save_upload, workpath
from ..services.frames import extract_best_frame
from ..store import create_job

router = APIRouter(prefix="/api/video-to-3d", tags=["video"])


def _parse_bbox(bbox: Optional[str]):
    if not bbox:
        return None
    try:
        x, y, w, h = (int(v) for v in bbox.split(","))
        return (x, y, w, h)
    except Exception:
        return None


@router.post("", response_model=SubmitResponse)
async def video_to_3d(
    file: UploadFile = File(..., description="短视频或视频片段"),
    bbox: Optional[str] = Form(None, description="圈选区域 x,y,w,h"),
    texture: bool = Form(True),
    meta: Optional[str] = Form(None, description="识别卡片 JSON(category/style...)"),
):
    video_path = await save_upload(file, "video")
    box = _parse_bbox(bbox)
    frame_path = extract_best_frame(video_path, workpath("frame", ".jpg"), bbox=box)
    meta_dict = json.loads(meta) if meta else {}
    job = create_job("video", frame_path, texture=texture, meta=meta_dict)
    return SubmitResponse(job_id=job.job_id, status=job.status)
