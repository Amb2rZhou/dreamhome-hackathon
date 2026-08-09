import unittest
from unittest.mock import patch

from app import main


class HealthContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_exposes_secret_free_consumer_and_feed_readiness(self):
        capabilities = {
            "detect": {"provider": "remote", "ready": True},
            "consumer_pipeline_ready": True,
        }
        feed = {"ready": True, "blockers": []}
        with (
            patch.object(main.settings, "consumer_capabilities", return_value=capabilities),
            patch.object(main, "production_readiness", return_value=feed),
        ):
            payload = await main.health()

        self.assertEqual(payload["consumer_contract"], "dreamhome-consumer-v1")
        self.assertEqual(payload["provider"], main.settings.effective_provider)
        self.assertTrue(payload["capabilities"]["consumer_pipeline_ready"])
        self.assertEqual(payload["capabilities"]["feed_selection_production"], feed)
        self.assertNotIn("key", str(payload).lower())

    async def test_feed_blocker_fails_overall_consumer_readiness(self):
        capabilities = {"consumer_pipeline_ready": True}
        feed = {"ready": False, "blockers": ["completion unavailable"]}
        with (
            patch.object(main.settings, "consumer_capabilities", return_value=capabilities),
            patch.object(main, "production_readiness", return_value=feed),
        ):
            payload = await main.health()

        self.assertFalse(payload["capabilities"]["consumer_pipeline_ready"])


if __name__ == "__main__":
    unittest.main()
