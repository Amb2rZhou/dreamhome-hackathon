import json
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.providers.fal import FalTrellisProvider
from app.services.detect import _normalise_boxes


class ApiOnlyProviderTests(unittest.IsolatedAsyncioTestCase):
    def test_dashscope_boxes_are_normalised_and_invalid_items_removed(self):
        boxes = _normalise_boxes([
            {"bbox": [100, 200, 600, 800], "category": "沙发", "score": 0.91},
            {"bbox": [20, 20, 10, 10], "category": "无效", "score": 1},
        ])
        self.assertEqual(len(boxes), 1)
        self.assertEqual(boxes[0]["category"], "沙发")
        self.assertAlmostEqual(boxes[0]["bbox"][0], 100 / 999, places=4)

    async def test_fal_uses_multi_endpoint_for_multiple_images(self):
        response = MagicMock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "request_id": "req", "status_url": "https://status", "response_url": "https://result"
        }
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.post.return_value = response
        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            for index in range(2):
                path = os.path.join(tmp, f"{index}.png")
                with open(path, "wb") as handle:
                    handle.write(b"png")
                paths.append(path)
            with patch("app.providers.fal.httpx.AsyncClient", return_value=client):
                result = await FalTrellisProvider().submit(paths[0], extra_image_paths=[paths[1]])
        self.assertEqual(json.loads(result)["request_id"], "req")
        called_url = client.post.await_args.args[0]
        self.assertTrue(called_url.endswith("/fal-ai/trellis/multi"))
        self.assertIn("image_urls", client.post.await_args.kwargs["json"])


if __name__ == "__main__":
    unittest.main()
