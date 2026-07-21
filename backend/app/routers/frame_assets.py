"""帧级资产识别:给定视频时刻 t,返回该帧画面里已生成的资产(含 bbox),
以及圈选 bbox 与同刻已有资产的 IoU 对比 —— 供 rebuild 页面画绿框/圈选去重用。

数据源两路:
1. tracks 表:绑定了 asset 的轨迹,在 frames_json([{t,bbox}])里取 |t-frame.t|<=0.75 内最近帧,source="track"
2. storage/annotations/{vid}.json:status=="generated" 的手动标注(bbox 固定),source="annotation"
资产信息从 assets 表联查,只出 status=ready 的。
"""
import json
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .. import db

router = APIRouter(prefix="/api/videos", tags=["frame_assets"])

ANN_DIR = Path(__file__).resolve().parents[2] / "storage" / "annotations"

_VID_RE = re.compile(r"^vid_[0-9a-f]+$")

T_TOL = 0.75          # 时间窗:|t - 数据点.t| <= 0.75s 视为该刻出现
IOU_THRESHOLD = 0.35  # 圈选与已有资产 bbox 的 IoU 超过即判定"同一件"


def _check_vid(video_id: str) -> None:
    if not _VID_RE.match(video_id):
        raise HTTPException(400, "bad video_id")


def _iou(a: list[float], b: list[float]) -> float:
    """两个归一化 [x,y,w,h] 框的交并比。"""
    ax1, ay1, ax2, ay2 = a[0], a[1], a[0] + a[2], a[1] + a[3]
    bx1, by1, bx2, by2 = b[0], b[1], b[0] + b[2], b[1] + b[3]
    iw = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    ih = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = iw * ih
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def _asset_item(asset_id: str, bbox: list[float], source: str,
                cache: dict[str, Optional[dict]]) -> Optional[dict]:
    """联查 assets 表拼出返回条目;非 ready / 不存在的资产返回 None(带查询缓存)。"""
    if asset_id not in cache:
        cache[asset_id] = db.get_asset(asset_id)
    a = cache[asset_id]
    if not a or a.get("status") != "ready":
        return None
    return {
        "asset_id": asset_id,
        "name": a.get("name", ""),
        "bbox": [round(v, 4) for v in bbox],
        "source": source,
        "status": a["status"],
        "glb_url": a.get("glb_url", ""),
        "thumb_url": a.get("thumb_url", ""),
    }


def _assets_at(video_id: str, t: float) -> list[dict]:
    """t 时刻画面里的已生成资产列表;同一 asset 多路命中时保留 |dt| 最小的一条。"""
    # asset_id -> (|dt|, item),用于去重
    best: dict[str, tuple[float, dict]] = {}
    cache: dict[str, Optional[dict]] = {}

    # 数据源一:tracks 表,绑定了 asset 的轨迹按最近帧取 bbox
    for trk in db.tracks_of_video(video_id):
        if not trk.get("asset_id"):
            continue
        near = None  # (|dt|, bbox)
        for f in trk.get("frames", []):
            dt = abs(t - f.get("t", 0.0))
            bbox = f.get("bbox")
            if dt <= T_TOL and bbox and (near is None or dt < near[0]):
                near = (dt, bbox)
        if near is None:
            continue
        item = _asset_item(trk["asset_id"], near[1], "track", cache)
        if item and (item["asset_id"] not in best or near[0] < best[item["asset_id"]][0]):
            best[item["asset_id"]] = (near[0], item)

    # 数据源二:手动标注里已 generated 的条目(bbox 固定不随时间动)
    ann_path = ANN_DIR / f"{video_id}.json"
    if ann_path.exists():
        try:
            doc = json.loads(ann_path.read_text())
        except (json.JSONDecodeError, OSError):
            doc = {}
        for it in doc.get("items", []):
            if it.get("status") != "generated" or not it.get("asset_id"):
                continue
            dt = abs(t - it.get("t", 0.0))
            if dt > T_TOL or not it.get("bbox"):
                continue
            item = _asset_item(it["asset_id"], it["bbox"], "annotation", cache)
            if item and (item["asset_id"] not in best or dt < best[item["asset_id"]][0]):
                best[item["asset_id"]] = (dt, item)

    # 按时间贴近程度排序,最贴近当前帧的排前面
    return [item for _, item in sorted(best.values(), key=lambda x: x[0])]


@router.get("/{video_id}/assets_at")
def assets_at(video_id: str, t: float = Query(..., ge=0.0)):
    """t 时刻画面里已生成的资产(track 插值 bbox + 手动标注 bbox)。"""
    _check_vid(video_id)
    if not db.get_video(video_id):
        raise HTTPException(404, "video not found")
    return {"items": _assets_at(video_id, t)}


class MatchIn(BaseModel):
    t: float                  # 圈选所在视频时刻(秒)
    bbox: list[float]         # 归一化 [x, y, w, h]


@router.post("/{video_id}/match_annotation")
def match_annotation(video_id: str, body: MatchIn):
    """圈选去重:拿圈选框和同刻已有资产逐个算 IoU,>0.35 取最大者命中。"""
    _check_vid(video_id)
    if not db.get_video(video_id):
        raise HTTPException(404, "video not found")
    if len(body.bbox) != 4 or body.bbox[2] <= 0 or body.bbox[3] <= 0:
        raise HTTPException(400, "bad bbox, expect normalized [x,y,w,h]")

    best_item, best_iou = None, 0.0
    for item in _assets_at(video_id, body.t):
        v = _iou(body.bbox, item["bbox"])
        if v > best_iou:
            best_item, best_iou = item, v

    matched = best_item if best_iou > IOU_THRESHOLD else None
    return {"matched": matched, "iou": round(best_iou, 4)}
