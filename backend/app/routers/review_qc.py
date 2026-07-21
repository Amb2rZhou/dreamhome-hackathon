"""资产人工审核:通过/不通过 + 原因记录,落 asset_reviews 表。

配套前端 /review/approve.html。重做批次时按 verdict='fail' 拉清单。
"""
import time
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from .. import db

router = APIRouter(prefix="/api/review", tags=["review-qc"])

db._exec("""CREATE TABLE IF NOT EXISTS asset_reviews(
  asset_id   TEXT PRIMARY KEY,
  verdict    TEXT NOT NULL,           -- pass | fail
  reason     TEXT NOT NULL DEFAULT '',
  updated_at REAL NOT NULL
)""")


class ReviewIn(BaseModel):
    verdict: str                      # pass | fail | clear
    reason: Optional[str] = ""


@router.get("")
async def list_reviews():
    rows = db._exec("SELECT asset_id, verdict, reason, updated_at FROM asset_reviews").fetchall()
    return {r[0]: {"verdict": r[1], "reason": r[2], "updated_at": r[3]} for r in rows}


@router.post("/{asset_id}")
async def set_review(asset_id: str, req: ReviewIn):
    if req.verdict == "clear":
        db._exec("DELETE FROM asset_reviews WHERE asset_id=?", (asset_id,))
        return {"asset_id": asset_id, "cleared": True}
    db._exec("""INSERT INTO asset_reviews(asset_id, verdict, reason, updated_at)
                VALUES(?,?,?,?)
                ON CONFLICT(asset_id) DO UPDATE SET verdict=excluded.verdict,
                  reason=excluded.reason, updated_at=excluded.updated_at""",
             (asset_id, req.verdict, req.reason or "", time.time()))
    return {"asset_id": asset_id, "verdict": req.verdict, "reason": req.reason or ""}
