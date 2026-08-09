import unittest

from fastapi import HTTPException

from app.routers.frame_assets import _check_vid


class FrameAssetVideoIdTests(unittest.TestCase):
    def test_accepts_demo_and_content_stable_video_ids(self):
        for video_id in ("home-1", "vid_7f03ab", "douyin_20260810"):
            with self.subTest(video_id=video_id):
                _check_vid(video_id)

    def test_rejects_paths_and_unsafe_identifiers(self):
        for video_id in ("../home-1", "home/1", "", ".hidden", "home 1"):
            with self.subTest(video_id=video_id):
                with self.assertRaises(HTTPException):
                    _check_vid(video_id)


if __name__ == "__main__":
    unittest.main()
