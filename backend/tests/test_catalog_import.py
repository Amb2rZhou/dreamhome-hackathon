import unittest
from pathlib import Path

from app.catalog_import import canonical_asset_fields, import_catalog, load_generated_manifest


MANIFEST = (Path(__file__).resolve().parents[2]
            / "web/prototype/pages/shared/library-assets.generated.js")


class FakeDatabase:
    def __init__(self):
        self.assets = {}
        self.videos = {}

    def get_asset(self, asset_id):
        return self.assets.get(asset_id)

    def insert_asset(self, **fields):
        self.assets[fields["asset_id"]] = fields

    def get_video(self, video_id):
        return self.videos.get(video_id)

    def insert_video(self, **fields):
        self.videos[fields["video_id"]] = fields


class CatalogImportTests(unittest.TestCase):
    def test_reads_complete_generated_catalog(self):
        items = load_generated_manifest(MANIFEST)
        self.assertEqual(len(items), 169)
        self.assertTrue(all(item.get("asset_id") for item in items))

    def test_maps_published_media_and_preserves_canonical_id(self):
        item = load_generated_manifest(MANIFEST)[0]
        fields = canonical_asset_fields(item, "https://web.example/")
        self.assertEqual(fields["asset_id"], item["asset_id"])
        self.assertTrue(fields["glb_url"].startswith(
            "https://web.example/prototype/assets/models/"))
        self.assertEqual(fields["labels"]["category"], item["type"]["category"])
        self.assertEqual(fields["status"], "ready")

    def test_import_is_idempotent(self):
        items = load_generated_manifest(MANIFEST)[:3]
        database = FakeDatabase()
        first = import_catalog(items, "https://web.example", database=database)
        second = import_catalog(items, "https://web.example", database=database)
        self.assertEqual(first["assets_inserted"], 3)
        self.assertEqual(second["assets_inserted"], 0)
        self.assertEqual(second["assets_existing"], 3)
        self.assertEqual(len(database.assets), 3)


if __name__ == "__main__":
    unittest.main()
