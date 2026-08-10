"""能力2：拍照 → 3D。

线下逛店拍一张主体清晰的家具照 → 直接生成 3D。
这里不做抠图：调用方保证传进来的图已经有明确主体。
"""
import json
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel, Field
from .. import db
from ..schemas import SubmitResponse, JobStatus
from ..utils import save_upload
from ..store import create_job, get_job

router = APIRouter(prefix="/api/photo-to-3d", tags=["photo"])


class PhotoAssetCommitRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=120)
    name: str = Field(default="拍摄生成的家具", max_length=80)
    category: str = Field(min_length=1, max_length=40)
    styles: list[str] = Field(default_factory=list, max_length=2)
    materials: list[str] = Field(default_factory=list, max_length=8)
    colors: list[str] = Field(default_factory=list, max_length=8)


class PhotoAssetCommitResponse(BaseModel):
    asset_id: str
    library_attached: bool
    asset: dict


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


@router.post("/{job_id}/commit", response_model=PhotoAssetCommitResponse)
async def commit_photo_asset(job_id: str, req: PhotoAssetCommitRequest):
    """Promote one successful raw photo job into one canonical private asset.

    The endpoint is idempotent per job so refresh/retry never clones a model.
    Size remains unknown unless the provider actually returned an estimate.
    """
    existing = db.get_photo_asset_commit(job_id)
    if existing:
        if existing["user_id"] != req.user_id:
            raise HTTPException(status_code=409, detail="photo job already belongs to another user")
        asset = db.get_asset(existing["asset_id"])
        if not asset:
            raise HTTPException(status_code=409, detail="committed photo asset is missing")
        db.library_add(req.user_id, [asset["asset_id"]], "offline_photo", {
            "source_type": "offline_photo", "job_id": job_id,
        })
        return PhotoAssetCommitResponse(asset_id=asset["asset_id"], library_attached=True, asset=asset)

    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if job.kind != "photo":
        raise HTTPException(status_code=409, detail="job is not a photo generation")
    if job.status != JobStatus.succeeded or not job.model_url:
        raise HTTPException(status_code=409, detail="photo generation is not ready")

    detected = job.labels or {}
    styles = list(dict.fromkeys(value.strip() for value in (req.styles or detected.get("styles", [])) if value.strip()))[:2]
    materials = list(dict.fromkeys(value.strip() for value in (req.materials or detected.get("materials", [])) if value.strip()))
    colors = list(dict.fromkeys(value.strip() for value in (req.colors or detected.get("colors", [])) if value.strip()))
    if not styles:
        raise HTTPException(status_code=422, detail="at least one style tag is required")
    if not materials:
        materials = [job.material or "待确认材质"]
    size_prior = None
    if job.estimated_size_m and len(job.estimated_size_m) == 3:
        w, d, h = [float(value) for value in job.estimated_size_m]
        size_prior = {"w": w, "h": h, "d": d}
    asset_id = db.insert_asset(
        name=req.name.strip() or "拍摄生成的家具",
        labels={
            "category": req.category,
            "styles": styles,
            "materials": materials,
            "colors": colors,
            "features": detected.get("features", []),
            "size_class": detected.get("size_class", "") if size_prior is None else "已估算",
            "mount": detected.get("mount", "floor"),
        },
        size_prior=size_prior,
        glb_url=job.model_url,
        thumb_url=job.thumbnail_url or "",
        source={
            "source_type": "offline_photo",
            "job_id": job_id,
            "pipeline": "photo-to-3d",
            "pipeline_status": "ready",
        },
        status="ready",
        job_id=job_id,
        created_by="photo_capture_commit",
    )
    try:
        db.insert_photo_asset_commit(job_id, asset_id, req.user_id)
    except Exception:
        # A simultaneous retry may have won the idempotency race.
        committed = db.get_photo_asset_commit(job_id)
        if not committed:
            raise
        db.update_asset(asset_id, status="rejected")
        asset_id = committed["asset_id"]
    attached = db.library_add(req.user_id, [asset_id], "offline_photo", {
        "source_type": "offline_photo", "job_id": job_id,
    }) > 0
    asset = db.get_asset(asset_id)
    return PhotoAssetCommitResponse(asset_id=asset_id, library_attached=attached, asset=asset or {})
