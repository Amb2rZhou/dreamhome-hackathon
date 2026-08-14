"""视频与暂停交互：整包索引 / 实时检测(lazy 写回) / 圈选(标签匹配→确认)。

判定"有没有人圈过"= 查 track 标注(确定性)；标签匹配只出建议给用户确认。
"""
import base64
import json
import math
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .. import db, matching
from ..config import settings
from ..schemas_lib import (DetectBox, DetectResponse, MatchCandidate, SelectConfirmRequest,
                           SelectConfirmResponse, SelectRequest, SelectResponse,
                           VideoIndex, VideoOut)
from .frame_assets import find_exact_asset
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


def _selection_document(select_id: str, selection: dict) -> dict:
    document = dict(selection)
    document["select_id"] = select_id
    if isinstance(document.get("frame_size"), tuple):
        document["frame_size"] = list(document["frame_size"])
    if document.get("completion_path"):
        document["completion_path"] = [list(point) for point in document["completion_path"]]
    return document


def _persist_selection(
    select_id: str,
    selection: dict,
    *,
    status: str = "ready",
    error: str = "",
) -> None:
    db.upsert_selection_session(
        select_id,
        selection["video_id"],
        _selection_document(select_id, selection),
        user_id=selection.get("user_id", ""),
        status=status,
        error=error,
    )


def _load_selection(select_id: str) -> Optional[dict]:
    selection = _SELECTS.get(select_id)
    if selection:
        return selection
    stored = db.get_selection_session(select_id)
    if not stored:
        return None
    selection = stored["document"]
    if selection.get("frame_size"):
        selection["frame_size"] = tuple(selection["frame_size"])
    if selection.get("completion_path"):
        selection["completion_path"] = [tuple(point) for point in selection["completion_path"]]
    _SELECTS[select_id] = selection
    return selection


def _storage_url(path: str) -> str:
    if not path:
        return ""
    try:
        relative = Path(path).resolve().relative_to(Path(settings.STORAGE_DIR).resolve())
    except (ValueError, OSError):
        return ""
    return f"{settings.PUBLIC_BASE_URL.rstrip('/')}/storage/{relative.as_posix()}"


def _selection_task_payload(stored: dict) -> dict:
    document = stored["document"]
    status = stored["status"]
    error = stored["error"]
    job_id = document.get("job_id")
    generation_status = None
    if job_id:
        generation = db.get_generation_job(job_id)
        if generation:
            generation_status = generation["job"].get("status")
            if generation_status == "failed":
                error = generation["job"].get("error") or error
                status = "rejected" if _is_terminal_selection_error(error) else "retryable"
            elif generation_status == "succeeded":
                status = "completed"
    return {
        "select_id": stored["select_id"],
        "video_id": stored["video_id"],
        "status": status,
        "error": error,
        "created_at": stored["created_at"],
        "updated_at": stored["updated_at"],
        "t": document.get("t", 0),
        "bbox": document.get("bbox", []),
        "polygon": document.get("polygon", []),
        "labels": document.get("labels", {}),
        "candidates": document.get("candidates", []),
        "exact_match": document.get("exact_match"),
        "client_task_id": document.get("client_task_id", ""),
        "preview_url": _storage_url(document.get("source_crop", "")),
        "job_id": job_id,
        "asset_id": document.get("asset_id"),
        "track_id": document.get("track_id"),
        "generation_status": generation_status,
    }


def _is_terminal_selection_error(error: str) -> bool:
    """Errors that cannot improve by resubmitting the same crop."""
    normalized = (error or "").lower()
    return any(marker in normalized for marker in (
        "input_qc:",
        "single_object_qc:",
        "identity_qc:",
        "selection touches multiple frame edges",
        "category is unsupported",
        "specialist/planar asset path",
    ))


def _select_response_from_stored(stored: dict) -> SelectResponse:
    document = stored["document"]
    return SelectResponse(
        select_id=stored["select_id"],
        labels=document.get("labels") or {},
        candidates=document.get("candidates") or [],
        exact_match=document.get("exact_match"),
    )


