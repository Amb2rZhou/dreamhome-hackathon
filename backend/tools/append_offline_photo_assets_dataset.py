"""Append selected offline-photo assets to an existing exported dataset.

The regular dataset exporter publishes video-derived, human-reviewed assets.
This companion command keeps the same media bundle and record layout for
consumer photo assets while representing unavailable video provenance
honestly: ``video_id`` is null, ``appearances`` is empty, and manual review is
marked as not required.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
import shutil
import sqlite3
import struct
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


SOURCE_TYPE = "offline_photo"
SOURCE_LABEL = "线下拍照生成"
REQUIRED_MEDIA = ("context", "source_crop", "completed_input", "model_3d")
ASSET_ID_PATTERN = re.compile(r"^ast_[0-9a-f]+$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def iso_time(value: float | int | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(float(value), timezone.utc).isoformat()


def parse_json(value: str | None, fallback):
    return json.loads(value) if value else fallback


def local_storage_file(storage: Path, url: str) -> Path | None:
    path = urlparse(url or "").path
    if "/storage/" not in path:
        return None
    candidate = (storage / path.split("/storage/", 1)[1]).resolve()
    return candidate if candidate.is_file() and storage in candidate.parents else None


def validate_glb(path: Path) -> None:
    with path.open("rb") as stream:
        header = stream.read(12)
    if len(header) != 12:
        raise ValueError(f"truncated GLB: {path}")
    magic, version, declared_length = struct.unpack("<4sII", header)
    if magic != b"glTF" or version != 2 or declared_length != path.stat().st_size:
        raise ValueError(f"invalid GLB v2: {path}")


def copy_media(source: Path, destination: Path, dataset_root: Path,
               width: int | None = None, height: int | None = None) -> dict:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    mime = ("model/gltf-binary" if destination.suffix.lower() == ".glb"
            else mimetypes.guess_type(destination.name)[0] or "application/octet-stream")
    result = {
        "path": destination.relative_to(dataset_root).as_posix(),
        "mime_type": mime,
        "bytes": destination.stat().st_size,
        "sha256": sha256(destination),
    }
    if width:
        result["width_px"] = width
    if height:
        result["height_px"] = height
    return result


def load_asset(connection: sqlite3.Connection, asset_id: str) -> tuple[sqlite3.Row, dict]:
    row = connection.execute(
        """SELECT a.*,g.model_media_id,g.bounds_min_json,g.bounds_max_json,
                  g.dimensions_json,g.center_json,g.vertex_count,g.triangle_count,
                  g.collision_json,g.anchor_json,g.unit,g.parser_version,
                  g.updated_at AS geometry_updated_at
             FROM assets a
             JOIN asset_geometry g USING(asset_id)
            WHERE a.asset_id=?""",
        (asset_id,),
    ).fetchone()
    if not row:
        raise ValueError(f"{asset_id}: asset or geometry not found")
    if row["status"] != "ready":
        raise ValueError(f"{asset_id}: status must be ready")

    source = parse_json(row["source_json"], {})
    expected_empty = {
        "video_id": ("", None),
        "track_id": (None,),
        "t_best": (None,),
        "source_url": ("", None),
    }
    if source.get("source_type") != SOURCE_TYPE or source.get("source_label") != SOURCE_LABEL:
        raise ValueError(f"{asset_id}: offline-photo provenance is incomplete")
    for field, accepted in expected_empty.items():
        if source.get(field) not in accepted:
            raise ValueError(f"{asset_id}: {field} must be empty for an offline photo")
    appearance_count = connection.execute(
        "SELECT COUNT(*) FROM asset_video_segments WHERE asset_id=?", (asset_id,)
    ).fetchone()[0]
    if appearance_count:
        raise ValueError(f"{asset_id}: offline photo must not have video appearances")
    return row, source


def media_rows(connection: sqlite3.Connection, asset_id: str) -> dict[str, sqlite3.Row]:
    rows = {
        row["kind"]: row
        for row in connection.execute(
            """SELECT * FROM asset_media
                WHERE asset_id=? AND is_current=1
                  AND kind IN ('context','source_crop','completed_input','model_3d')""",
            (asset_id,),
        ).fetchall()
    }
    missing = [kind for kind in REQUIRED_MEDIA if kind not in rows]
    if missing:
        raise ValueError(f"{asset_id}: missing current media: {', '.join(missing)}")
    return rows


def build_record(connection: sqlite3.Connection, storage: Path, staging: Path,
                 asset_id: str) -> dict:
    row, _source = load_asset(connection, asset_id)
    rows = media_rows(connection, asset_id)
    files = {kind: local_storage_file(storage, rows[kind]["url"]) for kind in REQUIRED_MEDIA}
    missing = [kind for kind, path in files.items() if path is None]
    if missing:
        raise ValueError(f"{asset_id}: local media missing: {', '.join(missing)}")
    validate_glb(files["model_3d"])

    asset_dir = staging / "assets" / asset_id
    completed = files["completed_input"]
    media = {
        "context": copy_media(files["context"], asset_dir / "context.jpg", staging),
        "source_crop": copy_media(files["source_crop"], asset_dir / "source_crop.jpg", staging),
        "completed_input": copy_media(
            completed, asset_dir / f"completed_input{completed.suffix.lower()}", staging,
            rows["completed_input"]["width_px"], rows["completed_input"]["height_px"],
        ),
        "model_3d": copy_media(files["model_3d"], asset_dir / "model.glb", staging),
    }
    media["context"]["role"] = "recognition_context"
    # Paths are relative to the final dataset, not the temporary staging root.
    for item in media.values():
        item["path"] = f"assets/{asset_id}/{Path(item['path']).name}"

    labels = parse_json(row["labels_json"], {})
    size = parse_json(row["size_prior_json"], {})
    size_status = "known" if size else "missing"
    record = {
        "schema_version": 1,
        "availability": "available",
        "asset_id": asset_id,
        "source": {"type": SOURCE_TYPE, "label": SOURCE_LABEL, "url": None},
        "video_id": None,
        "appearances": [],
        "name": row["name"],
        "space": row["space"],
        "type": {
            "category": labels.get("category", ""),
            "subcategory": labels.get("sub", ""),
        },
        "labels": labels,
        "size_status": size_status,
        "physical_size_m": {
            "width": size.get("w"),
            "height": size.get("h"),
            "depth": size.get("d"),
        },
        "geometry": {
            "bounds_min": parse_json(row["bounds_min_json"], []),
            "bounds_max": parse_json(row["bounds_max_json"], []),
            "dimensions_model_unit": parse_json(row["dimensions_json"], []),
            "center": parse_json(row["center_json"], []),
            "vertex_count": row["vertex_count"],
            "triangle_count": row["triangle_count"],
            "collision": parse_json(row["collision_json"], {}),
            "anchor": parse_json(row["anchor_json"], {}),
            "unit": row["unit"],
            "parser_version": row["parser_version"],
            "updated_at": iso_time(row["geometry_updated_at"]),
        },
        "media": media,
        "review": {
            "verdict": "not_required",
            "reason": "C 端线下拍照生成资产，不需要人工审核",
            "reviewed_at": None,
        },
        "created_by": row["created_by"],
        "created_at": iso_time(row["created_at"]),
    }
    asset_dir.mkdir(parents=True, exist_ok=True)
    (asset_dir / "asset.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return record


def write_checksums(dataset: Path) -> None:
    lines = []
    for path in sorted(item for item in dataset.rglob("*") if item.is_file()):
        if path.name == "checksums.sha256":
            continue
        lines.append(f"{sha256(path)}  {path.relative_to(dataset).as_posix()}")
    (dataset / "checksums.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8")


def append(db_path: Path, storage: Path, dataset: Path, asset_ids: list[str]) -> None:
    db_path = db_path.resolve()
    storage = storage.resolve()
    dataset = dataset.resolve()
    manifest_path = dataset / "manifest.json"
    assets_root = dataset / "assets"
    if not db_path.is_file() or not storage.is_dir() or not manifest_path.is_file():
        raise SystemExit("database, storage, or existing dataset manifest not found")
    if len(asset_ids) != len(set(asset_ids)):
        raise SystemExit("asset IDs must be unique")
    invalid_ids = [asset_id for asset_id in asset_ids if not ASSET_ID_PATTERN.fullmatch(asset_id)]
    if invalid_ids:
        raise SystemExit("invalid asset IDs: " + ", ".join(invalid_ids))

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    existing = {item["asset_id"] for item in manifest.get("assets", [])}
    conflicts = sorted(existing.intersection(asset_ids))
    if conflicts:
        raise SystemExit("assets already present: " + ", ".join(conflicts))
    path_conflicts = [asset_id for asset_id in asset_ids if (assets_root / asset_id).exists()]
    if path_conflicts:
        raise SystemExit("asset directories already present: " + ", ".join(path_conflicts))

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    with tempfile.TemporaryDirectory(prefix="dreamhome-offline-dataset-") as temporary:
        staging = Path(temporary)
        records = [
            build_record(connection, storage, staging, asset_id)
            for asset_id in asset_ids
        ]
        for record in records:
            source = staging / "assets" / record["asset_id"]
            destination = assets_root / record["asset_id"]
            shutil.move(str(source), str(destination))

    for record in records:
        manifest["assets"].append({
            "asset_id": record["asset_id"],
            "name": record["name"],
            "source_type": SOURCE_TYPE,
            "source_label": SOURCE_LABEL,
            "video_id": None,
            "size_status": record["size_status"],
            "record": f"assets/{record['asset_id']}/asset.json",
        })
    manifest["assets"].sort(key=lambda item: item["asset_id"])
    manifest["generated_at"] = datetime.now(timezone.utc).isoformat()
    manifest["asset_count"] = len(manifest["assets"])
    manifest["size_known_count"] = sum(
        item.get("size_status") == "known" for item in manifest["assets"]
    )
    manifest["size_missing_count"] = sum(
        item.get("size_status") == "missing" for item in manifest["assets"]
    )
    manifest["source_counts"] = {
        "video": sum(item.get("video_id") is not None for item in manifest["assets"]),
        SOURCE_TYPE: sum(item.get("source_type") == SOURCE_TYPE for item in manifest["assets"]),
    }
    manifest["completeness_policy"].update({
        "human_review": "pass for video assets; not required for offline_photo assets",
        "video_id": "required for video assets; null for offline_photo assets",
        "appearance_interval": (
            "at least one non-zero interval for video assets; empty for offline_photo assets"
        ),
        "source_provenance": (
            "offline_photo assets use source.type=offline_photo and label=线下拍照生成"
        ),
    })
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_checksums(dataset)
    print(json.dumps({
        "dataset": str(dataset),
        "appended": len(records),
        "asset_count": manifest["asset_count"],
        "source_counts": manifest["source_counts"],
        "asset_ids": [record["asset_id"] for record in records],
    }, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--storage", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("asset_ids", nargs="+")
    args = parser.parse_args()
    append(args.db, args.storage, args.dataset, args.asset_ids)


if __name__ == "__main__":
    main()
