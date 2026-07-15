"""结构化标签提取：家具抠图 → Labels(品类/颜色/材质/风格/特征/尺寸档)。

离线 pipeline 和在线圈选共用这一个入口和同一份 prompt/schema，保证标签体系一致。
provider: anthropic | dashscope | mock(缺 key 自动退)。
"""
import base64
import json
import mimetypes
import os
import re
from typing import Optional

import httpx

from ..config import settings

_PROMPT = """你是家具识别标注器。观察图中的主体家具，输出 JSON(仅 JSON，无其他文字)：
{"category": "沙发|单椅|床|柜子|桌子|灯具|地毯|绿植|窗帘|装饰|其他 之一",
 "sub": "更细的子品类，如 三人沙发/吊灯/边柜",
 "colors": ["主要颜色，最多3个"],
 "materials": ["材质，如 布艺/皮革/实木/金属/藤编/玻璃"],
 "styles": ["风格，如 现代/北欧/复古/奶油风/工业风"],
 "features": ["形态特征，如 圆弧扶手/细腿/簇绒/带抽屉，最多5个"],
 "size_class": "小|中|大 之一，按该品类常规体量判断"}"""

_EMPTY = {"category": "", "sub": "", "colors": [], "materials": [],
          "styles": [], "features": [], "size_class": ""}


async def extract_labels(image_path: Optional[str] = None, *,
                         category_hint: str = "") -> dict:
    provider = settings.effective_labels_provider
    try:
        if provider == "anthropic" and image_path:
            return await _anthropic(image_path)
        if provider == "dashscope" and image_path:
            return await _dashscope(image_path)
    except Exception:
        pass  # 打标签失败不阻断主链路，退 mock
    return _mock(image_path, category_hint)


def _parse_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    data = json.loads(m.group(0)) if m else {}
    out = dict(_EMPTY)
    for k in out:
        if k in data:
            out[k] = data[k]
    return out


def _image_block_b64(image_path: str) -> tuple[str, str]:
    mime = mimetypes.guess_type(image_path)[0] or "image/jpeg"
    with open(image_path, "rb") as f:
        return mime, base64.b64encode(f.read()).decode()


async def _anthropic(image_path: str) -> dict:
    mime, b64 = _image_block_b64(image_path)
    payload = {
        "model": settings.ANTHROPIC_MODEL,
        "max_tokens": 512,
        "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
            {"type": "text", "text": _PROMPT},
        ]}],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": settings.ANTHROPIC_API_KEY,
                     "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
    return _parse_json("".join(b.get("text", "") for b in data.get("content", [])))


async def _dashscope(image_path: str) -> dict:
    mime, b64 = _image_block_b64(image_path)
    payload = {
        "model": settings.DASHSCOPE_VL_MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            {"type": "text", "text": _PROMPT},
        ]}],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.DASHSCOPE_API_KEY}"},
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
    return _parse_json(data["choices"][0]["message"]["content"])


# 文件名关键词 → mock 标签，保证无 key 时链路可跑、demo 数据像样
_MOCK_TABLE = {
    "sofa": {"category": "沙发", "sub": "三人沙发", "colors": ["绿色"], "materials": ["布艺"],
             "styles": ["复古"], "features": ["簇绒", "圆弧扶手"], "size_class": "大"},
    "armchair": {"category": "单椅", "sub": "扶手椅", "colors": ["白色"], "materials": ["布艺"],
                 "styles": ["现代"], "features": ["簇绒"], "size_class": "中"},
    "chair": {"category": "单椅", "sub": "吧凳", "colors": ["棕色"], "materials": ["实木"],
              "styles": ["复古"], "features": ["细腿"], "size_class": "小"},
    "lamp": {"category": "灯具", "sub": "吊灯", "colors": ["黑色"], "materials": ["金属"],
             "styles": ["工业风"], "features": ["多头"], "size_class": "中"},
    "cabinet": {"category": "柜子", "sub": "边柜", "colors": ["原木色"], "materials": ["实木"],
                "styles": ["北欧"], "features": ["带抽屉"], "size_class": "中"},
    "plant": {"category": "绿植", "sub": "多肉", "colors": ["绿色"], "materials": [],
              "styles": [], "features": ["盆栽"], "size_class": "小"},
}


def _mock(image_path: Optional[str], category_hint: str) -> dict:
    name = os.path.basename(image_path or "").lower()
    for key, labels in _MOCK_TABLE.items():
        if key in name:
            return dict(labels)
    # 按品类提示回一套完整假标签，让联调期能走通"匹配到同款"流程
    for labels in _MOCK_TABLE.values():
        if labels["category"] == category_hint:
            return dict(labels)
    out = dict(_EMPTY)
    out["category"] = category_hint or "其他"
    return out
