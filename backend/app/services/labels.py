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

_PROMPT_FRAMED = """你是家具识别标注器。图中**红框**标出了一个物体(周围是它所在的环境,仅供参考)。
只针对红框内的物体，输出 JSON(仅 JSON，无其他文字)：
{"category": "沙发|单椅|床|柜子|桌子|灯具|地毯|绿植|窗帘|装饰|卫浴|家电|其他 之一",
 "sub": "更细的子品类，如 三人沙发/吊灯/边柜",
 "colors": ["主要颜色，最多3个"],
 "materials": ["材质，如 布艺/皮革/实木/金属/藤编/玻璃"],
 "styles": ["风格，如 现代/北欧/复古/奶油风/工业风"],
 "features": ["形态特征，如 圆弧扶手/细腿/簇绒/带抽屉，最多5个"],
 "size_class": "小|中|大 之一，按该品类常规体量判断",
 "complete": "true|false，红框内物体主体是否完整可见：无被遮挡、未被画面截断"}"""

_PROMPT = """你是家具识别标注器。观察图中的主体家具，输出 JSON(仅 JSON，无其他文字)：
{"category": "沙发|单椅|床|柜子|桌子|灯具|地毯|绿植|窗帘|装饰|卫浴|家电|其他 之一",
 "sub": "更细的子品类，如 三人沙发/吊灯/边柜",
 "colors": ["主要颜色，最多3个"],
 "materials": ["材质，如 布艺/皮革/实木/金属/藤编/玻璃"],
 "styles": ["风格，如 现代/北欧/复古/奶油风/工业风"],
 "features": ["形态特征，如 圆弧扶手/细腿/簇绒/带抽屉，最多5个"],
 "size_class": "小|中|大 之一，按该品类常规体量判断",
 "complete": "true|false，该家具主体是否完整可见：无被墙/其他物体明显遮挡、未被画面边缘截断、无大面积缺失"}"""

_EMPTY = {"category": "", "sub": "", "colors": [], "materials": [],
          "styles": [], "features": [], "size_class": "", "complete": False}


async def extract_labels(image_path: Optional[str] = None, *,
                         category_hint: str = "", framed: bool = False,
                         strict: bool = False) -> dict:
    """Extract structured labels.

    ``strict=True`` is reserved for consumer production paths.  Those paths
    must fail closed when the configured vision provider is unavailable or
    rejects the request; a mock category must never be allowed to approve a
    completion/TRELLIS job.
    """
    provider = settings.effective_labels_provider
    labels = None
    provider_error: Exception | None = None
    try:
        if provider in ("anthropic", "dashscope") and image_path:
            from . import cache
            key = cache.content_key(image_path, extra=f"labels|{provider}|{category_hint}|{framed}")
            hit = cache.get("labels", key)
            if hit:
                labels = hit["labels"]
            else:
                fn = _anthropic if provider == "anthropic" else _dashscope
                labels = await fn(image_path, category_hint, framed)
                cache.put("labels", key, {"labels": labels})
    except Exception as exc:
        labels = None
        provider_error = exc
    if labels is None:
        if strict:
            if provider not in ("anthropic", "dashscope"):
                raise RuntimeError("labels provider is unavailable for production")
            if not image_path:
                raise RuntimeError("labels production input image is missing")
            detail = f": {type(provider_error).__name__}" if provider_error else ""
            raise RuntimeError(f"labels provider failed for production{detail}") from provider_error
        labels = _mock(image_path, category_hint)
    labels["mount"] = assign_mount(labels)
    return labels


# ---- 挂载属性(3D 场景拖放方式): ceiling|wall|surface|floor ----
# 关键词按 category/sub/features/tags 拼串匹配;顺序即优先级。
_MOUNT_CEILING = ("吊灯", "吸顶灯", "吊扇", "吊饰", "风扇灯", "筒灯", "悬挂")
_MOUNT_WALL = ("挂画", "挂钟", "壁饰", "挂饰", "壁灯", "壁挂", "挂墙", "画框",
               "镜子", "壁龛", "空调")
