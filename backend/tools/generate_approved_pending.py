"""Generate 3D only for pending assets explicitly approved in approve.html.

Safe by default: without ``--execute`` this only validates and prints the queue.
The approved thumbnail is sent directly to 3D because it is the exact input image
the reviewer accepted; no extra inpainting or relabelling is performed.

Usage:
  cd backend && set -a; source .env; set +a
  ./.venv/bin/python tools/generate_approved_pending.py --video-id <vid>
  ./.venv/bin/python tools/generate_approved_pending.py --video-id <vid> --execute
"""
import argparse
import asyncio
import os
import shutil
import sqlite3
import sys
import time
import json
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db  # noqa: E402
from app.config import settings  # noqa: E402
from pipeline.run import gen3d  # noqa: E402


def local_storage_path(url: str) -> Path | None:
    """Resolve our own /storage URL without downloading through the web server."""
    path = urlparse(url).path
    marker = "/storage/"
    if marker not in path:
        return None
    relative = path.split(marker, 1)[1]
    candidate = (Path(settings.STORAGE_DIR).resolve() / relative).resolve()
    storage = Path(settings.STORAGE_DIR).resolve()
    if candidate != storage and storage not in candidate.parents:
        return None
    return candidate


async def run(video_id: str, execute: bool, asset_ids: set[str]) -> int:
    conn = sqlite3.connect(settings.DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT a.asset_id, a.name, a.thumb_url, a.source_json
          FROM assets a
          JOIN asset_reviews r ON r.asset_id = a.asset_id
         WHERE a.status = 'pending_review'
           AND r.verdict = 'pass'
           AND json_extract(a.source_json, '$.video_id') = ?
         ORDER BY json_extract(a.source_json, '$.t_best'), a.asset_id
        """,
        (video_id,),
    ).fetchall()
    conn.close()
    if asset_ids:
        rows = [row for row in rows if row["asset_id"] in asset_ids]

    if not rows:
        print(f"No approved pending assets for {video_id}.")
        return 0

    queue: list[tuple[sqlite3.Row, Path]] = []
    errors = 0
    for row in rows:
        appearances = db._exec(
            """SELECT segment_id,t_start,t_end FROM asset_video_segments
                 WHERE asset_id=? ORDER BY t_start""",
            (row["asset_id"],),
        ).fetchall()
        if not appearances:
            print(f"INVALID {row['asset_id']} {row['name']}: no bound video time range")
            errors += 1
            continue
        image = local_storage_path(row["thumb_url"] or "")
        if not image or not image.is_file() or image.stat().st_size == 0:
            print(f"INVALID {row['asset_id']} {row['name']}: missing local input {row['thumb_url']}")
            errors += 1
            continue
        ranges = ", ".join(f"{x['t_start']:.1f}-{x['t_end']:.1f}s" for x in appearances)
        print(f"READY   {row['asset_id']} {row['name']}: {image.name} [{ranges}]")
        queue.append((row, image))

    print(f"\nQueue: {len(queue)} ready, {errors} invalid; mode={'EXECUTE' if execute else 'DRY'}")
    if errors or not execute:
        return 1 if errors else 0

    backup_dir = Path(settings.STORAGE_DIR).resolve() / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f"dreamhome-before-approved-3d-{int(time.time())}.db"
    shutil.copy2(settings.DB_PATH, backup)
    print(f"Database backup: {backup}")

    failures = 0
    for row, image in queue:
        # Re-read status for safe resume if an earlier run already completed it.
        current = db.get_asset(row["asset_id"])
        if not current or current["status"] != "pending_review":
            print(f"SKIP    {row['asset_id']}: current status is {current and current['status']}")
            continue
        print(f"GENERATE {row['asset_id']} {row['name']}")
        glb_url, status = await gen3d(str(image))
        if status != "ready" or not glb_url:
            print(f"FAILED  {row['asset_id']}: gen3d status={status}")
            failures += 1
            continue
        db.update_asset(row["asset_id"], glb_url=glb_url, status="ready")
        previous = db._row(
            "SELECT COALESCE(MAX(version),0) version FROM asset_media WHERE asset_id=? AND kind='model_3d'",
            (row["asset_id"],),
        )["version"]
        conn = db.get_conn()
        with db._lock:
            conn.execute("UPDATE asset_media SET is_current=0 WHERE asset_id=? AND kind='model_3d'",
                         (row["asset_id"],))
            conn.execute(
                """INSERT INTO asset_media(media_id,asset_id,kind,version,url,mime_type,
                   is_current,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)""",
                (db.new_id("med"), row["asset_id"], "model_3d", previous + 1,
                 glb_url, "model/gltf-binary", 1,
                 json.dumps({"input_url": current.get("thumb_url", ""),
                             "generator": "approved_pending"}), time.time()),
            )
            conn.commit()
        print(f"DONE    {row['asset_id']}: {glb_url}")

    print(f"\nFinished: {len(queue) - failures} generated, {failures} failed")
    return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--execute", action="store_true",
                        help="Actually call the paid/self-hosted 3D service")
    parser.add_argument("--asset-ids", default="",
                        help="Optional comma-separated approved asset IDs for a batch")
    args = parser.parse_args()
    asset_ids = {x.strip() for x in args.asset_ids.split(",") if x.strip()}
    raise SystemExit(asyncio.run(run(args.video_id, args.execute, asset_ids)))


if __name__ == "__main__":
    main()
