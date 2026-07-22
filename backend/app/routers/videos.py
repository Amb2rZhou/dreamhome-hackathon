"""视频与暂停交互：整包索引 / 实时检测(lazy 写回) / 圈选(标签匹配→确认)。

判定"有没有人圈过"= 查 track 标注(确定性)；标签匹配只出建议给用户确认。
"""
import base64
import json
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .. import db, matching
from ..schemas_lib import (DetectBox, DetectResponse, MatchCandidate, SelectConfirmRequest,
                           SelectConfirmResponse, SelectRequest, SelectResponse,
                           VideoIndex, VideoOut)
from ..services.detect import detect_frame
from ..services.labels import extract_labels
from ..services.selection_production import production_readiness, start_selection_production
from ..store import create_job
from ..utils import workpath

router = APIRouter(prefix="/api/videos", tags=["videos"])

# 圈选会话：select → 用户看候选 → confirm。demo 用内存，生产换 Redis。
_SELECTS: dict[str, dict] = {}

# 1x1 灰色 PNG：mock/无截帧时充当生成输入占位
_PLACEHOLDER_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoaGj4DwAFhAKAkzqgqgAAAABJRU5ErkJggg=="
)


class VideoCreate(BaseModel):
    title: str = ""
    source_url: str = ""
    play_url: str = ""
    cover_url: str = ""
    duration: float = 0


@router.get("", response_model=list[VideoOut])
async def list_videos():
    return db.list_videos()


@router.post("", response_model=VideoOut)
async def create_video(req: VideoCreate):
    """登记一个视频(素材收集/离线 pipeline 用)。"""
    vid = db.insert_video(**req.model_dump())
    return db.get_video(vid)


@router.get("/{video_id}", response_model=VideoOut)
async def get_video(video_id: str):
    v = db.get_video(video_id)
    if not v:
        raise HTTPException(404, "video not found")
    return v


@router.get("/{video_id}/index", response_model=VideoIndex)
async def video_index(video_id: str):
    """整包时空索引：前端加载视频时取一次，暂停本地按 t 查表，零请求。"""
    v = db.get_video(video_id)
    if not v:
        raise HTTPException(404, "video not found")
    return VideoIndex(video_id=video_id, status=v["status"], tracks=db.tracks_of_video(video_id))


def _bbox_at(track: dict, t: float, tol: float = 0.5) -> Optional[list]:
    """track 在 t 时刻的 bbox(取 tol 秒内最近的采样帧)。"""
    best, best_dt = None, tol
    for f in track["frames"]:
        dt = abs(f["t"] - t)
        if dt <= best_dt:
            best, best_dt = f["bbox"], dt
    return best


