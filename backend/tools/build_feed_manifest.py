#!/usr/bin/env python3
"""Build the unified Feed manifest without mutating any source data."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.feed_manifest import DEFAULT_DB, REPO_ROOT, build_manifest, write_json  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output", type=Path,
                        default=REPO_ROOT / "backend/storage/feed/feed-manifest.v1.json")
    parser.add_argument("--dry-run", action="store_true",
                        help="build and print the summary without writing output")
    args = parser.parse_args()
    manifest = build_manifest(db_path=args.db)
    if not args.dry_run:
        write_json(args.output, manifest)
    print(json.dumps({
        "mode": "dry-run" if args.dry_run else "write",
        "output": str(args.output.resolve()),
        "content_version": manifest["content_version"],
        "counts": {key: len(manifest[key]) for key in (
            "videos", "scenes", "tracks", "canonical_assets", "appearances", "same_home_templates"
        )},
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
