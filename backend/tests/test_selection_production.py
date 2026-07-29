import os
import tempfile
import unittest
from unittest.mock import patch

from app.schemas import Job, JobStatus
from app.schemas_lib import SelectConfirmRequest
from app.services import selection_production as production


class SelectionProductionTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_marks_asset_ready_and_attaches_library(self):
        updates = []
        library_calls = []

        with tempfile.TemporaryDirectory() as temp_dir:
            cutout = os.path.join(temp_dir, "cutout.png")
            with open(cutout, "wb") as image:
                image.write(b"source-image")

            async def fake_enhance(source, output, category=""):
                with open(source, "rb") as src, open(output, "wb") as dst:
                    dst.write(src.read())
                return output

            async def fake_solo(path, description):
                return True, "ok"

            async def fake_identity(source, completed):
                return True, "ok"

            async def fake_gen3d(path):
                return "https://cdn.example/assets/result.glb", "ready"

            def fake_workpath(prefix, extension):
                return os.path.join(temp_dir, f"{prefix}{extension}")

            job = Job(
                job_id="job-1",
                kind="video",
                status=JobStatus.running,
                asset_id="ast-1",
                track_id="trk-1",
                quality_mode="production",
            )
            labels = {"category": "沙发", "sub": "双人沙发"}

            with (
                patch.object(production, "cut_quality_ok", return_value=(True, "")),
                patch.object(production, "enhance_cutout", side_effect=fake_enhance),
                patch.object(production, "check_solo", side_effect=fake_solo),
                patch.object(production, "check_consistency", side_effect=fake_identity),
                patch.object(production, "gen3d", side_effect=fake_gen3d),
                patch.object(production, "workpath", side_effect=fake_workpath),
                patch.object(production.settings, "STORAGE_DIR", temp_dir),
                patch.object(production.settings, "PUBLIC_BASE_URL", "https://api.example"),
                patch.object(production.db, "update_asset",
                             side_effect=lambda asset_id, **fields: updates.append((asset_id, fields))),
                patch.object(production.db, "library_add",
                             side_effect=lambda user_id, asset_ids, via:
                             library_calls.append((user_id, asset_ids, via))),
            ):
                await production._produce(
                    job,
                    asset_id="ast-1",
                    track_id="trk-1",
                    video_id="vid-1",
                    t=12.4,
                    bbox=[0.1, 0.1, 0.5, 0.5],
                    cutout_path=cutout,
                    labels=labels,
                    user_id="user-1",
                )

        self.assertEqual(job.status, JobStatus.succeeded)
        self.assertEqual(job.stage, "ready")
        self.assertEqual(job.progress, 100)
        self.assertTrue(job.library_attached)
        self.assertEqual(job.model_url, "https://cdn.example/assets/result.glb")
        self.assertEqual(library_calls, [("user-1", ["ast-1"], "feed-selection")])
        self.assertEqual(updates[-1][1]["status"], "ready")

    async def test_completion_failure_rejects_asset_without_library_write(self):
        updates = []

        with tempfile.TemporaryDirectory() as temp_dir:
            cutout = os.path.join(temp_dir, "cutout.png")
            with open(cutout, "wb") as image:
                image.write(b"source-image")
            job = Job(job_id="job-2", kind="video", status=JobStatus.running)

            async def no_completion(source, output, category=""):
                return source

            with (
                patch.object(production, "cut_quality_ok", return_value=(True, "")),
                patch.object(production, "enhance_cutout", side_effect=no_completion),
                patch.object(production, "workpath",
                             side_effect=lambda prefix, extension:
                             os.path.join(temp_dir, f"{prefix}{extension}")),
                patch.object(production.db, "update_asset",
                             side_effect=lambda asset_id, **fields: updates.append((asset_id, fields))),
                patch.object(production.db, "library_add") as library_add,
            ):
                with self.assertRaises(production.SelectionProductionError):
                    await production._produce(
                        job,
                        asset_id="ast-2",
                        track_id="trk-2",
                        video_id="vid-2",
                        t=3.0,
                        bbox=[0.1, 0.1, 0.5, 0.5],
                        cutout_path=cutout,
                        labels={"category": "单椅"},
                        user_id="user-2",
                    )

        self.assertEqual(job.stage, "completion")
        self.assertEqual(updates[-1][1]["status"], "rejected")
        self.assertIn("completion", updates[-1][1]["source"]["rejection_reason"])
        library_add.assert_not_called()

    def test_confirm_request_is_backward_compatible(self):
        request = SelectConfirmRequest(select_id="sel-1", generate_new=True)
        self.assertEqual(request.quality_mode, "fast")
        self.assertEqual(request.user_id, "demo")


if __name__ == "__main__":
    unittest.main()
