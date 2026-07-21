"""轨迹手动矫正 API：解绑(整条/时段) / 换绑 / 切断。

配套前端 /review/fix.html（矫正工作台，见 docs/sop-manual-fix.md）。
只改 tracks 表的 asset_id / frames_json / 时间字段，不写 assets 表，
量产批次进程可并行跑，互不干扰。
"""
import json
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db

router = APIRouter(prefix="/api/tracks", tags=["tracks-fix"])


# ---------- 内部工具 ----------

def _get_or_404(track_id: str) -> dict:
    tr = db.get_track(track_id)
    if not tr:
        raise HTTPException(404, "track not found")
    return tr


def _sorted_frames(tr: dict) -> list[dict]:
    """按 t 升序的帧列表（真实数据已有序，这里防御性再排一次）。"""
    return sorted(tr["frames"], key=lambda f: f["t"])


def _clamp_best_t(frames: list[dict], old_best: float) -> float:
    """best_frame_t 若已不在剩余帧覆盖范围内，吸附到最近的剩余帧时刻。"""
    ts = [f["t"] for f in frames]
    if ts and min(ts) <= old_best <= max(ts):
        return old_best
    return min(ts, key=lambda x: abs(x - old_best)) if ts else old_best


def _write_frames(track_id: str, frames: list[dict], best_t: float) -> None:
    """回写帧列表并同步 t_start/t_end/best_frame_t（frames 必须非空有序）。"""
    db._exec(
        "UPDATE tracks SET frames_json=?, t_start=?, t_end=?, best_frame_t=? WHERE track_id=?",
        (json.dumps(frames), frames[0]["t"], frames[-1]["t"], best_t, track_id),
    )


def _summary(track_id: str, extra: Optional[dict] = None) -> dict:
    """修改后的 track 概要（不回传大体积 frames 本体）。"""
    r = db.get_track(track_id)
    if not r:
        return {"track_id": track_id, "deleted": True, **(extra or {})}
    out = {"track_id": r["track_id"], "video_id": r["video_id"], "category": r["category"],
           "t_start": r["t_start"], "t_end": r["t_end"], "best_frame_t": r["best_frame_t"],
           "asset_id": r["asset_id"], "n_frames": len(r["frames"])}
    if extra:
        out.update(extra)
    return out


def _spawn_track(src: dict, frames: list[dict]) -> str:
    """用一段帧另起一条未绑定 track（沿用原视频与品类，保留索引可复用）。"""
    return db.insert_track(
        src["video_id"], src["category"], frames,
        t_start=frames[0]["t"], t_end=frames[-1]["t"],
        best_frame_t=frames[len(frames) // 2]["t"], asset_id=None,
    )


# ---------- 端点 ----------

class UnbindRequest(BaseModel):
    t_start: Optional[float] = None   # 两个都为空 = 整条解绑
    t_end: Optional[float] = None


@router.post("/{track_id}/unbind")
async def unbind_track(track_id: str, req: UnbindRequest):
    """解绑。无范围=整条 asset_id 置 NULL；给范围=删掉该时段的采样点：
    剩余点<2 → 退化为整条解绑；否则更新本条 frames/t_start/t_end；
    被切掉的段若 ≥2 点，另起一条未绑定 track 保留索引。"""
    tr = _get_or_404(track_id)

    if req.t_start is None and req.t_end is None:
        db._exec("UPDATE tracks SET asset_id=NULL WHERE track_id=?", (track_id,))
        return _summary(track_id, {"action": "unbind_all"})

    frames = _sorted_frames(tr)
    lo = req.t_start if req.t_start is not None else float("-inf")
    hi = req.t_end if req.t_end is not None else float("inf")
    if lo > hi:
        raise HTTPException(400, "t_start 不能大于 t_end")
    kept = [f for f in frames if not (lo <= f["t"] <= hi)]
    cut = [f for f in frames if lo <= f["t"] <= hi]
    if not cut:
        raise HTTPException(400, "该时间段内没有采样点，无需解绑")

    if len(kept) < 2:
        # 剩余帧不足以构成轨迹 → 整条解绑（frames 原样保留，不做几何裁剪）
        db._exec("UPDATE tracks SET asset_id=NULL WHERE track_id=?", (track_id,))
        return _summary(track_id, {"action": "unbind_all", "reason": "剩余帧不足2个，退化为整条解绑"})

    _write_frames(track_id, kept, _clamp_best_t(kept, tr["best_frame_t"]))
    new_tid = _spawn_track(tr, cut) if len(cut) >= 2 else None
    return _summary(track_id, {"action": "unbind_range", "removed_frames": len(cut),
                               "new_track_id": new_tid})


class RebindRequest(BaseModel):
    asset_id: str


@router.post("/{track_id}/rebind")
async def rebind_track(track_id: str, req: RebindRequest):
    """改绑到指定资产（校验资产存在）。"""
    _get_or_404(track_id)
    if not db.get_asset(req.asset_id):
        raise HTTPException(404, "asset not found")
    db.bind_track_asset(track_id, req.asset_id)
    return _summary(track_id, {"action": "rebind"})


class CutRequest(BaseModel):
    t: float


@router.post("/{track_id}/cut")
async def cut_track(track_id: str, req: CutRequest):
    """按时刻切成两条：前段(t<=切点)保留原 track_id 和绑定，
    后段(t>切点)另起新 track_id、不绑定。切点必须落在轨迹内部。"""
    tr = _get_or_404(track_id)
    frames = _sorted_frames(tr)
    front = [f for f in frames if f["t"] <= req.t]
    back = [f for f in frames if f["t"] > req.t]
    if not front or not back:
        raise HTTPException(400, "切点必须落在轨迹时间范围内部（两侧都要有采样点）")

    _write_frames(track_id, front, _clamp_best_t(front, tr["best_frame_t"]))
    new_tid = _spawn_track(tr, back)
    return _summary(track_id, {"action": "cut", "new_track_id": new_tid,
                               "new_track": _summary(new_tid)})
