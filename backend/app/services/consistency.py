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

_PROMPT = """图1是从家装视频截取的家具原图(可能残缺/被遮挡,目标可能有圈选边界),图2是AI补全后的产品图。
判断图2是否忠实还原了图1中的同一件家具本体。不要只判断是否同品类，必须逐项比较可见结构：
- 外轮廓和高宽比例；
- 开放格、门、抽屉、腿、扶手、靠背等部件的数量、位置和开闭形式；
- 图1中已经可见的边、隔板、孔洞和连接关系是否原样保留；
- 主体颜色材质是否一致；
- 图2是否凭空增加了图1没有证据支持的门、抽屉、柜腿或其他结构。
注意:补全会刻意清空家具上/内的杂物摆件(桌面物品、柜内收纳、床品褶皱整理),
这属于预期行为,**不算不一致** —— 只看家具本体是否还是同一件。
如果原图太模糊、遮挡太多，无法确认关键结构，必须降低 confidence，不能猜测为一致。
只输出 JSON: {"same": true/false, "category_match": true/false,
"proportion_match": true/false, "topology_match": true/false,
"visible_parts_preserved": true/false, "material_color_match": true/false,
"confidence": 0到1, "conflicts": ["结构冲突"], "reason": "一句话"}"""

_IDENTITY_REQUIRED = (
    "same", "category_match", "proportion_match", "topology_match",
    "visible_parts_preserved",
)
_IDENTITY_MIN_CONFIDENCE = 0.78


def _identity_verdict(data: dict) -> tuple[bool, str]:
    """Fail closed unless every structure-critical field is explicitly true."""
    missing = [key for key in _IDENTITY_REQUIRED if not isinstance(data.get(key), bool)]
    try:
        confidence = float(data.get("confidence"))
    except (TypeError, ValueError):
        confidence = -1.0
    failed = [key for key in _IDENTITY_REQUIRED if data.get(key) is False]
    conflicts = data.get("conflicts") if isinstance(data.get("conflicts"), list) else []
    reason = str(data.get("reason") or "").strip()
    if missing:
        return False, f"identity response missing: {','.join(missing)}"
    if not 0 <= confidence <= 1:
        return False, "identity response missing confidence"
    if failed:
        detail = "、".join(str(item) for item in conflicts[:3] if item)
        return False, detail or reason or f"identity mismatch: {','.join(failed)}"
    if confidence < _IDENTITY_MIN_CONFIDENCE:
        return False, reason or f"identity confidence too low ({confidence:.2f})"
    return True, reason or f"structure match ({confidence:.2f})"


def _uri(p: str) -> str:
    mime = mimetypes.guess_type(p)[0] or "image/jpeg"
    with open(p, "rb") as f:
        return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"


_SOLO_PROMPT = ('这是一张家具产品图,目标商品是「{name}」。判断画面里是否只有这一件家具单体,'
                '没有混入其他家具(如旁边的椅子、柜子、摆件等独立物体)。'
                '只输出 JSON: {{"solo": true/false, "reason": "一句话"}}')


async def check_solo(enhanced_path: str, name: str, *, strict: bool = False) -> tuple[bool, str]:
    """单体闸:补全图必须只含目标家具一件(2026-07-20 验收:餐桌图残留椅子会被焊进3D)。"""
    if not settings.DASHSCOPE_API_KEY:
        return (False, "unavailable(no key)") if strict else (True, "skipped(no key)")
    from . import cache
    key = cache.content_key(enhanced_path, extra=f"solo-v1|{name}")
    hit = cache.get("consistency", key)
    if hit:
        return hit["solo"], hit["reason"]
    try:
        payload = {
            "model": settings.DASHSCOPE_VL_MODEL,
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": _uri(enhanced_path)}},
                {"type": "text", "text": _SOLO_PROMPT.format(name=name)},
            ]}],
        }
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            r = await client.post(
                f"{settings.DASHSCOPE_BASE_URL}/compatible-mode/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.DASHSCOPE_API_KEY}"},
                json=payload)
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]
        m = re.search(r"\{.*\}", text, re.S)
        data = json.loads(m.group(0)) if m else {}
        # A malformed/ambiguous answer must not approve a paid 3D job.
        solo = data.get("solo") is True
        reason = str(data.get("reason", ""))[:120]
        cache.put("consistency", key, {"solo": solo, "reason": reason})
        return solo, reason
    except Exception as e:  # noqa: BLE001
        reason = f"unavailable({type(e).__name__})"
        return (False, reason) if strict else (True, reason.replace("unavailable", "skipped"))


async def check_consistency(original_path: str, enhanced_path: str, *,
                            target_name: str = "", strict: bool = False) -> tuple[bool, str]:
    """返回 (是否一致, 原因)。校验不可用时返回 (True, 'skipped')。"""
    if not settings.DASHSCOPE_API_KEY:
        return (False, "unavailable(no key)") if strict else (True, "skipped(no key)")
    from . import cache
    key = cache.content_key(
        original_path, enhanced_path,
        extra=f"consistency-structure-v4|{target_name}",
    )
    hit = cache.get("consistency", key)
    if hit:
        return hit["same"], hit["reason"]
    try:
        payload = {
            "model": settings.DASHSCOPE_VL_MODEL,
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": _uri(original_path)}},
                {"type": "image_url", "image_url": {"url": _uri(enhanced_path)}},
                {"type": "text", "text": (
                    (f"目标家具是「{target_name}」。" if target_name else "") + _PROMPT
                )},
            ]}],
        }
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            r = await client.post(
                f"{settings.DASHSCOPE_BASE_URL}/compatible-mode/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.DASHSCOPE_API_KEY}"},
                json=payload)
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]
        m = re.search(r"\{.*\}", text, re.S)
        data = json.loads(m.group(0)) if m else {}
        same, reason = _identity_verdict(data)
        reason = reason[:240]
        cache.put("consistency", key, {"same": same, "reason": reason})
        return same, reason
    except Exception as e:  # noqa: BLE001
        reason = f"unavailable({type(e).__name__})"
        return (False, reason) if strict else (True, reason.replace("unavailable", "skipped"))
