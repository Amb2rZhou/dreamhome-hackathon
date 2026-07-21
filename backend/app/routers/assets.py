"""资产库：浏览/详情/审核(改标签/合并重复)。"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

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
