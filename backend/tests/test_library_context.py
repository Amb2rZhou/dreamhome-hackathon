import os
import tempfile
import unittest
from unittest.mock import patch

from app import db


class LibraryContextTests(unittest.TestCase):
    def test_membership_preserves_the_frame_used_to_collect_a_canonical_asset(self):
        previous_connection = db._conn
        db._conn = None
        try:
            with tempfile.TemporaryDirectory() as tmp, patch.object(
                db.settings, "DB_PATH", os.path.join(tmp, "library.sqlite")
            ):
                asset_id = db.insert_asset(
                    asset_id="ast_shared",
                    name="边柜",
                    labels={"category": "柜子", "styles": ["北欧"]},
                    glb_url="/storage/models/shared.glb",
                    thumb_url="/storage/thumbs/shared.png",
                    source={"video_id": "vid_original", "t_best": 2.0},
                    status="ready",
                )
                self.assertEqual(asset_id, "ast_shared")
                db.library_add("local-profile-test", [asset_id], "video_selection_reuse", {
                    "video_id": "home-1", "track_id": "trk_current", "t": 8.4,
                })
                # A later generic favorite call must not erase the precise
                # video occurrence that brought the asset into this library.
                db.library_add("local-profile-test", [asset_id], "favorite")

                library = db.library_of("local-profile-test")

                self.assertEqual(len(library), 1)
                self.assertEqual(library[0]["asset_id"], "ast_shared")
                self.assertEqual(library[0]["library_context"], {
                    "video_id": "home-1", "track_id": "trk_current", "t": 8.4,
                })
        finally:
            if db._conn is not None:
                db._conn.close()
            db._conn = previous_connection


if __name__ == "__main__":
    unittest.main()
