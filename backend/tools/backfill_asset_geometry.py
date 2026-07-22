"""Extract frontend-ready geometry metadata from current GLB files without changing them."""
import json
import os
import struct
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import db  # noqa: E402
from app.config import settings  # noqa: E402


def glb_json(path: Path) -> dict:
    with path.open("rb") as f:
        header = f.read(12)
        magic, version, _length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2:
            raise ValueError("not GLB v2")
        chunk_length, chunk_type = struct.unpack("<II", f.read(8))
        if chunk_type != 0x4E4F534A:
            raise ValueError("first GLB chunk is not JSON")
        return json.loads(f.read(chunk_length).decode("utf-8").rstrip(" \t\r\n\0"))


def extract(doc: dict) -> dict:
    accessors = doc.get("accessors") or []
    mins, maxs, vertices, triangles = [], [], 0, 0
    for mesh in doc.get("meshes") or []:
        for primitive in mesh.get("primitives") or []:
            pos_index = (primitive.get("attributes") or {}).get("POSITION")
            if isinstance(pos_index, int) and pos_index < len(accessors):
                pos = accessors[pos_index]
                if len(pos.get("min") or []) >= 3 and len(pos.get("max") or []) >= 3:
                    mins.append(pos["min"][:3]); maxs.append(pos["max"][:3])
                vertices += int(pos.get("count") or 0)
            idx = primitive.get("indices")
            if isinstance(idx, int) and idx < len(accessors):
                triangles += int(accessors[idx].get("count") or 0) // 3
            elif isinstance(pos_index, int) and pos_index < len(accessors):
                triangles += int(accessors[pos_index].get("count") or 0) // 3
    if not mins:
        raise ValueError("GLB has no POSITION accessor bounds")
    lo = [min(v[i] for v in mins) for i in range(3)]
    hi = [max(v[i] for v in maxs) for i in range(3)]
    dims = [hi[i] - lo[i] for i in range(3)]
    center = [(hi[i] + lo[i]) / 2 for i in range(3)]
    return {"bounds_min": lo, "bounds_max": hi, "dimensions": dims, "center": center,
            "vertex_count": vertices, "triangle_count": triangles}


def local_glb(url: str) -> Path | None:
    path = urlparse(url).path
    if "/storage/" not in path:
        return None
    result = Path(settings.STORAGE_DIR).resolve() / path.split("/storage/", 1)[1]
    return result if result.is_file() else None


def anchor_for(labels: dict, bounds: dict) -> dict:
    mount = labels.get("mount") or "floor"
    if mount == "ceiling":
        return {"surface": "ceiling", "point": [0, bounds["bounds_max"][1], 0]}
    if mount == "wall":
        return {"surface": "wall", "point": [0, bounds["center"][1], bounds["bounds_min"][2]]}
    if mount == "surface":
        return {"surface": "surface", "point": [0, bounds["bounds_min"][1], 0]}
    return {"surface": "floor", "point": [0, bounds["bounds_min"][1], 0]}


def main():
    ok = failed = 0
    for asset in db.list_assets(include_all_status=True):
        path = local_glb(asset.get("glb_url", ""))
        if not path:
            continue
        try:
            geom = extract(glb_json(path))
            current = db._row(
                "SELECT media_id FROM asset_media WHERE asset_id=? AND kind='model_3d' AND is_current=1",
                (asset["asset_id"],),
            )
            collision = {"type": "box", "center": geom["center"],
                         "dimensions": geom["dimensions"]}
            db._exec(
                """INSERT INTO asset_geometry(asset_id,model_media_id,bounds_min_json,bounds_max_json,
                   dimensions_json,center_json,vertex_count,triangle_count,collision_json,anchor_json,
                   unit,parser_version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(asset_id) DO UPDATE SET model_media_id=excluded.model_media_id,
                   bounds_min_json=excluded.bounds_min_json,bounds_max_json=excluded.bounds_max_json,
                   dimensions_json=excluded.dimensions_json,center_json=excluded.center_json,
                   vertex_count=excluded.vertex_count,triangle_count=excluded.triangle_count,
                   collision_json=excluded.collision_json,anchor_json=excluded.anchor_json,
                   unit=excluded.unit,parser_version=excluded.parser_version,updated_at=excluded.updated_at""",
                (asset["asset_id"], current and current["media_id"],
                 json.dumps(geom["bounds_min"]), json.dumps(geom["bounds_max"]),
                 json.dumps(geom["dimensions"]), json.dumps(geom["center"]),
                 geom["vertex_count"], geom["triangle_count"], json.dumps(collision),
                 json.dumps(anchor_for(asset.get("labels") or {}, geom)), "model_unit", "glb-accessor-v1",
                 time.time()),
            )
            ok += 1
        except Exception as exc:
            print(f"FAILED {asset['asset_id']} {path.name}: {exc}")
            failed += 1
    print(f"geometry extracted: {ok}, failed: {failed}")


if __name__ == "__main__":
    main()