@router.get("/selection-tasks")
async def list_selection_tasks(user_id: str):
    """Return durable, user-scoped lasso tasks for workshop refresh recovery."""
    if not user_id.strip():
        raise HTTPException(422, "user_id is required")
    tasks = [
        _selection_task_payload(stored)
        for stored in db.list_selection_sessions(user_id.strip())
    ]
    return [task for task in tasks if task["status"] != "completed"]


@router.get("/selection-tasks/{select_id}")
async def get_selection_task(select_id: str, user_id: str):
    if not user_id.strip():
        raise HTTPException(422, "user_id is required")
    stored = db.get_selection_session(select_id)
    if not stored or stored["user_id"] != user_id.strip():
        raise HTTPException(404, "selection task not found")
    return _selection_task_payload(stored)


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
                user_id=str(form.get("user_id", "")),
                client_task_id=str(form.get("client_task_id", "")),
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


def _normalized_polygon(polygon: list[list[float]]) -> Optional[list[tuple[float, float]]]:
    """Return a safe normalized polygon, or None for legacy bbox-only callers."""
    points: list[tuple[float, float]] = []
    for point in polygon:
        if len(point) != 2:
            return None
        try:
            x, y = float(point[0]), float(point[1])
        except (TypeError, ValueError):
            return None
        if not math.isfinite(x) or not math.isfinite(y):
            return None
        points.append((max(0.0, min(1.0, x)), max(0.0, min(1.0, y))))
    return points if len(set(points)) >= 3 else None


def _save_selection_images(frame_data_uri: Optional[str], frame_bytes: Optional[bytes],
                           bbox: list[float], polygon: list[list[float]]) -> tuple[
                               str, str, str, tuple[int, int], str, list[tuple[int, int]]
                           ]:
    """Persist the full frame plus context-rich recognition/completion inputs.

    The browser cutout is a presentation artifact only. Production completion
    needs the target's surrounding scene to infer category, occlusion and
    physical structure, so the backend keeps a 2.5x context crop and carries
    the user's polygon as a selection hint instead of erasing everything
    outside the lasso.
    """
    raw = frame_bytes
    if raw is None and frame_data_uri and "," in frame_data_uri:
        try:
            raw = base64.b64decode(frame_data_uri.split(",", 1)[1])
        except Exception:
            raw = None

    frame_path = workpath("select-frame", ".jpg")
    context_path = workpath("select-context", ".jpg")
    recognition_path = workpath("select-recognition", ".jpg")
    if raw:
        try:
            from io import BytesIO
            from PIL import Image, ImageDraw
            img = Image.open(BytesIO(raw)).convert("RGB")
            width, height = img.size
            x, y, w, h = _validate_bbox(bbox)
            left = max(0, min(width - 1, round(x * width)))
            top = max(0, min(height - 1, round(y * height)))
            right = max(left + 1, min(width, round((x + w) * width)))
            bottom = max(top + 1, min(height, round((y + h) * height)))
            img.save(frame_path, format="JPEG", quality=92, optimize=True)
            safe_polygon = _normalized_polygon(polygon)
            pad_x = (right - left) * 0.75
            pad_y = (bottom - top) * 0.75
            context_left = max(0, round(left - pad_x))
            context_top = max(0, round(top - pad_y))
            context_right = min(width, round(right + pad_x))
            context_bottom = min(height, round(bottom + pad_y))
            context = img.crop((context_left, context_top, context_right, context_bottom))
            context.save(context_path, format="JPEG", quality=92, optimize=True)

            local_points: list[tuple[int, int]] = []
            isolation_mode = "bbox_context"
            recognition = context.copy()
            draw = ImageDraw.Draw(recognition)
            line_width = max(2, round(min(recognition.size) * 0.008))
            if safe_polygon:
                local_points = [
                    (round(point_x * width - context_left),
                     round(point_y * height - context_top))
                    for point_x, point_y in safe_polygon
                ]
                draw.line(local_points + [local_points[0]], fill=(255, 0, 0),
                          width=line_width, joint="curve")
                isolation_mode = "polygon_context"
            else:
                draw.rectangle(
                    [left - context_left, top - context_top,
                     right - context_left, bottom - context_top],
                    outline=(255, 0, 0), width=line_width,
                )
            recognition.save(recognition_path, format="JPEG", quality=90, optimize=True)
            return (frame_path, context_path, recognition_path, (width, height),
                    isolation_mode, local_points)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(422, f"invalid uploaded frame: {exc}") from exc

    # Legacy JSON callers may omit a frame. Keep their old placeholder behavior,
    # while multipart callers above always require a real full frame.
    with open(frame_path, "wb") as file:
        file.write(_PLACEHOLDER_PNG)
    with open(context_path, "wb") as file:
        file.write(_PLACEHOLDER_PNG)
    with open(recognition_path, "wb") as file:
        file.write(_PLACEHOLDER_PNG)
    return frame_path, context_path, recognition_path, (1, 1), "placeholder", []


