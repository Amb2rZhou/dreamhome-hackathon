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
                      "quality_mode": "production"},
            )
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            result = confirmed.json()
            self.assertEqual(result["asset_id"], "ast_existing")
            self.assertEqual(result["quality_mode"], "reuse")
            self.assertIsNone(result["job_id"])
            bind.assert_called_once_with("trk_existing", "ast_existing")

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


if __name__ == "__main__":
    unittest.main()
