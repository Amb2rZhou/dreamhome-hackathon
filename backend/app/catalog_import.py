"""Import the published prototype catalog into the canonical asset database.

The generated JavaScript manifest is a deployment artifact, not a second
database.  This adapter makes those already-produced GLBs discoverable by the
production matching API while preserving their stable ``asset_id`` values.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from . import db

_MANIFEST_START_RE = re.compile(r"export\s+const\s+BACKEND_ASSETS\s*=\s*")


def load_generated_manifest(path: Path) -> list[dict[str, Any]]:
    source = path.read_text(encoding="utf-8")
    match = _MANIFEST_START_RE.search(source)
    if not match:
        raise ValueError(f"unsupported catalog manifest: {path}")
    # ``raw_decode`` reads exactly one JSON value after the known assignment;
    # comments before the export are harmless and arbitrary JavaScript is
    # never evaluated.
    payload, end = json.JSONDecoder().raw_decode(source, match.end())
    if source[end:].strip() not in {"", ";"}:
        raise ValueError("unexpected content after BACKEND_ASSETS")
    if not isinstance(payload, list):
        raise ValueError("BACKEND_ASSETS must be a JSON array")
    return payload


def _published_url(value: Any, public_base_url: str) -> str:
    if not value:
        return ""
    value = str(value)
    if value.startswith(("https://", "http://")):
        return value
    marker = "assets/"
    if marker not in value:
        raise ValueError(f"catalog media path is outside prototype assets: {value}")
    suffix = value.split(marker, 1)[1].lstrip("/")
    return f"{public_base_url.rstrip('/')}/prototype/assets/{suffix}"


def canonical_asset_fields(item: dict[str, Any], public_base_url: str) -> dict[str, Any]:
    kind = item.get("type") or {}
    raw_labels = item.get("labels") or {}
    labels = {
        "category": kind.get("category") or "",
        "sub": kind.get("subcategory") or "",
        "colors": list(raw_labels.get("colors") or []),
        "materials": list(raw_labels.get("materials") or []),
        "styles": list(raw_labels.get("styles") or []),
        "features": list(raw_labels.get("features") or []),
        "size_class": raw_labels.get("size_class") or "",
    }
    video_id = item.get("video_id") or ""
    t_best = item.get("representative_sec")
    source = {
        "video_id": video_id,
        "track_id": "",
        "t_best": float(t_best) if t_best is not None else 0.0,
        "source_type": item.get("source_type") or ("video" if video_id else "offline_photo"),
        "source_label": item.get("source_label") or "",
        "source_url": item.get("source_url") or "",
        "frame_url": _published_url(item.get("frame_url"), public_base_url),
    }
    size_prior = {
        "physical_size_m": item.get("physical_size_m") or {},
        "dimensions_model_unit": item.get("dimensions_model_unit") or [],
        "size_status": item.get("size_status") or "missing",
    }
    return {
        "asset_id": str(item["asset_id"]),
        "name": item.get("name") or labels["sub"] or labels["category"],
        "labels": labels,
        "size_prior": size_prior,
        "glb_url": _published_url(item.get("model_url"), public_base_url),
        "thumb_url": _published_url(item.get("thumbnail"), public_base_url),
        "source": source,
        "status": "ready",
        "created_by": "published_catalog",
    }


def import_catalog(items: list[dict[str, Any]], public_base_url: str, *,
                   database: Any = db, dry_run: bool = False) -> dict[str, int]:
    """Insert missing videos/assets; never overwrite an existing canonical row."""
    counts = {"assets_total": len(items), "assets_inserted": 0,
              "assets_existing": 0, "videos_inserted": 0}
    videos: dict[str, dict[str, Any]] = {}
    for item in items:
        fields = canonical_asset_fields(item, public_base_url)
        video_id = fields["source"]["video_id"]
        if video_id:
            video = videos.setdefault(video_id, {
                "video_id": video_id,
                "title": "刷一刷素材",
                "source_url": item.get("source_url") or "",
                "play_url": _published_url(item.get("video_url"), public_base_url),
                "cover_url": fields["source"]["frame_url"],
                "duration": 0.0,
                "status": "unindexed",
                "index_source": "published_catalog",
            })
            t_best = item.get("representative_sec")
            if t_best is not None:
                video["duration"] = max(video["duration"], float(t_best) + 1.0)
        if database.get_asset(fields["asset_id"]):
            counts["assets_existing"] += 1
        elif not dry_run:
            database.insert_asset(**fields)
            counts["assets_inserted"] += 1
        else:
            counts["assets_inserted"] += 1

    for video_id, fields in videos.items():
        if database.get_video(video_id):
            continue
        if not dry_run:
            database.insert_video(**fields)
        counts["videos_inserted"] += 1
    return counts
