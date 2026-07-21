"""视频对照标注:boss 在 rebuild 页面圈出视频里缺失/未生成的物品,存 JSON 供后续走生成流程."""
import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/annotations", tags=["annotations"])

ANN_DIR = Path(__file__).resolve().parents[2] / "storage" / "annotations"
ANN_DIR.mkdir(parents=True, exist_ok=True)

_VID_RE = re.compile(r"^vid_[0-9a-f]+$")


class Annotation(BaseModel):
    t: float                  # 视频时间点(秒)
    bbox: list[float]         # 归一化 [x, y, w, h]
    note: str = ""            # boss 备注,如"衣柜没生成"
    # 审核状态机:pending(刚圈) → prepped(补全图就绪) → approved/rejected(boss 审) → generated(3D 完成)
    status: str = "pending"
    ctx_url: str = ""         # 上下文帧(红框标目标)
    enh_url: str = ""         # 补全图
    asset_id: str = ""        # generated 后回填
    reject_reason: str = ""   # 打回原因,重做时作为补全指令带入,避免无谓重试


class AnnotationDoc(BaseModel):
    video_id: str
    items: list[Annotation]


def _path(video_id: str) -> Path:
    if not _VID_RE.match(video_id):
        raise HTTPException(400, "bad video_id")
    return ANN_DIR / f"{video_id}.json"


@router.get("/{video_id}")
def get_annotations(video_id: str):
    p = _path(video_id)
    if not p.exists():
        return {"video_id": video_id, "items": []}
    return json.loads(p.read_text())


@router.put("/{video_id}")
def put_annotations(video_id: str, doc: AnnotationDoc):
    p = _path(video_id)
    p.write_text(json.dumps(doc.model_dump(), ensure_ascii=False, indent=2))
    return {"ok": True, "count": len(doc.items)}
