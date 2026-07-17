"""补全一致性校验(幻觉闸):补全图必须还是原图里那件家具,不许凭空发明。

qwen-vl 对照原始抠图与补全图打分,不一致 → pipeline 跳过该物体(轨迹仍入索引)。
约 ¥0.008/次,挡掉一次 ¥0.5 的废生成 + 资产库污染,稳赚。
带内容哈希缓存;API 不可用时放行(不阻塞量产,靠人工审核兜底)。
"""
import base64
import json
import mimetypes
import re

import httpx

from ..config import settings

_PROMPT = """图1是从家装视频截取的家具原图(可能残缺/被遮挡),图2是AI补全后的产品图。
判断图2是否忠实还原了图1中的同一件家具:品类相同、颜色材质一致、没有凭空新增主体或摆件。
只输出 JSON: {"same": true/false, "reason": "一句话"}"""


def _uri(p: str) -> str:
    mime = mimetypes.guess_type(p)[0] or "image/jpeg"
    with open(p, "rb") as f:
        return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"


async def check_consistency(original_path: str, enhanced_path: str) -> tuple[bool, str]:
    """返回 (是否一致, 原因)。校验不可用时返回 (True, 'skipped')。"""
    if not settings.DASHSCOPE_API_KEY:
        return True, "skipped(no key)"
    from . import cache
    key = cache.content_key(original_path, enhanced_path, extra="consistency-v1")
    hit = cache.get("consistency", key)
    if hit:
        return hit["same"], hit["reason"]
    try:
        payload = {
            "model": settings.DASHSCOPE_VL_MODEL,
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": _uri(original_path)}},
                {"type": "image_url", "image_url": {"url": _uri(enhanced_path)}},
                {"type": "text", "text": _PROMPT},
            ]}],
        }
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            r = await client.post(
                "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.DASHSCOPE_API_KEY}"},
                json=payload)
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]
        m = re.search(r"\{.*\}", text, re.S)
        data = json.loads(m.group(0)) if m else {}
        same = bool(data.get("same", True))
        reason = str(data.get("reason", ""))[:120]
        cache.put("consistency", key, {"same": same, "reason": reason})
        return same, reason
    except Exception as e:  # noqa: BLE001 校验挂了不拦生产
        return True, f"skipped({type(e).__name__})"
