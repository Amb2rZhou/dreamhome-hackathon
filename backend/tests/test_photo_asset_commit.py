import asyncio
import os
import tempfile
import unittest
from unittest.mock import patch

from app import db
from app.routers import photo
from app.schemas import Job, JobStatus


class PhotoAssetCommitTests(unittest.TestCase):
    def test_successful_photo_job_becomes_one_canonical_library_asset(self):
        previous_connection = db._conn
        db._conn = None
        try:
            with tempfile.TemporaryDirectory() as tmp, patch.object(
                db.settings, "DB_PATH", os.path.join(tmp, "photo.sqlite")
            ), patch.object(photo, "get_job", return_value=Job(
                job_id="photo-job-1",
                kind="photo",
                status=JobStatus.succeeded,
                model_url="/storage/results/photo-job-1.glb",
                thumbnail_url="/storage/results/photo-job-1.webp",
            )):
                request = photo.PhotoAssetCommitRequest(
                    user_id="local-profile-owner",
                    name="拍摄·柜子",
                    category="柜子",
                    styles=["中古"],
                    materials=[],
                )

                first = asyncio.run(photo.commit_photo_asset("photo-job-1", request))
                second = asyncio.run(photo.commit_photo_asset("photo-job-1", request))

                self.assertEqual(first.asset_id, second.asset_id)
                self.assertEqual(len(db.list_assets()), 1)
                asset = db.get_asset(first.asset_id)
                self.assertEqual(asset["status"], "ready")
                self.assertEqual(asset["source"]["source_type"], "offline_photo")
                self.assertEqual(asset["source"]["job_id"], "photo-job-1")
                self.assertEqual(asset["labels"]["styles"], ["中古"])
                self.assertEqual(asset["labels"]["materials"], ["待确认材质"])
                self.assertIsNone(asset["size_prior"])
                library = db.library_of("local-profile-owner")
                self.assertEqual([item["asset_id"] for item in library], [first.asset_id])
        finally:
            if db._conn is not None:
                db._conn.close()
            db._conn = previous_connection


if __name__ == "__main__":
    unittest.main()
