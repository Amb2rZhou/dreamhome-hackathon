"""资产库：浏览/详情/审核(改标签/合并重复)。"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import json
import time

from .. import db, matching
from ..schemas_lib import AssetOut, MergeRequest
from ..store import get_job

router = APIRouter(prefix="/api/assets", tags=["assets"])

# 专项库品类(T6 服务端化):窗户/吊顶/地板/光线/窗外景观,默认不进常规资产库列表
SPECIAL_CATEGORIES = {"窗户", "吊顶", "地板", "光线", "窗外景观"}


def _is_special(asset: dict) -> bool:
    labels = asset.get("labels") or {}
    return labels.get("category") in SPECIAL_CATEGORIES or bool(labels.get("special"))


def _refresh_generating(asset: dict) -> dict:
    """生成中的资产从 job store 取最新状态；完成则落库。"""
    if asset["status"] == "generating" and asset.get("job_id"):
        job = get_job(asset["job_id"])
        if job and job.status.value == "succeeded" and job.model_url:
            db.update_asset(asset["asset_id"], status="ready", glb_url=job.model_url)
            asset["status"], asset["glb_url"] = "ready", job.model_url
        elif job and job.status.value == "failed":
            db.update_asset(asset["asset_id"], status="rejected")
            asset["status"] = "rejected"
    return asset


@router.get("", response_model=List[AssetOut])
async def list_assets(space: str = "", category: str = "", q: str = "",
                      include_all_status: bool = False,
                      exclude_special: bool = True):
    """主入口：分类浏览 + 搜索。include_all_status=true 给审核页用。
    exclude_special=true(默认)过滤专项库资产(窗户/吊顶/地板/光线/窗外景观或 labels.special)。"""
    assets = db.list_assets(space=space, category=category, q=q,
                            include_all_status=include_all_status)
    if exclude_special:
        assets = [a for a in assets if not _is_special(a)]
    return [_refresh_generating(a) for a in assets]


@router.get("/review/duplicates")
async def review_duplicates():
    """审核页：疑似重复资产对(同品类 + 标签高重合)，人工确认后调 /merge。"""
    return matching.duplicate_pairs()


@router.get("/{asset_id}/appearances")
async def asset_appearances(asset_id: str):
    """Return every original-video interval bound to an asset.

    Frontends use this to seek/highlight the asset at the exact seconds where it
    appears.  Tracks remain the source of truth; no time range is inferred from
    the thumbnail or the asset's single ``t_best`` value.
    """
    if not db.get_asset(asset_id):
        raise HTTPException(404, "asset not found")
    rows = db._exec(
        """SELECT track_id, video_id, t_start, t_end, best_frame_t
             FROM tracks
            WHERE asset_id=?
            ORDER BY video_id, t_start, t_end""",
        (asset_id,),
    ).fetchall()
    return [dict(row) for row in rows]


@router.get("/{asset_id}/full")
async def full_asset(asset_id: str):
    """Canonical frontend payload: identity, classification, size, media and provenance."""
    asset = db.get_asset(asset_id)
    if not asset:
        raise HTTPException(404, "asset not found")
    appearances = db._rows(
        """SELECT track_id,video_id,t_start,t_end,best_frame_t,category
             FROM tracks WHERE asset_id=? ORDER BY video_id,t_start""", (asset_id,))
    media = db._rows(
        """SELECT media_id,kind,version,url,mime_type,width_px,height_px,bytes,sha256,
                  is_current,metadata_json,created_at
             FROM asset_media WHERE asset_id=? ORDER BY kind,version""", (asset_id,))
    for item in media:
        item["is_current"] = bool(item["is_current"])
        item["metadata"] = json.loads(item.pop("metadata_json") or "{}")
    review = db._row(
        "SELECT verdict,reason,updated_at FROM asset_reviews WHERE asset_id=?", (asset_id,))
    geometry = db._row("SELECT * FROM asset_geometry WHERE asset_id=?", (asset_id,))
    if geometry:
        for key in ("bounds_min_json", "bounds_max_json", "dimensions_json", "center_json",
                    "collision_json", "anchor_json"):
            geometry[key.removesuffix("_json")] = json.loads(geometry.pop(key) or "{}")
    return {**asset, "appearances": appearances, "media": media,
            "geometry": geometry, "review": review}


class AssetMediaCreate(BaseModel):
    kind: str
    url: str
    mime_type: str = ""
    width_px: Optional[int] = None
    height_px: Optional[int] = None
    bytes: Optional[int] = None
    sha256: str = ""
    metadata: dict = {}
    make_current: bool = True


@router.post("/{asset_id}/media")
async def add_asset_media(asset_id: str, item: AssetMediaCreate):
    if not db.get_asset(asset_id):
        raise HTTPException(404, "asset not found")
    version = db._row(
        "SELECT COALESCE(MAX(version),0)+1 version FROM asset_media WHERE asset_id=? AND kind=?",
        (asset_id, item.kind),
    )["version"]
    media_id = db.new_id("med")
    conn = db.get_conn()
    with db._lock:
        if item.make_current:
            conn.execute("UPDATE asset_media SET is_current=0 WHERE asset_id=? AND kind=?",
                         (asset_id, item.kind))
        conn.execute(
            """INSERT INTO asset_media(media_id,asset_id,kind,version,url,mime_type,width_px,
               height_px,bytes,sha256,is_current,metadata_json,created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (media_id, asset_id, item.kind, version, item.url, item.mime_type,
             item.width_px, item.height_px, item.bytes, item.sha256,
             1 if item.make_current else 0,
             json.dumps(item.metadata, ensure_ascii=False), time.time()),
        )
        conn.commit()
    return {"media_id": media_id, "asset_id": asset_id, "kind": item.kind,
            "version": version, "is_current": item.make_current}


@router.get("/{asset_id}", response_model=AssetOut)
async def get_asset(asset_id: str):
    asset = db.get_asset(asset_id)
    if not asset:
        raise HTTPException(404, "asset not found")
    return _refresh_generating(asset)


class AssetPatch(BaseModel):
    name: Optional[str] = None
    space: Optional[str] = None
    labels: Optional[dict] = None
    status: Optional[str] = None       # 审核：ready(通过) / rejected(拒绝)
    size_prior: Optional[dict] = None  # 真实尺寸(米) {w,h,d}:Boss 在场景里调过的长宽比,资产级生效


@router.patch("/{asset_id}", response_model=AssetOut)
async def patch_asset(asset_id: str, patch: AssetPatch):
    if not db.get_asset(asset_id):
        raise HTTPException(404, "asset not found")
    fields = {k: v for k, v in patch.model_dump().items() if v is not None}
    if fields:
        db.update_asset(asset_id, **fields)
    return db.get_asset(asset_id)


@router.post("/merge", response_model=AssetOut)
async def merge(req: MergeRequest):
    """合并重复资产：标签取并集写全、track 重挂、drop 方进 merged_from。
    重复生成 = 标签不全的信号，合并即修复(自愈闭环)。"""
    if req.keep_id == req.drop_id:
        raise HTTPException(400, "keep_id and drop_id must differ")
    merged = db.merge_assets(req.keep_id, req.drop_id)
    if not merged:
        raise HTTPException(404, "asset not found")
    return merged
