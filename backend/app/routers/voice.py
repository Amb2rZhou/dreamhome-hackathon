"""能力3(其二)：语音编辑。

手机端把语音转成文本后 POST 上来 → 解析成结构化编辑指令 → 前端编辑器执行。
放在同一后端，未来也可接音频文件走服务端 ASR。
"""
from typing import Optional, List
from fastapi import APIRouter
from pydantic import BaseModel
from ..schemas import EditCommand
from ..services.voice import parse_edit

router = APIRouter(prefix="/api/voice-edit", tags=["voice"])


class VoiceEditRequest(BaseModel):
    transcript: str                          # 手机端 ASR 出的文本
    catalog: Optional[List[str]] = None      # 当前场景物体，用于对齐"那个沙发"


@router.post("", response_model=EditCommand)
async def voice_edit(req: VoiceEditRequest):
    return parse_edit(req.transcript, req.catalog)
