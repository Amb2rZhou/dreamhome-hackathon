"""视频与暂停交互：整包索引 / 实时检测(lazy 写回) / 圈选(标签匹配→确认)。

判定"有没有人圈过"= 查 track 标注(确定性)；标签匹配只出建议给用户确认。
"""
import base64
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db, matching
from ..schemas_lib import (DetectBox, DetectResponse, MatchCandidate, SelectConfirmRequest,
                           SelectConfirmResponse, SelectRequest, SelectResponse,
                           VideoIndex, VideoOut)
from ..services.detect import detect_frame
from ..services.labels import extract_labels
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


def _save_cutout(frame_data_uri: Optional[str], bbox: list) -> str:
    """截帧裁出圈选区域；无截帧/无 PIL 时落占位图，保证链路不断。"""
    path = workpath("select", ".png")
    if frame_data_uri and "," in frame_data_uri:
        try:
            raw = base64.b64decode(frame_data_uri.split(",", 1)[1])
            from io import BytesIO
            from PIL import Image
            img = Image.open(BytesIO(raw)).convert("RGB")
            W, H = img.size
            x, y, w, h = bbox
            img.crop((int(x * W), int(y * H), int((x + w) * W), int((y + h) * H))).save(path)
            return path
        except Exception:
            pass
    with open(path, "wb") as f:
        f.write(_PLACEHOLDER_PNG)
    return path


@router.post("/{video_id}/select", response_model=SelectResponse)
async def select(video_id: str, req: SelectRequest):
    """圈选：抠图 → 提标签(与入库同一 schema) → 库内标签匹配 → 返候选给用户确认。"""
    if not db.get_video(video_id):
        raise HTTPException(404, "video not found")
    cutout = _save_cutout(req.frame_data_uri, req.bbox)
    labels = await extract_labels(cutout, category_hint=req.category_hint)
    cands = []
    for c in matching.match_candidates(labels):
        asset = db.get_asset(c["asset_id"])
        if asset:
            cands.append(MatchCandidate(asset=asset, score=c["score"], reason=c["reason"]))
    sid = uuid.uuid4().hex
    _SELECTS[sid] = {"video_id": video_id, "t": req.t, "bbox": req.bbox,
                     "labels": labels, "cutout": cutout, "track_id": req.track_id,
                     "created": time.time()}
    return SelectResponse(select_id=sid, labels=labels, candidates=cands)


@router.post("/{video_id}/select/confirm", response_model=SelectConfirmResponse)
async def select_confirm(video_id: str, req: SelectConfirmRequest):
    """确认圈选结果：挂现有资产(不重新生成)，或生成新资产。"""
    sel = _SELECTS.pop(req.select_id, None)
    if not sel or sel["video_id"] != video_id:
        raise HTTPException(404, "select session not found (expired?)")

    track_id = sel.get("track_id") if sel.get("track_id") and db.get_track(sel["track_id"]) else None
    if not track_id:
        track_id = db.insert_track(video_id, sel["labels"].get("category", ""),
                                   [{"t": sel["t"], "bbox": sel["bbox"]}],
                                   t_start=sel["t"], t_end=sel["t"], best_frame_t=sel["t"])

    if req.use_asset_id:
        if not db.get_asset(req.use_asset_id):
            raise HTTPException(404, "asset not found")
        db.bind_track_asset(track_id, req.use_asset_id)
        return SelectConfirmResponse(asset_id=req.use_asset_id, track_id=track_id)

    if not req.generate_new:
        raise HTTPException(400, "either use_asset_id or generate_new=true")

    job = create_job("video", sel["cutout"], meta={"category": sel["labels"].get("category")})
    asset_id = db.insert_asset(
        name=sel["labels"].get("sub") or sel["labels"].get("category", "新资产"),
        labels=sel["labels"], thumb_url="",
        source={"video_id": video_id, "track_id": track_id, "t_best": sel["t"]},
        status="generating", job_id=job.job_id, created_by="user",
    )
    db.bind_track_asset(track_id, asset_id)
    return SelectConfirmResponse(asset_id=asset_id, job_id=job.job_id, track_id=track_id)
