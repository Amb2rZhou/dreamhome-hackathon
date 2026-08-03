"""Small, idempotent SQLite compatibility migrations.

DreamHome intentionally keeps the hackathon database simple.  These migrations
extend the existing ``tracks`` relation instead of introducing a second video
component timeline or a parallel asset mapping table.
"""
from __future__ import annotations

import sqlite3


TRACK_QUALITY_COLUMNS: dict[str, str] = {
    "confidence": "REAL",
    "review_status": "TEXT NOT NULL DEFAULT 'unreviewed'",
    "version": "INTEGER NOT NULL DEFAULT 1",
    "source": "TEXT NOT NULL DEFAULT 'legacy'",
    "binding_confidence": "REAL",
    "binding_review_status": "TEXT NOT NULL DEFAULT 'unreviewed'",
    "binding_version": "INTEGER NOT NULL DEFAULT 1",
    "binding_source": "TEXT NOT NULL DEFAULT 'legacy'",
}


def apply_compat_migrations(conn: sqlite3.Connection) -> list[str]:
    """Apply additive migrations and return the columns added this run."""
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    if "tracks" not in tables:
        return []

    existing = {
        row[1] for row in conn.execute("PRAGMA table_info(tracks)").fetchall()
    }
    added: list[str] = []
    for name, declaration in TRACK_QUALITY_COLUMNS.items():
        if name in existing:
            continue
        conn.execute(f'ALTER TABLE tracks ADD COLUMN "{name}" {declaration}')
        added.append(name)
    if added:
        conn.commit()
    return added
