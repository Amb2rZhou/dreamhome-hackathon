import unittest
from unittest.mock import patch

from app import db


class TrackBindingMetadataTests(unittest.TestCase):
    def test_default_binding_invalidates_review_and_bumps_version(self):
        with patch.object(db, "_exec") as execute:
            db.bind_track_asset("trk_1", "ast_1")

        sql, params = execute.call_args.args
        self.assertIn("binding_version=binding_version+1", sql)
        self.assertEqual(params, ("ast_1", None, "unreviewed", "manual", "trk_1"))

    def test_confirmed_manual_binding_keeps_confidence_nullable(self):
        with patch.object(db, "_exec") as execute:
            db.bind_track_asset(
                "trk_1",
                "ast_2",
                binding_review_status="approved",
                binding_source="user_confirmed_reuse",
            )

        _, params = execute.call_args.args
        self.assertEqual(
            params,
            ("ast_2", None, "approved", "user_confirmed_reuse", "trk_1"),
        )

    def test_catalog_merge_versions_the_relation(self):
        with patch.object(db, "_exec") as execute:
            db.rebind_tracks("ast_old", "ast_keep")

        sql, params = execute.call_args.args
        self.assertIn("binding_version=binding_version+1", sql)
        self.assertIn("binding_source='catalog_merge'", sql)
        self.assertEqual(params, ("ast_keep", "ast_old"))


if __name__ == "__main__":
    unittest.main()
