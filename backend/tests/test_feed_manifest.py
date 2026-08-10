import copy
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.feed_manifest import build_manifest, validate_manifest
from app.migrations import TRACK_QUALITY_COLUMNS, apply_compat_migrations


class FeedMigrationTests(unittest.TestCase):
    def test_track_quality_migration_is_additive_and_idempotent(self):
        conn = sqlite3.connect(":memory:")
        conn.execute(
            "CREATE TABLE tracks(track_id TEXT PRIMARY KEY, video_id TEXT NOT NULL, "
            "asset_id TEXT, frames_json TEXT NOT NULL DEFAULT '[]')"
        )
        conn.execute(
            "INSERT INTO tracks(track_id,video_id,asset_id) VALUES('trk_1','vid_1','ast_1')"
        )

        first = apply_compat_migrations(conn)
        second = apply_compat_migrations(conn)

        self.assertEqual(set(first), set(TRACK_QUALITY_COLUMNS))
        self.assertEqual(second, [])
        row = conn.execute("SELECT * FROM tracks WHERE track_id='trk_1'").fetchone()
        columns = [item[1] for item in conn.execute("PRAGMA table_info(tracks)")]
        record = dict(zip(columns, row))
        self.assertEqual(record["asset_id"], "ast_1")
        self.assertEqual(record["review_status"], "unreviewed")
        self.assertEqual(record["binding_version"], 1)

    def test_user_library_context_migration_is_additive_and_idempotent(self):
        conn = sqlite3.connect(":memory:")
        conn.execute(
            "CREATE TABLE user_library(user_id TEXT NOT NULL, asset_id TEXT NOT NULL, "
            "via TEXT NOT NULL DEFAULT '', added_at REAL NOT NULL, "
            "PRIMARY KEY(user_id, asset_id))"
        )

        first = apply_compat_migrations(conn)
        second = apply_compat_migrations(conn)

        self.assertEqual(first, ["context_json"])
        self.assertEqual(second, [])
        columns = [item[1] for item in conn.execute("PRAGMA table_info(user_library)")]
        self.assertIn("context_json", columns)


class FeedManifestTests(unittest.TestCase):
    def test_current_demo_manifest_is_deterministic_and_uses_catalog_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing_db = Path(tmp) / "missing.db"
            first = build_manifest(db_path=missing_db)
            second = build_manifest(db_path=missing_db)

        self.assertEqual(first, second)
        self.assertFalse(first["source_policy"]["runtime_database_available"])
        self.assertEqual(len(first["canonical_assets"]), 190)
        self.assertEqual(len(first["appearances"]), 195)
        self.assertEqual(len(first["tracks"]), 0)
        self.assertEqual(len(first["same_home_templates"]), 2)
        self.assertEqual(len(first["scenes"]), 3)
        canonical_ids = {item["asset_id"] for item in first["canonical_assets"]}
        self.assertTrue({
            "ast_665e55cee687", "ast_cf21f0f0a02c", "ast_6410374831cb",
            "ast_87dc36b29526", "ast_339dc6e870de", "ast_f7189ad0a9a2",
            "ast_ec05acc016d9", "ast_febb8b909137",
        }.issubset(canonical_ids))
        for asset in first["canonical_assets"]:
            with self.subTest(asset_id=asset["asset_id"]):
                self.assertTrue(asset["labels"].get("colors"))
                self.assertTrue(asset["labels"].get("materials"))
                self.assertTrue(asset["labels"].get("styles"))

    def test_validator_finds_all_required_quality_failures(self):
        manifest = {
            "schema_version": "dreamhome-feed-manifest/v1",
            "content_version": "test",
            "videos": [
                {"video_id": "vid_a", "duration": 10, "scene_refs": [],
                 "same_home_template_refs": ["template_missing"]},
                {"video_id": "vid_b", "duration": 10, "scene_refs": [],
                 "same_home_template_refs": []},
            ],
            "canonical_assets": [
                {"asset_id": "ast_cross", "status": "ready", "source": {"video_id": "vid_b"}},
                {"asset_id": "ast_pending", "status": "generating", "source": {"video_id": "vid_a"}},
            ],
            "tracks": [{
                "track_id": "trk_a", "video_id": "vid_a", "asset_id": "ast_cross",
                "frames": [{"t": 12, "bbox": [0.9, 0.9, 0.2, 0.2]}],
                "binding_quality": {"review_status": "unreviewed"},
            }],
            "appearances": [{
                "appearance_id": "appearance_1", "video_id": "vid_a",
                "asset_id": "ast_cross", "track_id": "trk_a", "start_sec": 9,
                "end_sec": 12, "representative_sec": 11,
                "frames": [{"t": 11, "bbox": [0, 0, 0, 1]}], "source": "tracks",
            }, {
                "appearance_id": "appearance_2", "video_id": "vid_a",
                "asset_id": "ast_cross", "track_id": "trk_a", "start_sec": 9,
                "end_sec": 12, "representative_sec": 11, "frames": [], "source": "tracks",
            }, {
                "appearance_id": "appearance_orphan", "video_id": "vid_missing",
                "asset_id": "ast_missing", "track_id": "trk_missing", "start_sec": 2,
                "end_sec": 1, "representative_sec": 3, "frames": [], "source": "tracks",
            }, {
                "appearance_id": "appearance_pending", "video_id": "vid_a",
                "asset_id": "ast_pending", "track_id": None, "start_sec": 0,
                "end_sec": 1, "representative_sec": 0.5, "frames": [],
                "source": "frontend_compatibility",
            }],
            "scenes": [],
            "same_home_templates": [{
                "template_id": "template_a", "video_id": "vid_a",
                "asset_ids": ["ast_missing"],
            }],
        }
        # Preserve the fixture: validation must never repair source data.
        original = copy.deepcopy(manifest)
        report = validate_manifest(manifest)
        codes = {issue["code"] for issue in report["issues"]}

        self.assertEqual(manifest, original)
        self.assertFalse(report["valid"])
        self.assertTrue({
            "MISSING_ASSET", "ORPHAN_MAPPING", "DUPLICATE_MAPPING",
            "TIME_OUT_OF_BOUNDS", "INVALID_TIME_RANGE", "INVALID_BBOX",
            "NON_READY_ASSET", "CROSS_VIDEO_BINDING", "MISSING_SCENE",
        }.issubset(codes))


if __name__ == "__main__":
    unittest.main()
