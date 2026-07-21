"""场景资产:每个视频对应一份重建场景(房间外壳+家具布局+光线窗户配置)。

rebuild.html 按 ?v=<video_id> 加载对应场景 JSON;页面上「保存场景」把当前布局写回,
沉淀为可复用资产(storage/scenes/<vid>.json)。
"""
import json
import re
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException

router = APIRouter(prefix="/api/scenes", tags=["scenes"])

SCENE_DIR = Path(__file__).resolve().parents[2] / "storage" / "scenes"
SCENE_DIR.mkdir(parents=True, exist_ok=True)

_VID_RE = re.compile(r"^vid_[0-9a-f]+$")


def _path(video_id: str) -> Path:
    if not _VID_RE.match(video_id):
        raise HTTPException(400, "bad video_id")
    return SCENE_DIR / f"{video_id}.json"


@router.get("/{video_id}")
def get_scene(video_id: str):
    p = _path(video_id)
    if not p.exists():
        raise HTTPException(404, f"no scene for {video_id}")
    return json.loads(p.read_text())


@router.put("/{video_id}")
def put_scene(video_id: str, doc: dict = Body(...)):
    p = _path(video_id)
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=2))
    return {"ok": True}
