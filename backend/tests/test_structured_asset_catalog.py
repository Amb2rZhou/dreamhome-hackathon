import json
import tempfile
import unittest
from pathlib import Path
from app.structured_catalog import StructuredCatalogError, load_structured_catalog


class StructuredAssetCatalogTests(unittest.TestCase):
    def test_returns_versioned_catalog_without_relabeling_review_scope(self):
        payload = {
            "schema_version": 1,
            "assets": [{
                "asset_id": "ast_demo",
                "tags": {"provenance": {"human_review_status": "unreviewed"}},
                "asset_quality_review": {"scope": "asset_quality_not_tag_accuracy", "verdict": "pass"},
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "structured-assets.v1.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = load_structured_catalog(path)
        self.assertEqual(result, payload)

    def test_fails_closed_when_catalog_has_not_been_built(self):
        with self.assertRaisesRegex(StructuredCatalogError, "structured asset catalog is not built"):
            load_structured_catalog(Path("/missing/catalog.json"))


if __name__ == "__main__":
    unittest.main()
