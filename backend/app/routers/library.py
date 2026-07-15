"""我的素材库：全选/单击/圈选 加入的资产收藏。demo 阶段单用户(user_id=demo)。"""
from fastapi import APIRouter

from .. import db
from ..schemas_lib import LibraryAddRequest

router = APIRouter(prefix="/api/library", tags=["library"])


@router.get("")
async def my_library(user_id: str = "demo"):
    return db.library_of(user_id)


@router.post("/batch-add")
async def batch_add(req: LibraryAddRequest):
    """全选：把暂停帧上所有已入库资产一键加进我的素材库。"""
    added = db.library_add(req.user_id, req.asset_ids, req.via)
    return {"added": added, "total": len(db.library_of(req.user_id))}
