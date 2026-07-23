import unittest
from unittest.mock import AsyncMock, PropertyMock, patch

from app.services import labels


class StrictLabelsTests(unittest.IsolatedAsyncioTestCase):
    async def test_strict_mode_rejects_unavailable_provider(self):
        with patch.object(
            type(labels.settings), "effective_labels_provider",
            new_callable=PropertyMock, return_value="mock",
        ):
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                await labels.extract_labels("/tmp/input.jpg", strict=True)

    async def test_strict_mode_rejects_provider_failure_instead_of_mocking(self):
        with (
            patch.object(
                type(labels.settings), "effective_labels_provider",
                new_callable=PropertyMock, return_value="dashscope",
            ),
            patch.object(labels, "_dashscope", new=AsyncMock(side_effect=TimeoutError())),
            patch("app.services.cache.content_key", return_value="strict-labels"),
            patch("app.services.cache.get", return_value=None),
        ):
            with self.assertRaisesRegex(RuntimeError, "provider failed"):
                await labels.extract_labels("/tmp/input.jpg", strict=True)

    async def test_non_strict_mode_preserves_development_mock_fallback(self):
        with patch.object(
            type(labels.settings), "effective_labels_provider",
            new_callable=PropertyMock, return_value="mock",
        ):
            payload = await labels.extract_labels(None, category_hint="桌子")
        self.assertEqual(payload["category"], "桌子")


if __name__ == "__main__":
    unittest.main()