@router.post("/{video_id}/select", response_model=SelectResponse)
async def select(video_id: str, request: Request):
    """圈选：原始完整帧 + 选择几何 → 上下文识别 → 同款候选。"""
    req, frame_bytes = await _parse_select_request(request)
    existing = db.get_selection_session_by_client_task(
        req.user_id.strip(), req.client_task_id.strip(),
    )
    if existing:
        if existing["video_id"] != video_id:
            raise HTTPException(409, "client task is already bound to another video")
        return _select_response_from_stored(existing)
    has_source_frame = frame_bytes is not None or bool(req.frame_data_uri)
    if not db.get_video(video_id):
        if not has_source_frame:
            raise HTTPException(404, "video not found")
        # 刷一刷可能使用尚未进入离线索引的公开视频。完整帧已随请求到达时，
        # 可以安全登记为 interactive source，后续资产仍保留该 video_id 溯源。
        db.insert_video(video_id=video_id, title="刷一刷圈选",
                        status="unindexed", index_source="interactive")
    req.bbox = _validate_bbox(req.bbox)

    # A bound track/manual annotation is object identity, not fuzzy similarity.
    # Resolve it before image processing/provider calls.  The confirm endpoint
    # also enforces this result, so an older client that blindly asks to
    # generate cannot accidentally create a duplicate.
    exact = find_exact_asset(video_id, req.t, req.bbox, req.track_id)
    if exact:
        asset = exact["asset"]
        (frame_path, source_context, recognition_context, frame_size,
         isolation_mode, completion_path) = _save_selection_images(
            req.frame_data_uri, frame_bytes, req.bbox, req.polygon,
        )
        if req.frame_width is not None and req.frame_width != frame_size[0]:
            raise HTTPException(422, "frame_width does not match uploaded frame")
        if req.frame_height is not None and req.frame_height != frame_size[1]:
            raise HTTPException(422, "frame_height does not match uploaded frame")
        reason = "当前轨迹已有 3D" if exact["source"] == "track" else "当前圈选已生成 3D"
        candidate = MatchCandidate(asset=asset, score=1.0, reason=reason)
        sid = uuid.uuid4().hex
        _SELECTS[sid] = {
            "video_id": video_id,
            "t": req.t,
            "bbox": req.bbox,
            "polygon": req.polygon,
            "labels": asset.get("labels") or {},
            "track_id": exact.get("track_id"),
            "exact_asset_id": asset["asset_id"],
            "frame": frame_path,
            "frame_size": frame_size,
            "source_crop": source_context,
            "recognition_context": recognition_context,
            "completion_path": completion_path,
            "isolation_mode": isolation_mode,
            "category_hint": req.category_hint,
            "has_source_frame": has_source_frame,
            "user_id": req.user_id,
            "client_task_id": req.client_task_id,
            "candidates": [candidate.model_dump(mode="json")],
            "exact_match": candidate.model_dump(mode="json"),
            "created": time.time(),
        }
        _persist_selection(sid, _SELECTS[sid])
        return SelectResponse(
            select_id=sid,
            labels=asset.get("labels") or {},
            candidates=[candidate],
            exact_match=candidate,
        )

    (frame_path, source_context, recognition_context, frame_size,
     isolation_mode, completion_path) = _save_selection_images(
        req.frame_data_uri, frame_bytes, req.bbox, req.polygon,
    )
    if req.frame_width is not None and req.frame_width != frame_size[0]:
        raise HTTPException(422, "frame_width does not match uploaded frame")
    if req.frame_height is not None and req.frame_height != frame_size[1]:
        raise HTTPException(422, "frame_height does not match uploaded frame")
    try:
        labels = await extract_labels(
            recognition_context,
            category_hint=req.category_hint,
            framed=True,
            strict=bool(req.polygon and has_source_frame),
        )
    except RuntimeError as exc:
        raise HTTPException(503, f"production labels unavailable: {exc}") from exc
    cands = []
    for c in matching.match_candidates(labels):
        asset = db.get_asset(c["asset_id"])
        if asset:
            cands.append(MatchCandidate(asset=asset, score=c["score"], reason=c["reason"]))
    sid = uuid.uuid4().hex
    _SELECTS[sid] = {"video_id": video_id, "t": req.t, "bbox": req.bbox,
                     "polygon": req.polygon, "labels": labels,
                     "frame": frame_path, "frame_size": frame_size,
                     "source_crop": source_context,
                     "recognition_context": recognition_context,
                     "completion_path": completion_path,
                     "isolation_mode": isolation_mode,
                     "track_id": req.track_id,
                     "has_source_frame": has_source_frame,
                     "user_id": req.user_id,
                     "client_task_id": req.client_task_id,
                     "candidates": [candidate.model_dump(mode="json") for candidate in cands],
                     "exact_match": None,
                     "created": time.time()}
    _persist_selection(sid, _SELECTS[sid])
    return SelectResponse(select_id=sid, labels=labels, candidates=cands)


