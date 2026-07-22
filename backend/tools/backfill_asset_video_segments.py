"""Materialize simple asset↔video time ranges and hide tracking internals from clients."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import db  # noqa: E402


def insert(asset_id: str, video_id: str, start: float, end: float, representative: float) -> int:
    if not asset_id or not video_id:
        return 0
    lo, hi = sorted((max(0.0, float(start)), max(0.0, float(end))))
    rep = min(hi, max(lo, float(representative))) if hi >= lo else lo
    now = time.time()
    cur = db._exec(
        """INSERT OR IGNORE INTO asset_video_segments(segment_id,asset_id,video_id,t_start,
           t_end,representative_t,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)""",
        (db.new_id("seg"), asset_id, video_id, lo, hi, rep, now, now),
    )
    return max(cur.rowcount, 0)


def main():
    added = 0
    # Normal assets: copy every currently bound video interval.
    for row in db._rows(
        "SELECT asset_id,video_id,t_start,t_end,best_frame_t FROM tracks WHERE asset_id IS NOT NULL"
    ):
        added += insert(row["asset_id"], row["video_id"], row["t_start"], row["t_end"],
                        row["best_frame_t"])

    # Recovered/manual assets may reference a source track already used by another candidate.
    # Sharing a time range is valid here: the frontend relation is no longer one-track-one-asset.
    for raw in db._rows("SELECT asset_id,source_json FROM assets"):
        source = json.loads(raw["source_json"] or "{}")
        video_id, track_id = source.get("video_id"), source.get("track_id")
        if not video_id:
            continue
        track = db._row(
            "SELECT video_id,t_start,t_end,best_frame_t FROM tracks WHERE track_id=?", (track_id,)
        ) if track_id else None
        if track:
            added += insert(raw["asset_id"], track["video_id"], track["t_start"], track["t_end"],
                            track["best_frame_t"])
        elif source.get("t_best") is not None:
            # A manual annotation with one timestamp is a zero-length interval until refined.
            t = float(source.get("t_best") or 0)
            added += insert(raw["asset_id"], video_id, t, t, t)

    total = db._row("SELECT COUNT(*) n FROM asset_video_segments")["n"]
    assets = db._row("SELECT COUNT(DISTINCT asset_id) n FROM asset_video_segments")["n"]
    print(f"asset video segments: {total} rows for {assets} assets; newly added {added}")


if __name__ == "__main__":
    main()
