"""Build and validate the versioned DreamHome Feed manifest.

The runtime SQLite backend remains authoritative.  Checked-in published assets
and frontend appearance windows are compatibility inputs used when a demo
checkout does not carry the ignored runtime database.  No source is mutated.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sqlite3
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "dreamhome-feed-manifest/v1"
MANIFEST_VERSION = 1
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = REPO_ROOT / "backend/storage/dreamhome.db"
DEFAULT_CATALOG = REPO_ROOT / "web/prototype/pages/shared/library-assets.generated.js"
DEFAULT_SUPPLEMENTAL_CATALOG = REPO_ROOT / "backend/storage/feed/supplemental-assets.v1.json"
DEFAULT_AVAILABLE_ASSETS = REPO_ROOT / "src/availableAssets.generated.ts"
DEFAULT_FEED_SOURCE = REPO_ROOT / "src/types.ts"
DEFAULT_SCENE_DIR = REPO_ROOT / "backend/storage/scenes"
DEFAULT_HOME_TEMPLATES = REPO_ROOT / "web/prototype/pages/shared/default-homes.generated.js"


def _rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def _load_exported_json(path: Path, export_name: str) -> Any:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"export\s+const\s+{re.escape(export_name)}[^=]*=\s*", text)
    if not match:
        raise ValueError(f"cannot find {export_name} in {path}")
    try:
        value, _ = json.JSONDecoder().raw_decode(text, match.end())
        return value
    except json.JSONDecodeError:
        # Generated modules may compose one checked-in JSON array with an
        # imported canonical home (`[...LEGACY, DEFAULT_BEDROOM_HOME]`).  Use
        # Node only for that JavaScript expression; the common pure-JSON path
        # above stays dependency-free and deterministic.
        node = shutil.which("node")
        if not node:
            raise
        module_uri = path.resolve().as_uri()
        script = (
            f"import({json.dumps(module_uri)}).then(m => "
            f"process.stdout.write(JSON.stringify(m[{json.dumps(export_name)}])))"
        )
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise ValueError(
                f"cannot evaluate {export_name} in {path}: {result.stderr.strip()}"
            )
        return json.loads(result.stdout)


def _json_value(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _read_database(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"available": False, "path": _rel(path), "videos": [], "tracks": [], "assets": []}
    conn = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        tables = {
            row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }

        def rows(table: str) -> list[dict[str, Any]]:
            if table not in tables:
                return []
            return [dict(row) for row in conn.execute(f'SELECT * FROM "{table}"').fetchall()]

        return {
            "available": True,
            "path": _rel(path),
            "videos": rows("videos"),
            "tracks": rows("tracks"),
            "assets": rows("assets"),
        }
    finally:
        conn.close()


def _probe_duration(path: Path) -> float | None:
    ffprobe = shutil.which("ffprobe")
    if not path.exists():
        return None
    if ffprobe:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        try:
            if result.returncode == 0:
                return round(float(result.stdout.strip()), 3)
        except ValueError:
            pass

    # Minimal ISO BMFF fallback for demo environments without ffprobe.  The
    # movie header is tiny and its timescale/duration fields are stable across
    # mvhd version 0 and 1.  This reads metadata only and never rewrites media.
    data = path.read_bytes()
    marker = data.find(b"mvhd")
    if marker < 0:
        return None
    payload = marker + 4
    version = data[payload]
    try:
        if version == 0:
            timescale = int.from_bytes(data[payload + 12:payload + 16], "big")
            duration = int.from_bytes(data[payload + 16:payload + 20], "big")
        elif version == 1:
            timescale = int.from_bytes(data[payload + 20:payload + 24], "big")
            duration = int.from_bytes(data[payload + 24:payload + 32], "big")
        else:
            return None
    except IndexError:
        return None
    return round(duration / timescale, 3) if timescale else None


def _feed_videos(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    version_match = re.search(r"FEED_MEDIA_VERSION\s*=\s*'([^']+)'", text)
    media_version = version_match.group(1) if version_match else ""
    videos = [{
        "video_id": "home-1",
        "play_url": f"/videos/home-1.mp4?v={media_version}",
        "feed_source": "local",
    }]
    for video_id in re.findall(r"amberFeedVideo\('([^']+)'", text):
        videos.append({
            "video_id": video_id,
            "play_url": f"/prototype/assets/videos/{video_id}.mp4?v={media_version}",
            "feed_source": "amber",
        })
    return videos


def _catalog_assets(path: Path) -> list[dict[str, Any]]:
    items = _load_exported_json(path, "BACKEND_ASSETS")
    assets = []
    for item in items:
        kind, labels = item.get("type") or {}, item.get("labels") or {}
        video_id = item.get("video_id") or None
        assets.append({
            "asset_id": str(item["asset_id"]),
            "name": item.get("name") or "",
            "status": "ready",
            "labels": {
                "category": kind.get("category") or "",
                "sub": kind.get("subcategory") or "",
                "colors": labels.get("colors") or [],
                "materials": labels.get("materials") or [],
                "styles": labels.get("styles") or [],
            },
            "media": {
                "model_3d": item.get("model_url") or "",
                "thumbnail": item.get("thumbnail") or "",
                "context": item.get("frame_url") or "",
            },
            "source": {
                "source_type": item.get("source_type") or ("video" if video_id else "offline_photo"),
                "source_label": item.get("source_label") or "",
                "source_url": item.get("source_url") or "",
                "video_id": video_id,
                "track_id": None,
                "t_best": item.get("representative_sec"),
            },
            "record_source": _rel(path),
        })
    return assets


def _supplemental_assets(path: Path) -> list[dict[str, Any]]:
    """Load reviewed scene-only assets that are not part of the bulk catalog.

    These records still describe canonical, ready assets; keeping them in a
    checked-in JSON document lets backend validation and the static demo share
    the same IDs without teaching the validator how to execute TypeScript.
    """
    if not path.exists():
        return []
    items = json.loads(path.read_text(encoding="utf-8"))
    assets = []
    for item in items:
        assets.append({
            "asset_id": str(item["asset_id"]),
            "name": item.get("name") or "",
            "status": "ready",
            "labels": item.get("labels") or {},
            "media": item.get("media") or {},
            "source": item.get("source") or {},
            "tag_provenance": item.get("tag_provenance") or {},
            "record_source": _rel(path),
        })
    return assets


def _database_assets(rows: Iterable[dict[str, Any]], db_path: Path) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        source = _json_value(row.get("source_json"), {})
        result.append({
            "asset_id": row["asset_id"],
            "name": row.get("name") or "",
            "status": row.get("status") or "",
            "labels": _json_value(row.get("labels_json"), {}),
            "media": {
                "model_3d": row.get("glb_url") or "",
                "thumbnail": row.get("thumb_url") or "",
            },
            "source": source,
            "record_source": "runtime_database",
        })
    return result


def _track_quality(row: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    return {
        "confidence": row.get(f"{prefix}confidence"),
        "review_status": row.get(f"{prefix}review_status") or "unreviewed",
        "version": row.get(f"{prefix}version") or 1,
        "source": row.get(f"{prefix}source") or "legacy",
    }


def _database_tracks(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    tracks = []
    for row in rows:
        frames = _json_value(row.get("frames_json"), [])
        tracks.append({
            "track_id": row["track_id"],
            "video_id": row["video_id"],
            "category": row.get("category") or "",
            "t_start": row.get("t_start") or 0.0,
            "t_end": row.get("t_end") or 0.0,
            "best_frame_t": row.get("best_frame_t") or 0.0,
            "frames": frames,
            "asset_id": row.get("asset_id"),
            "quality": _track_quality(row),
            "binding_quality": _track_quality(row, "binding_"),
        })
    return sorted(tracks, key=lambda item: (item["video_id"], item["t_start"], item["track_id"]))


def _scenes(path: Path) -> list[dict[str, Any]]:
    scenes = []
    for source in sorted(path.glob("*.json")) if path.exists() else []:
        doc = json.loads(source.read_text(encoding="utf-8"))
        video_id = doc.get("video_id") or source.stem
        scenes.append({
            "scene_id": f"scene:{video_id}",
            "video_id": video_id,
            "title": doc.get("title") or "",
            "source_path": _rel(source),
            "room": doc.get("room"),
            "configuration": doc.get("cfg"),
            "items": [{
                "asset_id": item.get("id"),
                "track_id": item.get("track") if str(item.get("track", "")).startswith("trk_") else None,
                "source_track_label": item.get("track"),
                "t_best": item.get("t_best"),
                "placement": {
                    key: item.get(key) for key in ("pos", "rotYDeg", "targetW", "mount")
                    if key in item
                },
            } for item in doc.get("items", [])],
        })
    return scenes


def _home_templates(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    templates = []
    for item in _load_exported_json(path, "DEFAULT_HOMES"):
        source = item.get("source") or {}
        templates.append({
            "template_id": item.get("id"),
            "schema_version": item.get("schemaVersion"),
            "name": item.get("name") or "",
            "video_id": source.get("videoId"),
            "source_type": source.get("type") or "",
            "source_path": _rel(path),
            "asset_ids": [
                placement.get("assetId")
                for placement in item.get("placements", [])
                if placement.get("assetId")
            ],
        })
    return templates


def _source_snapshot(paths: Iterable[Path]) -> list[dict[str, Any]]:
    snapshot = []
    for path in sorted({p.resolve() for p in paths if p.exists()}):
        snapshot.append({
            "path": _rel(path),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        })
    return snapshot


def build_manifest(*, db_path: Path = DEFAULT_DB, catalog_path: Path = DEFAULT_CATALOG,
                   supplemental_catalog_path: Path = DEFAULT_SUPPLEMENTAL_CATALOG,
                   available_assets_path: Path = DEFAULT_AVAILABLE_ASSETS,
                   feed_source_path: Path = DEFAULT_FEED_SOURCE,
                   scene_dir: Path = DEFAULT_SCENE_DIR,
                   home_templates_path: Path = DEFAULT_HOME_TEMPLATES) -> dict[str, Any]:
    database = _read_database(db_path)
    catalog = _catalog_assets(catalog_path)
    supplemental_assets = _supplemental_assets(supplemental_catalog_path)
    db_assets = _database_assets(database["assets"], db_path)
    # Published catalog is a fallback projection. Runtime rows always win.
    assets_by_id = {asset["asset_id"]: asset for asset in catalog}
    assets_by_id.update({asset["asset_id"]: asset for asset in supplemental_assets})
    assets_by_id.update({asset["asset_id"]: asset for asset in db_assets})
    assets = sorted(assets_by_id.values(), key=lambda item: item["asset_id"])

    feed_videos = _feed_videos(feed_source_path)
    videos_by_id = {video["video_id"]: video for video in feed_videos}
    for row in database["videos"]:
        current = videos_by_id.setdefault(row["video_id"], {"video_id": row["video_id"]})
        current.update({
            "title": row.get("title") or current.get("title", ""),
            "source_url": row.get("source_url") or current.get("source_url", ""),
            "play_url": row.get("play_url") or current.get("play_url", ""),
            "cover_url": row.get("cover_url") or current.get("cover_url", ""),
            "duration": row.get("duration") or current.get("duration"),
            "status": row.get("status") or "",
            "index_source": row.get("index_source") or "",
        })

    for asset in catalog:
        video_id = asset["source"].get("video_id")
        if video_id:
            videos_by_id.setdefault(video_id, {"video_id": video_id, "feed_source": "catalog"})

    scenes = _scenes(scene_dir)
    templates = _home_templates(home_templates_path)
    for scene in scenes:
        videos_by_id.setdefault(scene["video_id"], {"video_id": scene["video_id"], "feed_source": "scene"})
    for template in templates:
        video_id = template.get("video_id")
        if video_id:
            videos_by_id.setdefault(video_id, {"video_id": video_id, "feed_source": "home_template"})

    scene_refs: dict[str, list[str]] = {}
    template_refs: dict[str, list[str]] = {}
    for scene in scenes:
        scene_refs.setdefault(scene["video_id"], []).append(scene["scene_id"])
    for template in templates:
        if template.get("video_id"):
            template_refs.setdefault(template["video_id"], []).append(template["template_id"])

    media_paths: list[Path] = []
    for video_id, video in videos_by_id.items():
        if not video.get("duration"):
            media_path = (REPO_ROOT / "public/videos/home-1.mp4" if video_id == "home-1"
                          else REPO_ROOT / f"web/prototype/assets/videos/{video_id}.mp4")
            video["duration"] = _probe_duration(media_path)
            video["media_path"] = _rel(media_path)
            media_paths.append(media_path)
        video["scene_refs"] = scene_refs.get(video_id, [])
        video["same_home_template_refs"] = template_refs.get(video_id, [])
    videos = sorted(videos_by_id.values(), key=lambda item: item["video_id"])

    tracks = _database_tracks(database["tracks"])
    appearances = []
    track_bound_keys: set[tuple[str, str]] = set()
    for track in tracks:
        if not track.get("asset_id"):
            continue
        track_bound_keys.add((track["video_id"], track["asset_id"]))
        appearances.append({
            "appearance_id": f"track:{track['track_id']}",
            "video_id": track["video_id"],
            "asset_id": track["asset_id"],
            "track_id": track["track_id"],
            "start_sec": track["t_start"],
            "end_sec": track["t_end"],
            "representative_sec": track["best_frame_t"],
            "frames": track["frames"],
            "quality": track["binding_quality"],
            "source": "tracks",
        })

    frontend_assets = _load_exported_json(available_assets_path, "AVAILABLE_ASSETS")
    for item in frontend_assets:
        source_video = item.get("sourceVideo") or {}
        video_id = source_video.get("videoId")
        if not video_id or (video_id, item["id"]) in track_bound_keys:
            continue
        for index, appearance in enumerate(source_video.get("appearances") or []):
            appearances.append({
                "appearance_id": f"frontend:{video_id}:{item['id']}:{index}",
                "video_id": video_id,
                "asset_id": item["id"],
                "track_id": None,
                "start_sec": appearance.get("startSec"),
                "end_sec": appearance.get("endSec"),
                "representative_sec": appearance.get("representativeSec"),
                "frames": [],
                "quality": {
                    "confidence": None,
                    "review_status": "unreviewed",
                    "version": 1,
                    "source": _rel(available_assets_path),
                },
                "source": "frontend_compatibility",
            })
    appearances.sort(key=lambda item: (
        item["video_id"], item.get("start_sec") or 0, item["asset_id"], item["appearance_id"]
    ))

    source_paths = [catalog_path, supplemental_catalog_path, available_assets_path,
                    feed_source_path, home_templates_path]
    source_paths.extend(media_paths)
    source_paths.extend(Path(scene["source_path"]) if Path(scene["source_path"]).is_absolute()
                        else REPO_ROOT / scene["source_path"] for scene in scenes)
    if database["available"] and db_path.resolve().is_relative_to(REPO_ROOT.resolve()):
        source_paths.append(db_path)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "manifest_version": MANIFEST_VERSION,
        "source_policy": {
            "canonical_precedence": ["runtime_database", "published_catalog"],
            "appearance_precedence": ["tracks", "frontend_compatibility"],
            "runtime_database_available": database["available"],
            "runtime_tracks_available": bool(database["tracks"]),
            "runtime_database_path": "runtime_database" if database["available"] else database["path"],
        },
        "source_snapshot": _source_snapshot(source_paths),
        "videos": videos,
        "scenes": scenes,
        "tracks": tracks,
        "canonical_assets": assets,
        "appearances": appearances,
        "same_home_templates": templates,
    }
    canonical = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    manifest["content_version"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return manifest


def _valid_bbox(value: Any) -> bool:
    if not isinstance(value, list) or len(value) != 4:
        return False
    if not all(isinstance(part, (int, float)) for part in value):
        return False
    x, y, width, height = value
    return x >= 0 and y >= 0 and width > 0 and height > 0 and x + width <= 1 and y + height <= 1


def validate_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []

    def add(code: str, severity: str, entity_type: str, entity_id: str, message: str) -> None:
        issues.append({"code": code, "severity": severity, "entity_type": entity_type,
                       "entity_id": entity_id, "message": message})

    videos = {item["video_id"]: item for item in manifest.get("videos", [])}
    assets = {item["asset_id"]: item for item in manifest.get("canonical_assets", [])}
    tracks = {item["track_id"]: item for item in manifest.get("tracks", [])}
    scenes = {item["scene_id"]: item for item in manifest.get("scenes", [])}
    templates = {item["template_id"]: item for item in manifest.get("same_home_templates", [])}

    mapping_keys: Counter[tuple[Any, ...]] = Counter()
    untracked_compat = 0
    for appearance in manifest.get("appearances", []):
        entity_id = appearance["appearance_id"]
        video_id, asset_id, track_id = appearance.get("video_id"), appearance.get("asset_id"), appearance.get("track_id")
        if video_id not in videos:
            add("ORPHAN_MAPPING", "error", "appearance", entity_id, f"video {video_id} does not exist")
        if asset_id not in assets:
            add("MISSING_ASSET", "error", "appearance", entity_id, f"asset {asset_id} does not exist")
        elif assets[asset_id].get("status") != "ready":
            add("NON_READY_ASSET", "error", "appearance", entity_id,
                f"asset {asset_id} status is {assets[asset_id].get('status')}")
        if track_id and track_id not in tracks:
            add("ORPHAN_MAPPING", "error", "appearance", entity_id, f"track {track_id} does not exist")
        if not track_id and appearance.get("source") == "frontend_compatibility":
            untracked_compat += 1
        key = (video_id, track_id, asset_id, appearance.get("start_sec"), appearance.get("end_sec"))
        mapping_keys[key] += 1

        start, end, representative = (appearance.get("start_sec"), appearance.get("end_sec"),
                                      appearance.get("representative_sec"))
        duration = videos.get(video_id, {}).get("duration")
        if not all(isinstance(value, (int, float)) for value in (start, end, representative)) or start > end or not start <= representative <= end:
            add("INVALID_TIME_RANGE", "error", "appearance", entity_id,
                f"invalid interval start={start}, representative={representative}, end={end}")
        elif duration is not None and (start < 0 or end > duration):
            add("TIME_OUT_OF_BOUNDS", "error", "appearance", entity_id,
                f"interval [{start}, {end}] exceeds video duration {duration}")
        for frame_index, frame in enumerate(appearance.get("frames") or []):
            if not _valid_bbox(frame.get("bbox")):
                add("INVALID_BBOX", "error", "appearance", entity_id,
                    f"frame {frame_index} has invalid normalized bbox {frame.get('bbox')}")
            if isinstance(duration, (int, float)) and not 0 <= frame.get("t", -1) <= duration:
                add("TIME_OUT_OF_BOUNDS", "error", "appearance", entity_id,
                    f"frame {frame_index} time {frame.get('t')} exceeds video duration {duration}")

        if track_id in tracks and asset_id in assets:
            track = tracks[track_id]
            asset_video = (assets[asset_id].get("source") or {}).get("video_id")
            if track.get("video_id") != video_id:
                add("CROSS_VIDEO_BINDING", "error", "appearance", entity_id,
                    f"track belongs to {track.get('video_id')}, appearance belongs to {video_id}")
            if asset_video and asset_video != video_id and track.get("binding_quality", {}).get("review_status") != "approved":
                add("CROSS_VIDEO_BINDING", "error", "appearance", entity_id,
                    f"asset source video is {asset_video}, binding video is {video_id}")

    for key, count in mapping_keys.items():
        if count > 1:
            add("DUPLICATE_MAPPING", "error", "appearance", str(key),
                f"the exact mapping occurs {count} times")

    # A checkout can legitimately carry the lightweight ignored SQLite file
    # without the production track snapshot. In that mode compatibility
    # appearances are the declared source of truth, not unverifiable residue.
    # Keep warning when at least one runtime track exists, because then a
    # partially migrated binding set is actionable.
    if untracked_compat and tracks:
        add("UNTRACKED_COMPATIBILITY_APPEARANCES", "warning", "manifest", "appearances",
            f"{untracked_compat} frontend compatibility appearances cannot be verified against runtime tracks")

    for track in tracks.values():
        if track.get("video_id") not in videos:
            add("ORPHAN_MAPPING", "error", "track", track["track_id"],
                f"video {track.get('video_id')} does not exist")
        if track.get("asset_id") and track["asset_id"] not in assets:
            add("MISSING_ASSET", "error", "track", track["track_id"],
                f"asset {track['asset_id']} does not exist")
        for index, frame in enumerate(track.get("frames") or []):
            if not _valid_bbox(frame.get("bbox")):
                add("INVALID_BBOX", "error", "track", track["track_id"],
                    f"frame {index} has invalid normalized bbox {frame.get('bbox')}")

    for scene in scenes.values():
        if scene.get("video_id") not in videos:
            add("MISSING_SCENE", "error", "scene", scene["scene_id"],
                f"scene video {scene.get('video_id')} does not exist")
        for item in scene.get("items", []):
            asset_id, track_id = item.get("asset_id"), item.get("track_id")
            if asset_id not in assets:
                add("MISSING_ASSET", "error", "scene", scene["scene_id"], f"asset {asset_id} does not exist")
            elif assets[asset_id].get("status") != "ready":
                add("NON_READY_ASSET", "error", "scene", scene["scene_id"], f"asset {asset_id} is not ready")
            if track_id and tracks and track_id not in tracks:
                add("ORPHAN_MAPPING", "warning", "scene", scene["scene_id"],
                    f"track {track_id} is unavailable in the runtime snapshot")

    for template in templates.values():
        video_id = template.get("video_id")
        if video_id not in videos:
            add("MISSING_SCENE", "error", "home_template", template["template_id"],
                f"template video {video_id} does not exist")
        for asset_id in template.get("asset_ids", []):
            if asset_id not in assets:
                add("MISSING_ASSET", "error", "home_template", template["template_id"],
                    f"asset {asset_id} does not exist")
            elif assets[asset_id].get("status") != "ready":
                add("NON_READY_ASSET", "error", "home_template", template["template_id"],
                    f"asset {asset_id} is not ready")
        if video_id and not videos.get(video_id, {}).get("scene_refs"):
            add("MISSING_SCENE", "warning", "home_template", template["template_id"],
                f"video {video_id} has a same-home template but no backend scene document")

    for video in videos.values():
        for ref in video.get("scene_refs", []):
            if ref not in scenes:
                add("MISSING_SCENE", "error", "video", video["video_id"], f"scene ref {ref} does not exist")
        for ref in video.get("same_home_template_refs", []):
            if ref not in templates:
                add("MISSING_SCENE", "error", "video", video["video_id"], f"home template ref {ref} does not exist")

    counts = Counter(issue["severity"] for issue in issues)
    by_code = Counter(issue["code"] for issue in issues)
    return {
        "schema_version": "dreamhome-feed-validation/v1",
        "manifest_schema_version": manifest.get("schema_version"),
        "manifest_content_version": manifest.get("content_version"),
        "mode": "read_only",
        "valid": counts["error"] == 0,
        "summary": {
            "errors": counts["error"],
            "warnings": counts["warning"],
            "issues_by_code": dict(sorted(by_code.items())),
            "entities": {
                "videos": len(videos),
                "scenes": len(scenes),
                "tracks": len(tracks),
                "canonical_assets": len(assets),
                "appearances": len(manifest.get("appearances", [])),
                "same_home_templates": len(templates),
            },
        },
        "issues": issues,
    }


def write_json(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
