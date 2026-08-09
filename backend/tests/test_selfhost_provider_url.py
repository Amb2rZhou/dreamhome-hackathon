import unittest
from unittest.mock import patch

from app.providers.selfhost import SelfhostTrellisProvider


class SelfhostProviderUrlTests(unittest.TestCase):
    def test_uses_dedicated_generation_worker_when_configured(self):
        with patch(
            "app.providers.selfhost.settings.GEN3D_REMOTE_URL",
            "http://127.0.0.1:9001/",
        ), patch(
            "app.providers.selfhost.settings.GEN3D_FILES_URL",
            "http://127.0.0.1:9000/",
        ):
            provider = SelfhostTrellisProvider()
        self.assertEqual(provider._base, "http://127.0.0.1:9001")
        self.assertEqual(provider._files_base, "http://127.0.0.1:9000")


if __name__ == "__main__":
    unittest.main()
