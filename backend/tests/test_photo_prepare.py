import unittest
from unittest.mock import AsyncMock, patch

from app.services import prepare


class PhotoPreparationTests(unittest.IsolatedAsyncioTestCase):
    async def test_enhance_off_is_exact_passthrough(self):
        with patch.object(prepare.settings, "ENHANCE_PROVIDER", "off"):
            source, metadata = await prepare.prepare_photo("/tmp/photo.jpg")

        self.assertEqual(source, "/tmp/photo.jpg")
        self.assertFalse(metadata["prepped"])
        self.assertEqual(metadata["note"], "enhance off, passthrough")

    async def test_successful_pipeline_returns_verified_completion(self):
        with (
            patch.object(prepare.settings, "ENHANCE_PROVIDER", "module"),
            patch.object(
                prepare.segment,
                "isolate_object",
                return_value="/tmp/cut.png",
            ),
            patch.object(
                prepare,
                "enhance_cutout",
                new=AsyncMock(return_value="/tmp/enhanced.jpg"),
            ),
            patch.object(
                prepare,
                "check_solo",
                new=AsyncMock(return_value=(True, "one object")),
            ),
            patch.object(
                prepare,
                "check_consistency",
                new=AsyncMock(return_value=(True, "same object")),
            ),
        ):
            source, metadata = await prepare.prepare_photo(
                "/tmp/photo.jpg",
                category="沙发",
            )

        self.assertEqual(source, "/tmp/enhanced.jpg")
        self.assertTrue(metadata["segmented"])
        self.assertTrue(metadata["enhanced"])
        self.assertTrue(metadata["solo"])
        self.assertTrue(metadata["consistent"])

    async def test_failed_identity_gate_falls_back_to_cutout(self):
        with (
            patch.object(prepare.settings, "ENHANCE_PROVIDER", "module"),
            patch.object(
                prepare.segment,
                "isolate_object",
                return_value="/tmp/cut.png",
            ),
            patch.object(
                prepare,
                "enhance_cutout",
                new=AsyncMock(return_value="/tmp/enhanced.jpg"),
            ),
            patch.object(
                prepare,
                "check_solo",
                new=AsyncMock(return_value=(True, "one object")),
            ),
            patch.object(
                prepare,
                "check_consistency",
                new=AsyncMock(return_value=(False, "different object")),
            ),
        ):
            source, metadata = await prepare.prepare_photo("/tmp/photo.jpg")

        self.assertEqual(source, "/tmp/cut.png")
        self.assertFalse(metadata["consistent"])


if __name__ == "__main__":
    unittest.main()