_MOUNT_SURFACE = ("音乐盒", "台灯", "摆件", "花瓶", "花艺", "插花", "多肉", "干花")


def _match_mount(text: str, size_class: str, fallback: bool = False) -> str:
    ceiling = _MOUNT_CEILING if not fallback else tuple(k for k in _MOUNT_CEILING if k != "悬挂")
    if any(k in text for k in ceiling):
        return "ceiling"
    # features 里的"悬挂式"多指悬浮家具(如壁挂电视柜)→wall,非吊顶
    if any(k in text for k in _MOUNT_WALL) or (fallback and "悬挂" in text):
        return "wall"
    # fallback 层 surface 只认小件("桌面有摆件"这类描述不代表本体是摆件)
    if any(k in text for k in _MOUNT_SURFACE) and (not fallback or size_class == "小"):
        return "surface"
    # 小型盆栽当摆件吸附到台面;大盆栽落地
    if "盆栽" in text and size_class == "小":
        return "surface"
    return ""


def assign_mount(labels: dict) -> str:
    """返回 ceiling|wall|surface|floor。先看 category/sub(可信度高),
    sub 判不出再看 features/tags 关键词(描述性文本较噪,只作兜底)。"""
    size_class = str(labels.get("size_class", ""))
    sub_text = f"{labels.get('category', '')} {labels.get('sub', '')}"
    parts = []
    for k in ("features", "tags"):
        v = labels.get(k) or []
        parts.extend(str(x) for x in v) if isinstance(v, list) else parts.append(str(v))
    feat_text = " ".join(parts)
    # 空调默认按挂机→wall;全文任一处明确柜机/立式才落地
    full = f"{sub_text} {feat_text}"
    if "空调" in full and ("柜机" in full or "立式" in full):
        return "floor"
    mount = _match_mount(sub_text, size_class)
    if mount:
        return mount
    mount = _match_mount(feat_text, size_class, fallback=True)
    return mount or "floor"  # 床/沙发/桌椅/柜/地毯/门垫等默认贴地


CATEGORIES = {"沙发", "单椅", "床", "柜子", "桌子", "灯具", "地毯", "绿植", "窗帘", "装饰",
              "卫浴", "家电", "其他"}


def _parse_json(text: str, category_hint: str = "") -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    data = json.loads(m.group(0)) if m else {}
    out = dict(_EMPTY)
    for k in out:
        if k in data:
            out[k] = data[k]
    # 模型偶尔把整个枚举串回填 category("沙发|单椅|...")——校验兜底到检测品类
    if out["category"] not in CATEGORIES:
        out["category"] = category_hint if category_hint in CATEGORIES else "其他"
    # complete 可能回成字符串 "true"/"false";不确定按不完整处理(宁可多补全)
    out["complete"] = str(out.get("complete", "")).lower() == "true"
    return out


def _image_block_b64(image_path: str) -> tuple[str, str]:
    mime = mimetypes.guess_type(image_path)[0] or "image/jpeg"
    with open(image_path, "rb") as f:
        return mime, base64.b64encode(f.read()).decode()


async def _anthropic(image_path: str, category_hint: str = "", framed: bool = False) -> dict:
    mime, b64 = _image_block_b64(image_path)
    payload = {
        "model": settings.ANTHROPIC_MODEL,
        "max_tokens": 512,
        "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
            {"type": "text", "text": _PROMPT_FRAMED if framed else _PROMPT},
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
    return _parse_json("".join(b.get("text", "") for b in data.get("content", [])), category_hint)


async def _dashscope(image_path: str, category_hint: str = "", framed: bool = False) -> dict:
    mime, b64 = _image_block_b64(image_path)
    payload = {
        "model": settings.DASHSCOPE_VL_MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            {"type": "text", "text": _PROMPT_FRAMED if framed else _PROMPT},
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
    return _parse_json(data["choices"][0]["message"]["content"], category_hint)


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