def _iou(a: list, b: list) -> float:
    ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    ix = max(0.0, min(ax2, bx2) - max(a[0], b[0]))
    iy = max(0.0, min(ay2, by2) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


class DetectRequest(BaseModel):
    t: float
    frame_data_uri: Optional[str] = None
    dry: bool = False   # true=只识别不写索引(演示页暂停校正用,防碎轨迹污染)


@router.post("/{video_id}/detect", response_model=DetectResponse)
async def detect(video_id: str, req: DetectRequest):
    """未索引视频的暂停识别：单帧检测 → 对齐已有 track(IoU) → 新框 lazy 写回索引。"""
    v = db.get_video(video_id)
    if not v:
        raise HTTPException(404, "video not found")

    raw_boxes = await detect_frame(video_id, req.t, req.frame_data_uri)
    tracks = db.tracks_of_video(video_id)
    out = []
    for rb in raw_boxes:
        hit_track, hit_iou = None, 0.3   # IoU>0.3 视为同一物体，不重复建 track
        for tr in tracks:
            tb = _bbox_at(tr, req.t)
            if tb and _iou(rb["bbox"], tb) > hit_iou:
                hit_track, hit_iou = tr, _iou(rb["bbox"], tb)
        if hit_track:
            out.append(DetectBox(**rb, track_id=hit_track["track_id"],
                                 asset_id=hit_track["asset_id"]))
        elif req.dry:
            out.append(DetectBox(**rb, track_id="", asset_id=None))
        else:
            tid = db.insert_track(video_id, rb["category"], [{"t": req.t, "bbox": rb["bbox"]}],
                                  t_start=req.t, t_end=req.t, best_frame_t=req.t)
            out.append(DetectBox(**rb, track_id=tid, asset_id=None))
    if v["status"] == "unindexed":
        db.set_video_status(video_id, "unindexed", index_source="lazy")
    return DetectResponse(video_id=video_id, t=req.t, boxes=out,
                          provider="mock" if not req.frame_data_uri else "auto")


def _validate_bbox(bbox: list[float]) -> list[float]:
    if len(bbox) != 4:
        raise HTTPException(422, "bbox must contain normalized x, y, width, height")
    x, y, w, h = (float(value) for value in bbox)
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > 1.0001 or y + h > 1.0001:
        raise HTTPException(422, "bbox must be inside normalized frame coordinates")
    return [max(0.0, x), max(0.0, y), min(1.0 - x, w), min(1.0 - y, h)]


async def _parse_select_request(request: Request) -> tuple[SelectRequest, Optional[bytes]]:
    """Accept the legacy JSON contract and the preferred multipart frame upload."""
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        frame = form.get("frame")
        if frame is None or not hasattr(frame, "read"):
            for value in form.values():
                if hasattr(value, "close"):
                    await value.close()
            raise HTTPException(422, "multipart selection requires frame JPEG")
        try:
            frame_bytes = await frame.read()
            req = SelectRequest(
                t=float(form.get("t", "0")),
                bbox=json.loads(str(form.get("bbox", "[]"))),
                polygon=json.loads(str(form.get("polygon", "[]"))),
                frame_width=int(str(form.get("frame_width"))) if form.get("frame_width") else None,
                frame_height=int(str(form.get("frame_height"))) if form.get("frame_height") else None,
                category_hint=str(form.get("category_hint", "")),
                track_id=str(form.get("track_id")) if form.get("track_id") else None,
            )
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(422, f"invalid multipart selection: {exc}") from exc
        finally:
            if hasattr(frame, "close"):
                await frame.close()
        if not frame_bytes:
            raise HTTPException(422, "uploaded frame is empty")
        return req, frame_bytes

    try:
        return SelectRequest.model_validate(await request.json()), None
    except Exception as exc:
        raise HTTPException(422, f"invalid selection payload: {exc}") from exc


def _save_selection_images(frame_data_uri: Optional[str], frame_bytes: Optional[bytes],
                           bbox: list[float]) -> tuple[str, str, tuple[int, int]]:
    """Persist the untouched RGB frame and derive a bbox crop for labels/generation."""
    raw = frame_bytes
    if raw is None and frame_data_uri and "," in frame_data_uri:
        try:
            raw = base64.b64decode(frame_data_uri.split(",", 1)[1])
        except Exception:
            raw = None

    frame_path = workpath("select-frame", ".jpg")
    crop_path = workpath("select-crop", ".jpg")
    if raw:
        try:
            from io import BytesIO
            from PIL import Image
            img = Image.open(BytesIO(raw)).convert("RGB")
            width, height = img.size
            x, y, w, h = _validate_bbox(bbox)
            left = max(0, min(width - 1, round(x * width)))
            top = max(0, min(height - 1, round(y * height)))
            right = max(left + 1, min(width, round((x + w) * width)))
            bottom = max(top + 1, min(height, round((y + h) * height)))
            img.save(frame_path, format="JPEG", quality=92, optimize=True)
            img.crop((left, top, right, bottom)).save(crop_path, format="JPEG", quality=92, optimize=True)
            return frame_path, crop_path, (width, height)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(422, f"invalid uploaded frame: {exc}") from exc

    # Legacy JSON callers may omit a frame. Keep their old placeholder behavior,
    # while multipart callers above always require a real full frame.
    with open(frame_path, "wb") as file:
        file.write(_PLACEHOLDER_PNG)
    with open(crop_path, "wb") as file:
        file.write(_PLACEHOLDER_PNG)
    return frame_path, crop_path, (1, 1)


@router.post("/{video_id}/select", response_model=SelectResponse)
async def select(video_id: str, request: Request):
    """圈选：原始完整帧 + 选择几何 → 原图裁切 → 标签/同款候选。"""
    if not db.get_video(video_id):
        raise HTTPException(404, "video not found")
    req, frame_bytes = await _parse_select_request(request)
    req.bbox = _validate_bbox(req.bbox)
    frame_path, source_crop, frame_size = _save_selection_images(
        req.frame_data_uri, frame_bytes, req.bbox,
    )
    if req.frame_width is not None and req.frame_width != frame_size[0]:
        raise HTTPException(422, "frame_width does not match uploaded frame")
    if req.frame_height is not None and req.frame_height != frame_size[1]:
        raise HTTPException(422, "frame_height does not match uploaded frame")
    labels = await extract_labels(source_crop, category_hint=req.category_hint)
    cands = []
    for c in matching.match_candidates(labels):
        asset = db.get_asset(c["asset_id"])
        if asset:
            cands.append(MatchCandidate(asset=asset, score=c["score"], reason=c["reason"]))
    sid = uuid.uuid4().hex
    _SELECTS[sid] = {"video_id": video_id, "t": req.t, "bbox": req.bbox,
                     "polygon": req.polygon, "labels": labels,
                     "frame": frame_path, "frame_size": frame_size,
                     "source_crop": source_crop, "track_id": req.track_id,
                     "has_source_frame": frame_bytes is not None or bool(req.frame_data_uri),
                     "created": time.time()}
    return SelectResponse(select_id=sid, labels=labels, candidates=cands)


@router.post("/{video_id}/select/confirm", response_model=SelectConfirmResponse)
async def select_confirm(video_id: str, req: SelectConfirmRequest):
    """确认圈选结果：复用同款，或选择 fast/production 生成新资产。"""
    sel = _SELECTS.get(req.select_id)
    if not sel or sel["video_id"] != video_id:
        raise HTTPException(404, "select session not found (expired?)")

    if req.use_asset_id and req.generate_new:
        raise HTTPException(400, "use_asset_id and generate_new are mutually exclusive")
    if req.quality_mode == "production" and not req.generate_new:
        raise HTTPException(400, "quality_mode=production requires generate_new=true")
    if req.use_asset_id and not db.get_asset(req.use_asset_id):
        raise HTTPException(404, "asset not found")
    if req.quality_mode == "production" and not sel.get("has_source_frame"):
        raise HTTPException(422, "production mode requires a valid frame_data_uri in /select")
    if req.quality_mode == "production":
        readiness = production_readiness()
        if not readiness["ready"]:
            raise HTTPException(503, {"message": "production pipeline is not ready",
                                      "capability": readiness})

    _SELECTS.pop(req.select_id, None)

    track_id = sel.get("track_id") if sel.get("track_id") and db.get_track(sel["track_id"]) else None
    if not track_id:
        track_id = db.insert_track(video_id, sel["labels"].get("category", ""),
                                   [{"t": sel["t"], "bbox": sel["bbox"]}],
                                   t_start=sel["t"], t_end=sel["t"], best_frame_t=sel["t"])

    if req.use_asset_id:
        db.bind_track_asset(track_id, req.use_asset_id)
        return SelectConfirmResponse(asset_id=req.use_asset_id, track_id=track_id,
                                     quality_mode="reuse")

    if not req.generate_new:
        raise HTTPException(400, "either use_asset_id or generate_new=true")

    if req.quality_mode == "production":
        asset_id, job = start_selection_production(
            video_id=video_id,
            track_id=track_id,
            t=sel["t"],
            bbox=sel["bbox"],
            cutout_path=sel["source_crop"],
            labels=sel["labels"],
            user_id=req.user_id,
        )
        return SelectConfirmResponse(
            asset_id=asset_id,
            job_id=job.job_id,
            track_id=track_id,
            quality_mode="production",
            library_attached=False,
        )

    job = create_job("video", sel["source_crop"], meta={"category": sel["labels"].get("category")})
    asset_id = db.insert_asset(
        name=sel["labels"].get("sub") or sel["labels"].get("category", "新资产"),
        labels=sel["labels"], thumb_url="",
        source={"video_id": video_id, "track_id": track_id, "t_best": sel["t"]},
        status="generating", job_id=job.job_id, created_by="user",
    )
    db.bind_track_asset(track_id, asset_id)
    return SelectConfirmResponse(asset_id=asset_id, job_id=job.job_id, track_id=track_id,
                                 quality_mode="fast")
