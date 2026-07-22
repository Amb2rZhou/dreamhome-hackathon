"""Export the strict, frontend-available asset dataset from the local SQLite store.

An asset is exported only when it is ready, human-approved, has a real-world
size prior, a non-zero video appearance interval, a local completed input, a
local GLB, and parsed geometry metadata. The export intentionally omits track
IDs; frontend consumers only receive video time intervals.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


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


def source_context_files(storage: Path, video_id: str, input_name: str) -> tuple[Path, Path]:
    match = re.search(r"_(\d+)r?2?\.(?:jpg|jpeg|png)$", input_name, re.IGNORECASE)
    if not match:
        raise ValueError(f"cannot map input name to pipeline context: {input_name}")
    index = match.group(1)
    base = storage / "pipeline" / video_id
    return base / f"ctx_{index}.jpg", base / f"cut_{index}.jpg"


def export(db_path: Path, storage: Path, output: Path) -> None:
    db_path = db_path.resolve()
    storage = storage.resolve()
    output = output.resolve()
    if output.exists():
        raise SystemExit(f"output already exists: {output}")

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """SELECT a.*,r.verdict,r.reason,r.updated_at AS reviewed_at,
                  g.model_media_id,g.bounds_min_json,g.bounds_max_json,
                  g.dimensions_json,g.center_json,g.vertex_count,g.triangle_count,
                  g.collision_json,g.anchor_json,g.unit,g.parser_version,g.updated_at AS geometry_updated_at
             FROM assets a
             JOIN asset_reviews r USING(asset_id)
             JOIN asset_geometry g USING(asset_id)
            WHERE a.status='ready' AND r.verdict='pass'
              AND a.size_prior_json IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM asset_video_segments s
                 WHERE s.asset_id=a.asset_id AND s.t_end>s.t_start
              )
            ORDER BY a.asset_id"""
    ).fetchall()

    output.mkdir(parents=True)
    assets_dir = output / "assets"
    videos_dir = output / "videos"
    exported_assets: list[dict] = []
    exported_videos: dict[str, dict] = {}

    for row in rows:
        asset_id = row["asset_id"]
        source = parse_json(row["source_json"], {})
        video_id = source.get("video_id")
        if not video_id:
            raise ValueError(f"{asset_id}: missing source video_id")

        segments = [dict(item) for item in connection.execute(
            """SELECT segment_id,video_id,t_start,t_end,representative_t
                 FROM asset_video_segments
                WHERE asset_id=? AND t_end>t_start
                ORDER BY t_start,t_end""",
            (asset_id,),
        ).fetchall()]
        if not segments:
            raise ValueError(f"{asset_id}: missing non-zero appearance interval")
        if any(item["video_id"] != video_id for item in segments):
            raise ValueError(f"{asset_id}: appearance video mismatch")

        video = connection.execute(
            "SELECT * FROM videos WHERE video_id=?", (video_id,)
        ).fetchone()
        if not video:
            raise ValueError(f"{asset_id}: video row not found")
        if video_id not in exported_videos:
            video_file = local_storage_file(storage, video["play_url"])
            if not video_file:
                raise ValueError(f"{video_id}: local video file missing")
            video_dest = videos_dir / video_id / "source.mp4"
            media = copy_media(video_file, video_dest, output)
            exported_videos[video_id] = {
                "video_id": video_id,
                "title": video["title"],
                "duration_sec": video["duration"],
                "media": media,
            }

        media_rows = {
            item["kind"]: item
            for item in connection.execute(
                """SELECT * FROM asset_media
                    WHERE asset_id=? AND is_current=1
                      AND kind IN ('completed_input','model_3d')""",
                (asset_id,),
            ).fetchall()
        }
        completed = media_rows.get("completed_input")
        model = media_rows.get("model_3d")
        if not completed or not model:
            raise ValueError(f"{asset_id}: current completed_input/model_3d media missing")
        input_file = local_storage_file(storage, completed["url"])
        model_file = local_storage_file(storage, model["url"])
        if not input_file or not model_file:
            raise ValueError(f"{asset_id}: local completed input or GLB missing")

        context_file, crop_file = source_context_files(storage, video_id, input_file.name)
        if not context_file.is_file() or not crop_file.is_file():
            raise ValueError(f"{asset_id}: source context/crop missing")

        asset_dir = assets_dir / asset_id
        media = {
            "context": copy_media(context_file, asset_dir / "context.jpg", output),
            "source_crop": copy_media(crop_file, asset_dir / "source_crop.jpg", output),
            "completed_input": copy_media(
                input_file, asset_dir / f"completed_input{input_file.suffix.lower()}", output,
                completed["width_px"], completed["height_px"],
            ),
            "model_3d": copy_media(model_file, asset_dir / "model.glb", output),
        }
        labels = parse_json(row["labels_json"], {})
        size = parse_json(row["size_prior_json"], {})
        asset = {
            "schema_version": 1,
            "availability": "available",
            "asset_id": asset_id,
            "video_id": video_id,
            "appearances": [
                {
                    "start_sec": item["t_start"],
                    "end_sec": item["t_end"],
                    "representative_sec": item["representative_t"],
                }
                for item in segments
            ],
            "name": row["name"],
            "space": row["space"],
            "type": {
                "category": labels.get("category", ""),
                "subcategory": labels.get("sub", ""),
            },
            "labels": labels,
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
                "verdict": row["verdict"],
                "reason": row["reason"],
                "reviewed_at": iso_time(row["reviewed_at"]),
            },
            "created_by": row["created_by"],
            "created_at": iso_time(row["created_at"]),
        }
        asset_dir.mkdir(parents=True, exist_ok=True)
        (asset_dir / "asset.json").write_text(
            json.dumps(asset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        exported_assets.append(asset)

    manifest = {
        "schema_version": 1,
        "dataset_id": "available-assets-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "completeness_policy": {
            "status": "ready",
            "human_review": "pass",
            "physical_size_m": "required",
            "video_id": "required",
            "appearance_interval": "at least one interval with end_sec > start_sec",
            "completed_input": "required local file with SHA-256",
            "model_3d": "required local GLB with SHA-256",
            "geometry": "required parsed GLB metadata",
            "track_ids_exposed": False,
        },
        "asset_count": len(exported_assets),
        "video_count": len(exported_videos),
        "assets": [
            {
                "asset_id": item["asset_id"],
                "name": item["name"],
                "video_id": item["video_id"],
                "record": f"assets/{item['asset_id']}/asset.json",
            }
            for item in exported_assets
        ],
        "videos": list(exported_videos.values()),
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    readme = """# Available Assets v1