@router.post("/{video_id}/select/confirm", response_model=SelectConfirmResponse)
async def select_confirm(video_id: str, req: SelectConfirmRequest):
    """确认圈选结果：复用同款，或选择 fast/production 生成新资产。"""
    sel = _load_selection(req.select_id)
    if not sel or sel["video_id"] != video_id:
        raise HTTPException(404, "select session not found (expired?)")
    if req.user_id:
        sel["user_id"] = req.user_id
        _persist_selection(req.select_id, sel)

    # Confirmation is idempotent. Once a production job has been accepted,
    # every repeated click/request returns that same canonical asset and job.
    # It must never enqueue a second paid generation for the same selection.
    if sel.get("job_id") and sel.get("asset_id") and sel.get("track_id"):
        return SelectConfirmResponse(
            asset_id=sel["asset_id"],
            job_id=sel["job_id"],
            track_id=sel["track_id"],
            quality_mode="production",
            library_attached=False,
        )

    if req.use_asset_id and req.generate_new:
        raise HTTPException(400, "use_asset_id and generate_new are mutually exclusive")
    if req.reject_matched_asset and not req.generate_new:
        raise HTTPException(400, "reject_matched_asset requires generate_new=true")

    exact_asset_id = sel.get("exact_asset_id")
    if exact_asset_id and not req.reject_matched_asset:
        exact_asset = db.get_asset(exact_asset_id)
        if not exact_asset or exact_asset.get("status") != "ready":
            raise HTTPException(409, "previously matched asset is no longer ready; select again")
        if req.use_asset_id and req.use_asset_id != exact_asset_id:
            raise HTTPException(409, "selection is already bound to a different ready asset")
        if req.use_asset_id or req.generate_new:
            _SELECTS.pop(req.select_id, None)
            selected_track = db.get_track(sel["track_id"]) if sel.get("track_id") else None
            track_id = (sel["track_id"] if selected_track
                        and selected_track.get("video_id") == video_id else None)
            if not track_id:
                track_id = db.insert_track(
                    video_id, sel["labels"].get("category", ""),
                    [{"t": sel["t"], "bbox": sel["bbox"]}],
                    t_start=sel["t"], t_end=sel["t"], best_frame_t=sel["t"],
                )
            db.bind_track_asset(
                track_id,
                exact_asset_id,
                binding_review_status="approved",
                binding_source="user_confirmed_reuse",
            )
            library_attached = False
            if req.user_id:
                db.library_add(req.user_id, [exact_asset_id], "video_selection_reuse", {
                    "video_id": video_id,
                    "track_id": track_id,
                    "t": sel["t"],
                })
                library_attached = True
            _persist_selection(req.select_id, {
                **sel, "asset_id": exact_asset_id, "track_id": track_id,
            }, status="reused")
            return SelectConfirmResponse(
                asset_id=exact_asset_id,
                track_id=track_id,
                quality_mode="reuse",
                library_attached=library_attached,
            )
    elif exact_asset_id and req.reject_matched_asset:
        # The user inspected the matched GLB and explicitly said it is not the
        # selected object. Re-label the current frame instead of inheriting the
        # rejected asset's metadata, then run the full production quality path.
        try:
            sel["labels"] = await extract_labels(
                sel.get("recognition_context"),
                category_hint=sel.get("category_hint") or "",
                framed=True,
                strict=True,
            )
        except RuntimeError as exc:
            raise HTTPException(503, f"production labels unavailable: {exc}") from exc
    if req.quality_mode == "production" and not req.generate_new:
        raise HTTPException(400, "quality_mode=production requires generate_new=true")
    if req.use_asset_id:
        reuse_asset = db.get_asset(req.use_asset_id)
        if not reuse_asset:
            raise HTTPException(404, "asset not found")
        if reuse_asset.get("status") != "ready":
            raise HTTPException(409, "only ready canonical assets can be reused")
    if req.quality_mode == "production" and not sel.get("has_source_frame"):
        raise HTTPException(422, "production mode requires a valid full frame in /select")
    if req.quality_mode == "production" and sel.get("isolation_mode") != "polygon_context":
        raise HTTPException(422, "production mode requires a valid polygon selection")
    if req.quality_mode == "production":
        readiness = production_readiness()
        if not readiness["ready"]:
            raise HTTPException(503, {"message": "production pipeline is not ready",
                                      "capability": readiness})

    selected_track = db.get_track(sel["track_id"]) if sel.get("track_id") else None
    track_id = (sel["track_id"] if selected_track
                and selected_track.get("video_id") == video_id else None)
    if not track_id:
        track_id = db.insert_track(video_id, sel["labels"].get("category", ""),
                                   [{"t": sel["t"], "bbox": sel["bbox"]}],
                                   t_start=sel["t"], t_end=sel["t"], best_frame_t=sel["t"])
    sel["track_id"] = track_id
    _persist_selection(req.select_id, sel)

    if req.use_asset_id:
        db.bind_track_asset(
            track_id,
            req.use_asset_id,
            binding_review_status="approved",
            binding_source="user_confirmed_reuse",
        )
        _SELECTS.pop(req.select_id, None)
        library_attached = False
        if req.user_id:
            db.library_add(req.user_id, [req.use_asset_id], "video_selection_reuse", {
                "video_id": video_id,
                "track_id": track_id,
                "t": sel["t"],
            })
            library_attached = True
        _persist_selection(req.select_id, {
            **sel, "asset_id": req.use_asset_id, "track_id": track_id,
        }, status="reused")
        return SelectConfirmResponse(asset_id=req.use_asset_id, track_id=track_id,
                                     quality_mode="reuse",
                                     library_attached=library_attached)

    if not req.generate_new:
        raise HTTPException(400, "either use_asset_id or generate_new=true")

    if req.quality_mode == "production":
        try:
            asset_id, job = start_selection_production(
                video_id=video_id,
                track_id=track_id,
                t=sel["t"],
                bbox=sel["bbox"],
                polygon=sel["polygon"],
                isolation_mode=sel["isolation_mode"],
                cutout_path=sel["source_crop"],
                identity_reference_path=sel.get("recognition_context"),
                labels=sel["labels"],
                user_id=req.user_id,
                completion_path=sel.get("completion_path") or [],
            )
        except Exception as exc:
            _persist_selection(req.select_id, sel, status="retryable", error=str(exc))
            raise HTTPException(503, f"selection production submission failed: {exc}") from exc
        # Do not consume the selection until the production job is accepted.
        # This keeps transient queue/provider failures safely retryable.
        _SELECTS.pop(req.select_id, None)
        _persist_selection(req.select_id, {
            **sel, "asset_id": asset_id, "job_id": job.job_id, "track_id": track_id,
        }, status="submitted")
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
    db.bind_track_asset(track_id, asset_id, binding_source="generated_asset")
    _SELECTS.pop(req.select_id, None)
    _persist_selection(req.select_id, {
        **sel, "asset_id": asset_id, "job_id": job.job_id, "track_id": track_id,
    }, status="submitted")
    return SelectConfirmResponse(asset_id=asset_id, job_id=job.job_id, track_id=track_id,
                                 quality_mode="fast")
