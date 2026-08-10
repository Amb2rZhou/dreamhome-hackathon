"""Deterministic furniture recommendations from the canonical catalog only.

V1 deliberately has no model call, embedding, or inferred product metadata.
Every score and reason is derived from fields already stored on a canonical
asset plus the structured room context supplied by the editor.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from ..structured_catalog import load_structured_catalog


ROOM_CATEGORIES = {
    "living": ["沙发", "桌子", "灯具", "单椅", "地毯", "柜子", "绿植", "装饰"],
    "bedroom": ["床", "柜子", "灯具", "地毯", "装饰", "绿植", "单椅"],
    "dining": ["桌子", "单椅", "灯具", "柜子", "绿植", "装饰"],
    "study": ["桌子", "单椅", "柜子", "灯具", "装饰", "绿植"],
    "balcony": ["单椅", "桌子", "绿植", "灯具", "装饰"],
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
    "沙发", "单椅", "办公椅", "椅", "桌子", "桌", "灯具", "吊灯",
    "柜子", "柜", "床", "绿植", "装饰", "地毯", "家电", "卫浴",
]
COLOR_ALIASES = ["白色", "黑色", "灰色", "米色", "棕色", "绿色", "蓝色", "黄色", "红色"]
STYLE_ALIASES = ["现代", "北欧", "日式", "中古", "复古", "工业风", "自然风", "侘寂", "奶油风"]

COMPLEMENTS = {
    "沙发": ["桌子", "灯具", "单椅", "地毯"],
    "桌子": ["单椅", "灯具", "装饰"],
    "灯具": ["沙发", "桌子", "单椅"],
    "单椅": ["桌子", "灯具", "地毯"],
    "柜子": ["装饰", "灯具", "绿植"],
    "地毯": ["沙发", "桌子", "单椅"],
    "绿植": ["柜子", "灯具", "装饰"],
    "装饰": ["柜子", "桌子", "灯具"],
    "床": ["灯具", "柜子", "地毯"],
}
DEFAULT_CATEGORY_ORDER = ["沙发", "桌子", "灯具", "单椅", "柜子", "地毯", "绿植", "装饰", "床"]


def _strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))


def _canonical_category(value: str) -> str:
    text = str(value or "")
    if any(token in text for token in ("桌", "茶几", "边几")):
        return "桌子"
    if any(token in text for token in ("椅", "凳")):
        return "单椅"
    if any(token in text for token in ("柜", "架", "收纳")):
        return "柜子"
    if any(token in text for token in ("灯", "照明")):
        return "灯具"
    for category in ("沙发", "地毯", "绿植", "装饰", "床", "家电", "卫浴"):
        if category in text:
            return category
    return text


def _room_key(value: str) -> str:
    text = str(value or "").strip()
    if text in ROOM_CATEGORIES:
        return text
    return next((key for key, words in ROOM_ALIASES.items() if any(word in text for word in words)), "")


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
        "targetCategory": _canonical_category(category),
        "colors": [value for value in COLOR_ALIASES if value in text],
        "styles": [value for value in STYLE_ALIASES if value in text],
        "source": "rules",
    }


async def parse_intent(_query: str, fallback: dict[str, Any]) -> dict[str, Any]:
    """Keep query compatibility while guaranteeing that V1 makes no model call."""
    return fallback


def _classification(asset: dict) -> tuple[str, str]:
    value = asset.get("classification") or {}
    return str(value.get("category") or ""), str(value.get("subcategory") or "")


def _asset_category(asset: dict) -> str:
    category, subcategory = _classification(asset)
    return _canonical_category(category or subcategory or str(asset.get("name") or ""))


def _tags(asset: dict, key: str) -> list[str]:
    tags = asset.get("tags") or {}
    normalized = tags.get("normalized") or tags.get("raw") or {}
    return _strings(normalized.get(key))


def _overlap(values: list[str], desired: list[str]) -> int:
    # V1 intentionally uses exact normalized-tag equality only.
    return len(set(values).intersection(desired))


def _asset_video_id(asset: dict) -> str:
    return str((asset.get("source") or {}).get("video_id") or asset.get("videoId") or "")


def _media(asset: dict) -> dict:
    return asset.get("media") or {}


def _target_categories(mode: str, request: dict, room: str, placed_categories: list[str]) -> tuple[list[str], set[str]]:
    explicit = _canonical_category(str(request.get("targetCategory") or ""))
    if mode == "replacement":
        return ([explicit] if explicit else []), set()
    ordered: list[str] = []
    for category in placed_categories:
        ordered.extend(COMPLEMENTS.get(category, []))
    if explicit:
        ordered.insert(0, explicit)
    ordered.extend(ROOM_CATEGORIES.get(room, []))
    ordered.extend(DEFAULT_CATEGORY_ORDER)
    ordered = list(dict.fromkeys(value for value in ordered if value))
    complements = {
        value
        for category in placed_categories
        for value in COMPLEMENTS.get(category, [])
    }
    return ordered, complements


def _reason(reason_codes: list[str], asset: dict, request: dict, placed_categories: list[str]) -> str:
    category = _asset_category(asset) or "家具"
    styles = _tags(asset, "styles")
    colors = _tags(asset, "colors")
    materials = _tags(asset, "materials")
    if "missing_category" in reason_codes and "style_match" in reason_codes:
        return f"补齐当前空间缺少的{category}，并延续现有{styles[0] if styles else '整体'}风格。"
    if "same_video" in reason_codes and "color_match" in reason_codes:
        return "和当前房间来自同一个视频方案，颜色也能衔接现有家具。"
    if "functional_complement" in reason_codes:
        anchor = placed_categories[0] if placed_categories else "现有家具"
        material = materials[0] if "material_match" in reason_codes and materials else ""
        return f"适合作为{anchor}的配套{category}，并呼应现有{material}材质。" if material else f"适合作为{anchor}的配套{category}，补齐当前空间功能。"
    if "style_match" in reason_codes:
        return f"延续当前空间的{styles[0] if styles else '主要'}风格，适合作为{category}补位。"
    if "color_match" in reason_codes:
        return f"{colors[0] if colors else '现有'}色调能衔接当前家具，适合作为{category}补位。"
    if "material_match" in reason_codes:
        return f"{materials[0] if materials else '现有'}材质与当前家具呼应，适合作为{category}补位。"
    if "same_video" in reason_codes:
        return "和当前房间来自同一个视频方案，可继续沿用这套搭配。"
    return f"来自当前目录中较常出现的{category}，适合作为起步选择。"


def _select_diverse(ranked: list[dict], limit: int, mode: str, source_video_id: str, complement_categories: set[str]) -> list[dict]:
    if mode == "replacement":
        picked: list[dict] = []
        same_video_count = 0
        for item in ranked:
            is_same_video = bool(source_video_id and item["videoId"] == source_video_id)
            if is_same_video and same_video_count >= 2:
                continue
            picked.append(item)
            same_video_count += int(is_same_video)
            if len(picked) >= limit:
                return picked
        return picked

    picked = []
    category_counts: dict[str, int] = {}
    same_video_count = 0

    def can_take(item: dict, *, distinct: bool, relax_category: bool = False) -> bool:
        nonlocal same_video_count
        if item in picked:
            return False
        if source_video_id and item["videoId"] == source_video_id and same_video_count >= 2:
            return False
        category_count = category_counts.get(item["category"], 0)
        if distinct and category_count:
            return False
        return relax_category or category_count < 2

    def take(item: dict) -> None:
        nonlocal same_video_count
        picked.append(item)
        category_counts[item["category"]] = category_counts.get(item["category"], 0) + 1
        same_video_count += int(bool(source_video_id and item["videoId"] == source_video_id))

    # Guarantee one evidence-backed complement when such candidates exist.
    complement = next((item for item in ranked if item["category"] in complement_categories), None)
    if complement:
        take(complement)
    for item in ranked:
        if len(picked) >= min(4, limit):
            break
        if can_take(item, distinct=True):
            take(item)
    for item in ranked:
        if len(picked) >= limit:
            break
        if can_take(item, distinct=False):
            take(item)
    for item in ranked:
        if len(picked) >= limit:
            break
        if can_take(item, distinct=False, relax_category=True):
            take(item)
    return picked


def recommend_from_catalog(assets: list[dict], request: dict, intent: dict) -> list[dict]:
    mode = str(intent.get("mode") or request.get("mode") or "proactive")
    selected_id = str(request.get("selectedItemId") or "")
    selected = next((asset for asset in assets if asset.get("asset_id") == selected_id), None)
    placed_ids = set(_strings(request.get("placedItemIds")))
    seen_ids = set(_strings(request.get("seenItemIds")))
    excluded_ids = placed_ids | seen_ids | ({selected_id} if selected_id else set())
    placed_categories = [_canonical_category(value) for value in _strings(request.get("categories"))]
    if selected and mode == "replacement" and not request.get("targetCategory"):
        request = {**request, "targetCategory": _asset_category(selected)}
    room = _room_key(str(intent.get("room") or request.get("room") or ""))
    target_categories, complement_categories = _target_categories(mode, request, room, placed_categories)
    styles = _strings(request.get("styles")) + _strings(intent.get("styles"))
    colors = _strings(request.get("colors")) + _strings(intent.get("colors"))
    materials = _strings(request.get("materials"))
    source_video_id = str(request.get("sourceVideoId") or "")
    limit = max(1, min(20, int(request.get("limit") or 6)))

    eligible = [
        asset for asset in assets
        if asset.get("status") == "ready"
        and asset.get("asset_id")
        and str(asset["asset_id"]) not in excluded_ids
    ]
    if mode == "replacement":
        target = target_categories[0] if target_categories else ""
        eligible = [asset for asset in eligible if target and _asset_category(asset) == target]
    max_appearances = max((int(asset.get("appearance_count") or 0) for asset in eligible), default=0)

    ranked: list[dict] = []
    for asset in eligible:
        asset_id = str(asset["asset_id"])
        category = _asset_category(asset)
        target_index = target_categories.index(category) if category in target_categories else -1
        reason_codes: list[str] = []
        score = 0.0
        if target_index >= 0:
            score += max(6, 34 - target_index * 4)
            reason_codes.append("functional_complement")
        if category not in placed_categories and target_index >= 0:
            score += 14
            reason_codes.append("missing_category")
        asset_video_id = _asset_video_id(asset)
        if source_video_id and asset_video_id == source_video_id:
            score += 20
            reason_codes.append("same_video")
        style_matches = min(2, _overlap(_tags(asset, "styles"), styles))
        color_matches = min(2, _overlap(_tags(asset, "colors"), colors))
        material_matches = min(2, _overlap(_tags(asset, "materials"), materials))
        if style_matches:
            score += style_matches * 14
            reason_codes.append("style_match")
        if color_matches:
            score += color_matches * 9
            reason_codes.append("color_match")
        if material_matches:
            score += material_matches * 7
            reason_codes.append("material_match")
        media = _media(asset)
        if media.get("thumbnail"):
            score += 4
        if media.get("model_3d"):
            score += 2
        appearances = int(asset.get("appearance_count") or 0)
        if max_appearances:
            score += appearances / max_appearances * 8
        if not reason_codes:
            reason_codes.append("popular_fallback")
        ranked.append({
            "asset": asset,
            "id": asset_id,
            "category": category,
            "videoId": asset_video_id,
            "score": score,
            "reasonCodes": reason_codes,
        })
    ranked.sort(key=lambda item: (-item["score"], item["id"]))
    selected_items = _select_diverse(ranked, limit, mode, source_video_id, complement_categories)

    output = []
    for item in selected_items:
        asset = item["asset"]
        category, subcategory = _classification(asset)
        media = _media(asset)
        output.append({
            "id": asset["asset_id"],
            "name": asset.get("name") or "未命名家具",
            "category": _canonical_category(category),
            "subCategory": subcategory,
            "colors": _tags(asset, "colors"),
            "materials": _tags(asset, "materials"),
            "styles": _tags(asset, "styles"),
            "thumbnail": media.get("thumbnail") or "",
            "modelUrl": media.get("model_3d") or "",
            "contextImage": media.get("context") or "",
            "trialAvailable": bool(media.get("model_3d")),
            "score": round(item["score"], 2),
            "reasonCodes": item["reasonCodes"],
            "reason": _reason(item["reasonCodes"], asset, request, placed_categories),
        })
    return output


async def recommend(request: dict, catalog_path: Path) -> dict:
    rule_intent = parse_intent_with_rules(str(request.get("query") or ""), str(request.get("mode") or ""))
    intent = await parse_intent(str(request.get("query") or ""), rule_intent)
    mode = str(intent.get("mode") or request.get("mode") or "")
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
    seen = list(dict.fromkeys(_strings(request.get("seenItemIds")) + [item["id"] for item in items]))
    set_seed = json.dumps({"request": request, "items": [item["id"] for item in items]}, ensure_ascii=False, sort_keys=True)
    set_id = hashlib.sha256(set_seed.encode("utf-8")).hexdigest()[:12]
    return {
        "clarificationRequired": False,
        "clarificationQuestion": None,
        "intent": intent,
        "recommendationSetId": f"rec_{set_id}",
        "items": items,
        "nextSeenItemIds": seen,
        "strategyVersion": "structured-multirecall-v1",
        "catalogSize": len(catalog["assets"]),
    }
