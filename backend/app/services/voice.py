"""语音编辑：文本(ASR 结果) → 结构化编辑指令 EditCommand。

分工：语音转文字放在手机端做(iOS/Android 原生 ASR、Web 用 Web Speech API，
就近、免上传音频、延迟低)；后端只负责把文本解析成编辑器能执行的指令。

解析两条路(退化保证可用)：
1. 有 ANTHROPIC_API_KEY → 用 LLM function-calling 精准解析(支持自由表达)。
2. 否则 → 关键词规则兜底(覆盖 demo 常用句式)。
"""
import json
import re
from typing import Optional
from ..config import settings
from ..schemas import EditCommand

# demo 常用中文指令的关键词表
_ACTION_WORDS = {
    "move": ["移", "挪", "放到", "推", "拉到", "靠"],
    "rotate": ["转", "旋转", "调个方向", "掉头"],
    "scale": ["大", "小", "缩放", "放大", "缩小"],
    "replace": ["换成", "替换", "改成"],
    "delete": ["删", "去掉", "移除", "拿走"],
    "select": ["选中", "选择", "点一下"],
}
_DIRECTION = {
    "left": ["左"], "right": ["右"], "front": ["前"], "back": ["后"],
    "window": ["窗"], "wall": ["墙"], "corner": ["角"], "center": ["中间", "正中"],
}


def parse_edit(transcript: str, catalog: Optional[list] = None) -> EditCommand:
    """catalog: 当前场景里的物体列表(用于把'那个沙发'对齐到具体 id)。"""
    transcript = (transcript or "").strip()
    if not transcript:
        return EditCommand(action="unknown", transcript=transcript)

    if settings.ANTHROPIC_API_KEY:
        try:
            return _parse_with_llm(transcript, catalog or [])
        except Exception:
            pass  # LLM 出错就落到规则
    return _parse_with_rules(transcript)


def _parse_with_rules(transcript: str) -> EditCommand:
    action = "unknown"
    for act, words in _ACTION_WORDS.items():
        if any(w in transcript for w in words):
            action = act
            break
    # 方向/位置
    value = None
    for key, words in _DIRECTION.items():
        if any(w in transcript for w in words):
            value = key
            break
    # 放大/缩小方向
    params = {}
    if action == "scale":
        params["factor"] = 1.2 if any(w in transcript for w in ["大", "放大"]) else 0.8
    # 目标物体：抓句子里的名词性片段(简单启发式：取"把X"里的X)
    target = None
    m = re.search(r"把(.{1,8}?)(移|挪|放|转|换|删|去|拿|缩|放大)", transcript)
    if m:
        target = m.group(1)
    return EditCommand(
        action=action, target=target, value=value, params=params,
        transcript=transcript, confidence=0.5,
    )


def _parse_with_llm(transcript: str, catalog: list) -> EditCommand:
    import httpx

    tool = {
        "name": "emit_edit_command",
        "description": "把用户对 3D 家居场景的口语编辑意图转成结构化指令",
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string",
                            "enum": ["move", "rotate", "scale", "replace",
                                     "select", "delete", "unknown"]},
                "target": {"type": "string", "description": "物体名或场景中的 id"},
                "value": {"type": "string", "description": "方向/新品类/位置锚点"},
                "params": {"type": "object"},
            },
            "required": ["action"],
        },
    }
    sys = "你是家居 3D 编辑器的语音指令解析器。只输出一次工具调用。"
    if catalog:
        sys += f" 当前场景物体：{json.dumps(catalog, ensure_ascii=False)}。"
    body = {
        "model": settings.ANTHROPIC_MODEL,
        "max_tokens": 512,
        "system": sys,
        "tools": [tool],
        "tool_choice": {"type": "tool", "name": "emit_edit_command"},
        "messages": [{"role": "user", "content": transcript}],
    }
    headers = {
        "x-api-key": settings.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    with httpx.Client(timeout=30) as client:
        r = client.post("https://api.anthropic.com/v1/messages", headers=headers, json=body)
        r.raise_for_status()
        data = r.json()
    for block in data.get("content", []):
        if block.get("type") == "tool_use":
            inp = block["input"]
            return EditCommand(
                action=inp.get("action", "unknown"),
                target=inp.get("target"),
                value=inp.get("value"),
                params=inp.get("params", {}) or {},
                transcript=transcript,
                confidence=0.9,
            )
    return EditCommand(action="unknown", transcript=transcript)
