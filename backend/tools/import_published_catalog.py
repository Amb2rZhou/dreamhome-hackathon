"""Idempotently import the deployed prototype GLBs into DreamHome's catalog."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from app.catalog_import import import_catalog, load_generated_manifest  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        type=Path,
        default=REPO / "web/prototype/pages/shared/library-assets.generated.js",
    )
    parser.add_argument(
        "--public-base-url",
        required=True,
        help="Published web origin, e.g. https://web-five-rho-44.vercel.app",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    items = load_generated_manifest(args.manifest)
    result = import_catalog(items, args.public_base_url, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