这是从后端资产库导出的严格完整数据集。只包含同时满足以下条件的资产：

- 状态为 `ready`，且人工审核为 `pass`
- 有真实尺寸（米）
- 有视频 ID，以及至少一个非零的开始—结束出现区间
- 有识别上下文、原始裁切、补全后的 3D 输入图和本地 GLB
- GLB 已解析出包围盒、顶点/三角形数、碰撞盒和放置锚点
- 所有媒体都有 SHA-256，可用 `checksums.sha256` 校验

## 使用

- `manifest.json`：数据集入口和完整性标准
- `assets/<asset_id>/asset.json`：单件资产的全部结构化字段
- `assets/<asset_id>/context.jpg`：资产在原视频中的识别上下文
- `assets/<asset_id>/source_crop.jpg`：补全前的原始裁切
- `assets/<asset_id>/completed_input.*`：实际送入 3D 的完整输入图
- `assets/<asset_id>/model.glb`：3D 模型
- `videos/<video_id>/source.mp4`：对应源视频；通过 `appearances` 跳到出现区间

`appearances` 支持同一资产对应多个时间段。数据集不暴露检测轨迹 ID。

当前仓库没有单独的数据授权文件；对外分发前请由仓库所有者补充许可说明。
"""
    (output / "README.md").write_text(readme, encoding="utf-8")

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://github.com/Amb2rZhou/dreamhome-hackathon/datasets/available-assets-v1/schema.json",
        "title": "DreamHome Available Asset",
        "type": "object",
        "required": [
            "schema_version", "availability", "asset_id", "video_id", "appearances",
            "name", "type", "labels", "physical_size_m", "geometry", "media", "review",
        ],
        "properties": {
            "schema_version": {"const": 1},
            "availability": {"const": "available"},
            "asset_id": {"type": "string", "minLength": 1},
            "video_id": {"type": "string", "minLength": 1},
            "appearances": {
                "type": "array", "minItems": 1,
                "items": {
                    "type": "object",
                    "required": ["start_sec", "end_sec", "representative_sec"],
                    "properties": {
                        "start_sec": {"type": "number", "minimum": 0},
                        "end_sec": {"type": "number", "exclusiveMinimum": 0},
                        "representative_sec": {"type": "number", "minimum": 0},
                    },
                },
            },
            "name": {"type": "string", "minLength": 1},
            "type": {
                "type": "object", "required": ["category", "subcategory"],
                "properties": {
                    "category": {"type": "string", "minLength": 1},
                    "subcategory": {"type": "string", "minLength": 1},
                },
            },
            "labels": {"type": "object"},
            "physical_size_m": {
                "type": "object", "required": ["width", "height", "depth"],
                "properties": {
                    "width": {"type": "number", "exclusiveMinimum": 0},
                    "height": {"type": "number", "exclusiveMinimum": 0},
                    "depth": {"type": "number", "exclusiveMinimum": 0},
                },
            },
            "geometry": {"type": "object"},
            "media": {
                "type": "object",
                "required": ["context", "source_crop", "completed_input", "model_3d"],
            },
            "review": {
                "type": "object", "required": ["verdict", "reason", "reviewed_at"],
                "properties": {"verdict": {"const": "pass"}},
            },
        },
    }
    (output / "schema.json").write_text(
        json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    checksums = []
    for path in sorted(item for item in output.rglob("*") if item.is_file()):
        if path.name == "checksums.sha256":
            continue
        checksums.append(f"{sha256(path)}  {path.relative_to(output).as_posix()}")
    (output / "checksums.sha256").write_text("\n".join(checksums) + "\n", encoding="utf-8")
    print(f"exported {len(exported_assets)} assets and {len(exported_videos)} video to {output}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--storage", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    export(args.db, args.storage, args.output)


if __name__ == "__main__":
    main()
