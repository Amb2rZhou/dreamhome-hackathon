"""Prepare a photographed furniture object before sending it to 3D generation.

The photo workflow uses the same quality gates as the video workflow:
isolate one object, complete occluded regions, verify that the completed image
contains one object, then verify identity against the original photograph.
When completion is disabled or a stage fails, the workflow safely falls back
to the latest trustworthy image instead of inventing a second generation path.
"""
import asyncio
from typing import Optional, Tuple

from ..config import settings
from ..utils import workpath
from . import segment
from .consistency import check_consistency, check_solo
from .enhance import enhance_cutout


async def prepare_photo(
    image_path: str,
    *,
    category: str = "",
    bbox: Optional[Tuple[int, int, int, int]] = None,
) -> Tuple[str, dict]:
    """Return the image to generate from and secret-free preparation metadata."""
    meta = {
        "prepped": False,
        "segmented": False,
        "enhanced": False,
        "solo": None,
        "consistent": None,
        "note": "",
    }
    if settings.ENHANCE_PROVIDER == "off":
        meta["note"] = "enhance off, passthrough"
        return image_path, meta

    meta["prepped"] = True
    try:
        # rembg/remote segmentation can be CPU- or network-bound. Keep it off
        # FastAPI's event loop so job polling and health checks stay responsive.
        cut = await asyncio.to_thread(
            segment.isolate_object,
            image_path,
            workpath("photo-cut"),
            bbox=bbox,
        )
    except Exception as exc:  # A segmentation outage must not lose the upload.
        cut = image_path
        meta["note"] = f"segment_err({type(exc).__name__})"
    meta["segmented"] = cut != image_path

    try:
        enhanced = await enhance_cutout(
            cut,
            workpath("photo-enh", ".jpg"),
            category=category,
        )
    except Exception as exc:
        enhanced = cut
        suffix = f"enhance_err({type(exc).__name__})"
        meta["note"] = f"{meta['note']}; {suffix}" if meta["note"] else suffix
    meta["enhanced"] = enhanced != cut
    if not meta["enhanced"]:
        suffix = "enhance passthrough"
        meta["note"] = f"{meta['note']}; {suffix}" if meta["note"] else suffix
        return cut, meta

    name = category or "这件家具"
    try:
        solo, solo_reason = await check_solo(enhanced, name)
    except Exception as exc:
        solo, solo_reason = False, f"{type(exc).__name__}: {exc}"
    if not solo:
        try:
            retry = await enhance_cutout(
                cut,
                workpath("photo-enh2", ".jpg"),
                category=(
                    f"{category},画面中只保留这一件家具，"
                    "彻底移除旁边的其他家具和物体"
                ),
            )
            if retry != cut:
                retry_solo, retry_reason = await check_solo(retry, name)
                if retry_solo:
                    enhanced, solo, solo_reason = retry, True, retry_reason
        except Exception:
            pass
    meta["solo"] = solo
    if not solo:
        meta["note"] = f"solo gate fail: {solo_reason}"
        return cut, meta

    try:
        same, consistency_reason = await check_consistency(image_path, enhanced)
    except Exception as exc:
        same, consistency_reason = False, f"{type(exc).__name__}: {exc}"
    meta["consistent"] = same
    if not same:
        meta["note"] = f"consistency gate fail: {consistency_reason}"
        return cut, meta

    meta["note"] = "enhanced ok"
    return enhanced, meta
