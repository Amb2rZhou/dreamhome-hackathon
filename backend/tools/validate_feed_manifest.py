#!/usr/bin/env python3
"""Validate a Feed manifest. Validation is always source-data read-only."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.feed_manifest import REPO_ROOT, validate_manifest, write_json  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", nargs="?", type=Path,
                        default=REPO_ROOT / "backend/storage/feed/feed-manifest.v1.json")
    parser.add_argument("--report", type=Path,
                        default=REPO_ROOT / "backend/storage/qc/feed-manifest-validation.json")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the report without writing it")
    parser.add_argument("--strict", action="store_true",
                        help="return non-zero when validation errors are found")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    report = validate_manifest(manifest)
    if not args.dry_run:
        write_json(args.report, report)
    print(json.dumps({"mode": "dry-run" if args.dry_run else "write",
                      "report": str(args.report.resolve()), **report["summary"]},
                     ensure_ascii=False, indent=2))
    return 1 if args.strict and not report["valid"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
