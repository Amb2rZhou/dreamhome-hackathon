import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.routers import videos


def _jpeg(width: int = 100, height: int = 80) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), (180, 120, 70)).save(output, format="JPEG")
    return output.getvalue()


class VideoSelectMultipartTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.counter = iter(range(20))

        def fake_workpath(prefix: str, suffix: str) -> str:
            return str(Path(self.temp_dir.name) / f"{prefix}-{next(self.counter)}{suffix}")

        async def fake_labels(path: str, category_hint: str = "") -> dict:
            with Image.open(path) as crop:
                self.assertEqual(crop.size, (40, 40))
            return {"category": category_hint or "其他", "sub": "茶壶"}

        self.patches = [
            patch.object(videos, "workpath", fake_workpath),
            patch.object(videos.db, "get_video", lambda video_id: {"video_id": video_id}),
            patch.object(videos, "extract_labels", fake_labels),
            patch.object(videos.matching, "match_candidates", lambda labels: []),
        ]
        for active_patch in self.patches:
            active_patch.start()
        videos._SELECTS.clear()

        app = FastAPI()
        app.include_router(videos.router)
        self.client = TestClient(app)

    def tearDown(self):
        for active_patch in reversed(self.patches):
            active_patch.stop()
        self.temp_dir.cleanup()

    def test_persists_full_frame_and_uses_bbox_crop(self):
        response = self.client.post(
            "/api/videos/vid_test/select",
            data={
                "t": "12.5",
                "bbox": "[0.2, 0.25, 0.4, 0.5]",
                "polygon": "[[0.2, 0.25], [0.6, 0.25], [0.6, 0.75]]",
                "frame_width": "100",
                "frame_height": "80",
                "category_hint": "其他",
            },
            files={"frame": ("frame.jpg", _jpeg(), "image/jpeg")},
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["labels"]["sub"], "茶壶")
        selection = videos._SELECTS[payload["select_id"]]
        self.assertEqual(selection["frame_size"], (100, 80))
        self.assertEqual(selection["polygon"], [[0.2, 0.25], [0.6, 0.25], [0.6, 0.75]])
        with Image.open(selection["frame"]) as frame:
            self.assertEqual(frame.size, (100, 80))

    def test_rejects_multipart_without_full_frame(self):
        response = self.client.post(
            "/api/videos/vid_test/select",
            data={"t": "0", "bbox": "[0.1, 0.1, 0.5, 0.5]"},
            files={"not_frame": ("placeholder.txt", b"x", "text/plain")},
        )
        self.assertEqual(response.status_code, 422)

    def test_rejects_mismatched_frame_dimensions(self):
        response = self.client.post(
            "/api/videos/vid_test/select",
            data={
                "t": "1",
                "bbox": "[0.1, 0.1, 0.5, 0.5]",
                "frame_width": "101",
                "frame_height": "80",
            },
            files={"frame": ("frame.jpg", _jpeg(), "image/jpeg")},
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("frame_width", response.text)


if __name__ == "__main__":
    unittest.main()
