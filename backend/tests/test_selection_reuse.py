import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import videos


READY_ASSET = {
    "asset_id": "ast_existing",
    "name": "米色沙发",
    "labels": {
        "category": "沙发",
        "sub": "三人沙发",
        "colors": ["米色"],
        "materials": ["布艺"],
        "styles": ["现代"],
    },
    "source": {"video_id": "vid_test", "track_id": "trk_existing", "t_best": 3.0},
    "status": "ready",
    "glb_url": "https://example.test/sofa.glb",
    "thumb_url": "https://example.test/sofa.png",
}


class SelectionReuseTests(unittest.TestCase):
    def setUp(self):
        videos._SELECTS.clear()
        app = FastAPI()
        app.include_router(videos.router)
        self.client = TestClient(app)

    def tearDown(self):
        videos._SELECTS.clear()

    def test_exact_track_skips_labels_and_blind_generate_is_reused(self):
        track = {"track_id": "trk_existing", "video_id": "vid_test",
                 "asset_id": "ast_existing"}
        labels = AsyncMock(side_effect=AssertionError("labels provider must not run"))
        with (
            patch.object(videos.db, "get_video", return_value={"video_id": "vid_test"}),
            patch.object(videos.db, "get_asset", return_value=READY_ASSET),
            patch.object(videos.db, "get_track", return_value=track),
            patch.object(videos.db, "bind_track_asset") as bind,
            patch.object(videos.db, "library_add") as library_add,
            patch.object(videos, "extract_labels", labels),
            patch.object(videos, "find_exact_asset", return_value={
                "asset": READY_ASSET, "source": "track", "iou": 1.0,
                "track_id": "trk_existing",
            }),
        ):
            selected = self.client.post(
                "/api/videos/vid_test/select",
                json={"t": 3.0, "bbox": [0.1, 0.1, 0.5, 0.5],
                      "track_id": "trk_existing"},
            )
            self.assertEqual(selected.status_code, 200, selected.text)
            body = selected.json()
            self.assertEqual(body["exact_match"]["asset"]["asset_id"], "ast_existing")
            self.assertEqual(body["candidates"][0]["score"], 1.0)

            # Old clients currently ask to generate unconditionally.  The
            # backend must still prevent the duplicate.
            confirmed = self.client.post(
                "/api/videos/vid_test/select/confirm",
                json={"select_id": body["select_id"], "generate_new": True,
                      "quality_mode": "production", "user_id": "local-profile-test"},
            )
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            result = confirmed.json()
            self.assertEqual(result["asset_id"], "ast_existing")
            self.assertEqual(result["quality_mode"], "reuse")
            self.assertIsNone(result["job_id"])
            self.assertTrue(result["library_attached"])
            library_add.assert_called_once_with(
                "local-profile-test", ["ast_existing"], "video_selection_reuse",
                {"video_id": "vid_test", "track_id": "trk_existing", "t": 3.0},
            )
            bind.assert_called_once_with(
                "trk_existing",
                "ast_existing",
                binding_review_status="approved",
                binding_source="user_confirmed_reuse",
            )

    def test_non_ready_asset_cannot_be_reused(self):
        videos._SELECTS["sel"] = {
            "video_id": "vid_test", "t": 1.0, "bbox": [0.1, 0.1, 0.2, 0.2],
            "labels": {"category": "桌子"}, "track_id": None,
            "has_source_frame": False,
        }
        with patch.object(videos.db, "get_asset", return_value={
            **READY_ASSET, "status": "rejected",
        }):
            response = self.client.post(
                "/api/videos/vid_test/select/confirm",
                json={"select_id": "sel", "use_asset_id": "ast_existing"},
            )
        self.assertEqual(response.status_code, 409, response.text)

    def test_user_can_reject_exact_match_and_start_new_production(self):
        videos._SELECTS["sel-reject"] = {
            "video_id": "vid_test",
            "t": 3.0,
            "bbox": [0.1, 0.1, 0.5, 0.5],
            "polygon": [[0.1, 0.1], [0.6, 0.1], [0.6, 0.6], [0.1, 0.6]],
            "labels": READY_ASSET["labels"],
            "track_id": "trk_existing",
            "exact_asset_id": "ast_existing",
            "recognition_context": "/tmp/recognition.jpg",
            "source_crop": "/tmp/context.jpg",
            "completion_path": [(1, 1), (2, 1), (2, 2)],
            "isolation_mode": "polygon_context",
            "category_hint": "沙发",
            "has_source_frame": True,
        }
        refreshed_labels = {
            "category": "柜子",
            "sub": "电视柜",
            "colors": ["原木色"],
            "materials": ["实木"],
            "styles": ["现代"],
        }
        labels = AsyncMock(return_value=refreshed_labels)
        track = {"track_id": "trk_existing", "video_id": "vid_test",
                 "asset_id": "ast_existing"}
        with (
            patch.object(videos.db, "get_track", return_value=track),
            patch.object(videos, "extract_labels", labels),
            patch.object(videos, "production_readiness", return_value={"ready": True}),
            patch.object(
                videos,
                "start_selection_production",
                return_value=("ast_new", SimpleNamespace(job_id="job_new")),
            ) as start,
        ):
            response = self.client.post(
                "/api/videos/vid_test/select/confirm",
                json={
                    "select_id": "sel-reject",
                    "generate_new": True,
                    "reject_matched_asset": True,
                    "quality_mode": "production",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["asset_id"], "ast_new")
        self.assertEqual(response.json()["job_id"], "job_new")
        self.assertEqual(response.json()["quality_mode"], "production")
        labels.assert_awaited_once()
        self.assertEqual(start.call_args.kwargs["labels"], refreshed_labels)
        self.assertNotIn("sel-reject", videos._SELECTS)

    def test_failed_production_submission_keeps_selection_for_retry(self):
        videos._SELECTS["sel-retry"] = {
            "video_id": "vid_test",
            "t": 3.0,
            "bbox": [0.1, 0.1, 0.5, 0.5],
            "polygon": [[0.1, 0.1], [0.6, 0.1], [0.6, 0.6], [0.1, 0.6]],
            "labels": READY_ASSET["labels"],
            "track_id": "trk_existing",
            "source_crop": "/tmp/context.jpg",
            "completion_path": [(1, 1), (2, 1), (2, 2)],
            "isolation_mode": "polygon_context",
            "has_source_frame": True,
        }
        track = {"track_id": "trk_existing", "video_id": "vid_test",
                 "asset_id": None}
        with (
            patch.object(videos.db, "get_track", return_value=track),
            patch.object(videos, "production_readiness", return_value={"ready": True}),
            patch.object(
                videos,
                "start_selection_production",
                side_effect=RuntimeError("temporary queue failure"),
            ),
        ):
            response = self.client.post(
                "/api/videos/vid_test/select/confirm",
                json={
                    "select_id": "sel-retry",
                    "generate_new": True,
                    "quality_mode": "production",
                },
            )

        self.assertEqual(response.status_code, 503, response.text)
        self.assertIn("sel-retry", videos._SELECTS)

    def test_confirm_restores_durable_selection_after_process_restart(self):
        videos._SELECTS.clear()
        document = {
            "video_id": "vid_test",
            "t": 3.0,
            "bbox": [0.1, 0.1, 0.5, 0.5],
            "polygon": [[0.1, 0.1], [0.6, 0.1], [0.6, 0.6], [0.1, 0.6]],
            "labels": READY_ASSET["labels"],
            "track_id": "trk_existing",
            "source_crop": "/tmp/context.jpg",
            "recognition_context": "/tmp/recognition.jpg",
            "completion_path": [[1, 1], [2, 1], [2, 2]],
            "frame_size": [100, 80],
            "isolation_mode": "polygon_context",
            "has_source_frame": True,
            "user_id": "local-profile-test",
        }
        track = {"track_id": "trk_existing", "video_id": "vid_test", "asset_id": None}
        with (
            patch.object(videos.db, "get_selection_session", return_value={
                "document": document,
                "status": "retryable",
            }),
            patch.object(videos.db, "get_track", return_value=track),
            patch.object(videos.db, "upsert_selection_session") as persist,
            patch.object(videos, "production_readiness", return_value={"ready": True}),
            patch.object(
                videos,
                "start_selection_production",
                return_value=("ast_restored", SimpleNamespace(job_id="job_restored")),
            ),
        ):
            response = self.client.post(
                "/api/videos/vid_test/select/confirm",
                json={
                    "select_id": "sel-durable",
                    "generate_new": True,
                    "quality_mode": "production",
                    "user_id": "local-profile-test",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["job_id"], "job_restored")
        self.assertTrue(any(call.kwargs.get("status") == "submitted" for call in persist.mock_calls))

    def test_select_reuses_existing_client_task_without_provider_work(self):
        stored = {
            "select_id": "sel-existing",
            "video_id": "vid_test",
            "user_id": "local-profile-test",
            "status": "ready",
            "document": {
                "labels": READY_ASSET["labels"],
                "candidates": [],
                "exact_match": None,
            },
        }
        with (
            patch.object(videos.db, "get_selection_session_by_client_task", return_value=stored),
            patch.object(videos.db, "get_video", side_effect=AssertionError("video lookup must not run")),
            patch.object(videos, "extract_labels", AsyncMock(
                side_effect=AssertionError("labels provider must not run")
            )),
        ):
            response = self.client.post(
                "/api/videos/vid_test/select",
                json={
                    "t": 3.0,
                    "bbox": [0.1, 0.1, 0.5, 0.5],
                    "user_id": "local-profile-test",
                    "client_task_id": "craft-one",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["select_id"], "sel-existing")

    def test_confirm_reuses_already_submitted_job(self):
        videos._SELECTS["sel-submitted"] = {
            "video_id": "vid_test",
            "user_id": "local-profile-test",
            "asset_id": "ast_pending",
            "job_id": "job_pending",
            "track_id": "trk_pending",
        }
        with patch.object(
            videos,
            "start_selection_production",
            side_effect=AssertionError("a second production job must not start"),
        ):
            response = self.client.post(
                "/api/videos/vid_test/select/confirm",
                json={
                    "select_id": "sel-submitted",
                    "generate_new": True,
                    "quality_mode": "production",
                    "user_id": "local-profile-test",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["asset_id"], "ast_pending")
        self.assertEqual(response.json()["job_id"], "job_pending")

    def test_deterministic_quality_failure_is_not_retryable(self):
        stored = {
            "select_id": "sel-small",
            "video_id": "vid_test",
            "user_id": "local-profile-test",
            "status": "submitted",
            "error": "",
            "created_at": "2026-08-14T00:00:00Z",
            "updated_at": "2026-08-14T00:00:00Z",
            "document": {
                "client_task_id": "craft-small",
                "labels": READY_ASSET["labels"],
                "job_id": "job-small",
            },
        }
        failed = {
            "job": {
                "status": "failed",
                "error": "SelectionProductionError: input_qc: 大小(124x153)",
            },
            "asset": None,
        }
        with patch.object(videos.db, "get_generation_job", return_value=failed):
            payload = videos._selection_task_payload(stored)

        self.assertEqual(payload["status"], "rejected")
        self.assertIn("input_qc", payload["error"])


if __name__ == "__main__":
    unittest.main()
