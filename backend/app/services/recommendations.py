"""Structured-catalog recommendation service.

The recommender may interpret intent with an optional chat model, but products
always come from DreamHome's versioned canonical catalog.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import httpx

from ..config import settings
from ..structured_catalog import load_structured_catalog


ROOM_CATEGORIES = {
    "living": ["沙发", "单椅", "茶几", "边几", "电视柜", "灯具", "绿植", "装饰"],
    "bedroom": ["床", "床头柜", "衣柜", "灯具", "地毯", "装饰"],
    "dining": ["餐桌", "餐椅", "椅", "灯具", "餐边柜", "绿植"],
    "study": ["书桌", "办公椅", "单椅", "书柜", "灯具", "收纳"],
    "balcony": ["户外", "单椅", "边几", "绿植", "灯具"],
}
ROOM_ALIASES = {
    "living": ["客厅", "横厅", "起居室"],
    "bedroom": ["卧室", "主卧", "次卧"],
    "dining": ["餐厅", "饭厅"],
    "study": ["书房", "办公室", "办公区"],
    "balcony": ["阳台", "露台"],
}
MODE_ALIASES = {
    "replacement": ["换搭", "替换", "换一个", "同类", "更合适"],
    "space": ["空间", "房间", "整屋", "搭配"],
    "proactive": ["热门", "大家都在用", "为我推荐", "随便看看"],
}
CATEGORY_ALIASES = [
    "沙发", "单椅", "办公椅", "椅", "桌", "灯具", "吊灯", "柜", "床", "绿植", "装饰", "地毯"
]
COLOR_ALIASES = ["白色", "黑色", "灰色", "米色", "棕色", "绿色", "蓝色", "黄色", "红色"]
STYLE_ALIASES = ["现代", "北欧", "日式", "中古", "复古", "工业风", "自然风", "侘寂", "奶油风"]


def _strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def parse_intent_with_rules(query: str = "", requested_mode: str = "") -> dict[str, Any]:
    text = str(query or "").strip()
    mode = requested_mode if requested_mode in MODE_ALIASES else ""
    if not mode:
        mode = next((key for key, words in MODE_ALIASES.items() if any(word in text for word in words)), "")
    room = next((key for key, words in ROOM_ALIASES.items() if any(word in text for word in words)), "")
    category = next((value for value in CATEGORY_ALIASES if value in text), "")
    return {
        "mode": mode,
        "room": room,
        "targetCategory": category,
        "colors": [value for value in COLOR_ALIASES if value in text],
        "styles": [value for value in STYLE_ALIASES if value in text],
        "source": "rules",
    }


async def parse_intent(query: str, fallback: dict[str, Any]) -> dict[str, Any]:
    if not settings.RECOMMENDER_LLM_ENABLED or not settings.DEEPSEEK_API_KEY or not query:
        return fallback
    body = {
        "model": settings.DEEPSEEK_MODEL,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是家具推荐意图解析器，只返回 JSON，不得编造商品。"
                    "mode 只能是 proactive、space、replacement 或 null；"
                    "room 只能是 living、bedroom、dining、study、balcony 或 null。"
                    "字段为 mode,room,targetCategory,colors,styles。"
                ),
            },
            {"role": "user", "content": query},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=3.5, trust_env=False) as client:
            response = await client.post(
                f"{settings.DEEPSEEK_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}"},
                json=body,
            )
        response.raise_for_status()
        content = response.json().get("choices", [{}])[0].get("message", {}).get("content", "{}")
        parsed = json.loads(content)
        return {
            "mode": parsed.get("mode") or fallback["mode"],
            "room": parsed.get("room") or fallback["room"],
            "targetCategory": parsed.get("targetCategory") or fallback["targetCategory"],
            "colors": _strings(parsed.get("colors")) or fallback["colors"],
            "styles": _strings(parsed.get("styles")) or fallback["styles"],
            "source": "deepseek",
        }
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, TypeError):
        return fallback


def _classification(asset: dict) -> tuple[str, str]:
    value = asset.get("classification") or {}
    return str(value.get("category") or ""), str(value.get("subcategory") or "")


def _tags(asset: dict, key: str) -> list[str]:
    tags = asset.get("tags") or {}
    normalized = tags.get("normalized") or tags.get("raw") or {}
    return _strings(normalized.get(key))


def _category_matches(asset: dict, target: str) -> bool:
    if not target:
        return True
    category, subcategory = _classification(asset)
    haystack = f"{category} {subcategory} {asset.get('name', '')}"
    return target in haystack or (category and category in target)


def _overlap(values: list[str], desired: list[str]) -> int:
    return sum(1 for value in desired if any(value in item or item in value for item in values))


def _popularity(asset_id: str) -> float:
    digest = hashlib.sha256(asset_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:2], "big") / 65535


def _reason(asset: dict, mode: str, room: str) -> str:
    category, _ = _classification(asset)
    if mode == "replacement":
        return f"与当前家具同属{category or '同类家具'}，并优先匹配你的风格偏好"
    if room:
        return "适合当前空间，并兼顾风格与色彩协调"
    return "来自当前目录的高适配热门选择"


def recommend_from_catalog(assets: list[dict], request: dict, intent: dict) -> list[dict]:
    mode = intent.get("mode") or request.get("mode") or "proactive"
    selected_id = str(request.get("selectedItemId") or "")
    selected = next((asset for asset in assets if asset.get("asset_id") == selected_id), None)
    selected_category = _classification(selected)[0] if selected else ""
    target = str(intent.get("targetCategory") or request.get("targetCategory") or selected_category)
    styles = _strings(request.get("styles")) + _strings(intent.get("styles"))
    colors = _strings(request.get("colors")) + _strings(intent.get("colors"))
    if selected:
        styles += _tags(selected, "styles")
        colors += _tags(selected, "colors")
    seen = set(_strings(request.get("seenItemIds")))
    if selected_id:
        seen.add(selected_id)
    room_categories = ROOM_CATEGORIES.get(str(intent.get("room") or request.get("room") or ""), [])
    limit = max(1, min(20, int(request.get("limit") or 6)))

    ranked: list[tuple[float, dict]] = []
    for asset in assets:
        asset_id = str(asset.get("asset_id") or "")
        if asset.get("status") != "ready" or not asset_id or asset_id in seen:
            continue
        if mode == "replacement" and not _category_matches(asset, target):
            continue
        category_score = 45 if target and _category_matches(asset, target) else 0
        room_score = 35 if any(_category_matches(asset, category) for category in room_categories) else 0
        style_score = min(20, _overlap(_tags(asset, "styles"), styles) * 10)
        color_score = min(12, _overlap(_tags(asset, "colors"), colors) * 6)
        ranked.append((category_score + room_score + style_score + color_score + _popularity(asset_id), asset))
    ranked.sort(key=lambda item: (-item[0], str(item[1].get("asset_id") or "")))

    output = []
    for score, asset in ranked[:limit]:
        category, subcategory = _classification(asset)
        media = asset.get("media") or {}
        output.append(
            {
                "id": asset["asset_id"],
                "name": asset.get("name") or "未命名家具",
                "category": category,
                "subCategory": subcategory,
                "colors": _tags(asset, "colors"),
                "materials": _tags(asset, "materials"),
                "styles": _tags(asset, "styles"),
                "thumbnail": media.get("thumbnail") or "",
                "modelUrl": media.get("model_3d") or "",
                "contextImage": media.get("context") or "",
                "trialAvailable": bool(media.get("model_3d")),
                "reason": _reason(asset, mode, str(intent.get("room") or request.get("room") or "")),
                "score": round(score, 2),
            }
        )
    return output


async def recommend(request: dict, catalog_path: Path) -> dict:
    rule_intent = parse_intent_with_rules(str(request.get("query") or ""), str(request.get("mode") or ""))
    intent = await parse_intent(str(request.get("query") or ""), rule_intent)
    mode = intent.get("mode") or request.get("mode")
    if not mode:
        question = "你想让我推荐整个空间，还是替换某一件家具？"
    elif mode == "replacement" and not request.get("selectedItemId") and not request.get("targetCategory") and not intent.get("targetCategory"):
        question = "你想替换哪一件家具？可以点选家具，或告诉我品类。"
    else:
        question = ""
    if question:
        return {"clarificationRequired": True, "clarificationQuestion": question, "intent": intent, "items": []}
    catalog = load_structured_catalog(catalog_path)
    items = recommend_from_catalog(catalog["assets"], request, intent)
    seen = _strings(request.get("seenItemIds")) + [item["id"] for item in items]
    set_seed = json.dumps([request.get("query"), request.get("mode"), seen], ensure_ascii=False)
    set_id = hashlib.sha256(set_seed.encode("utf-8")).hexdigest()[:12]
    return {
        "clarificationRequired": False,
        "clarificationQuestion": None,
        "intent": intent,
        "recommendationSetId": f"rec_{set_id}",
        "items": items,
        "nextSeenItemIds": seen,
        "strategyVersion": "structured-rules-v1",
        "catalogSize": len(catalog["assets"]),
    }
