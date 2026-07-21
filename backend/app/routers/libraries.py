"""专项资产库:窗户/吊顶/地板/光线/窗外景观五类 manifest 的只读接口。

这五类只在编辑「家」场景(rebuild.html)时使用,不进首页常规资产库
(条目均带 "special": true,供 assets 列表接口过滤参照)。
数据源:storage/libraries/{kind}.json,统一结构 {"kind": ..., "items": [...]}。
"""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/libraries", tags=["libraries"])

LIB_DIR = Path(__file__).resolve().parents[2] / "storage" / "libraries"

# kind 白名单:五类专项库,其余一律 404
KINDS = {"windows", "ceilings", "floors", "lights", "views"}


@router.get("/{kind}")
def get_library(kind: str):
    if kind not in KINDS:
        raise HTTPException(404, f"unknown library kind: {kind}")
    p = LIB_DIR / f"{kind}.json"
    if not p.exists():
        raise HTTPException(404, f"manifest missing for {kind}")
    return json.loads(p.read_text(encoding="utf-8"))
