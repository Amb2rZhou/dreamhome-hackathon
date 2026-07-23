"""拍一张(photo) → 3D 前的预处理链：单体化(抠图) → 补全 → 单体闸 → 一致性闸。

与离线视频管线(pipeline/run.py)同一套强制 SOP，但面向实时单张照片。
2026-07-23 接入：此前 /api/photo-to-3d 把原图直送 TRELLIS(漏了补全)，杂背景/遮挡直通几乎全废。

全链路以 ENHANCE_PROVIDER 为总开关，缺服务/key/rembg 时逐级降级直通：
  ENHANCE_PROVIDER=off (默认)      → 完全跳过，原图直送(与接入前行为一致)
  ENHANCE_PROVIDER=module/cmd      → 跑 单体化→补全→闸；补全服务(segment_api:8002)由队友起
无 rembg → 抠图直通原图；无 DASHSCOPE_API_KEY → 两道闸放行(skip)。任一环失败都不阻断生成。
"""
from typing import Optional, Tuple

from ..config import settings
from ..utils import workpath
from . import segment
from .enhance import enhance_cutout
from .consistency import check_solo, check_consistency


async def prepare_photo(
    image_path: str,
    *,
    category: str = "",
    bbox: Optional[Tuple[int, int, int, int]] = None,
) -> Tuple[str, dict]:
    """返回 (送入 3D 的图路径, 处理元信息)。任何一环未启用/失败都安全降级到更早一步的图。"""
    meta = {"prepped": False, "segmented": False, "enhanced": False,
            "solo": None, "consistent": None, "note": ""}

    # 总开关：补全未启用 → 原图直送 TRELLIS（接入前的既有行为，零变化）
    if settings.ENHANCE_PROVIDER == "off":
        meta["note"] = "enhance off, passthrough"
        return image_path, meta
    meta["prepped"] = True

    # 1) 单体化/抠图：主体从(可能杂乱的)背景抠出。无 rembg 时降级直通原图。
    try:
        cut = segment.isolate_object(image_path, workpath("photo-cut"), bbox=bbox)
    except Exception as e:  # noqa: BLE001 抠图失败不阻断
        cut, e_note = image_path, f"segment_err({type(e).__name__})"
        meta["note"] = e_note
    meta["segmented"] = cut != image_path

    # 2) 补全：抠图 → 干净完整产品图(补遮挡/去杂物)。off/失败 → 返回上一步图。
    #    识别品类作 prompt 约束方向，避免残缺图补全脑补错形态。
    enhanced = await enhance_cutout(cut, workpath("photo-enh", ".jpg"), category=category)
    meta["enhanced"] = enhanced != cut
    if not meta["enhanced"]:
        # 补全没产出新图(未启用/失败) → 用抠图结果(或原图)，无补全图可校验，跳过两道闸
        meta["note"] = (meta["note"] + "; " if meta["note"] else "") + "enhance passthrough"
        return cut, meta

    name = category or "这件家具"
    # 3) 单体闸：补全图必须只含目标家具一件(餐桌图残留椅子会被焊进3D)。无 key → 放行。
    solo, swhy = await check_solo(enhanced, name)
    if not solo:
        # 不单体 → 强化指令重试一次补全
        retry = await enhance_cutout(
            cut, workpath("photo-enh2", ".jpg"),
            category=f"{category},画面中只保留这一件家具，彻底移除旁边的其他家具和物体")
        if retry != cut:
            solo2, swhy2 = await check_solo(retry, name)
            if solo2:
                enhanced, solo, swhy = retry, True, swhy2
    meta["solo"] = solo
    if not solo:
        meta["note"] = f"solo gate fail: {swhy}"
        return cut, meta  # 仍不单体 → 退回抠图，别把杂物/别的家具焊进 3D

    # 4) 一致性闸(幻觉闸)：补全图必须还是原图那件家具。无 key → 放行。
    same, cwhy = await check_consistency(image_path, enhanced)
    meta["consistent"] = same
    if not same:
        meta["note"] = f"consistency gate fail: {cwhy}"
        return cut, meta  # 补全跑偏(脑补错形态) → 退回抠图

    meta["note"] = "enhanced ok"
    return enhanced, meta
