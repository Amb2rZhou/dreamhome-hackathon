import unittest

from PIL import Image

from segment_api import bake_path_onto_image


class SegmentFocusMaskTests(unittest.TestCase):
    def test_preserves_selected_pixels_and_mutes_room_context(self):
        image = Image.new("RGB", (200, 160), (80, 40, 20))
        points = [(60, 45), (150, 45), (150, 120), (60, 120)]

        focused = bake_path_onto_image(image, points).convert("RGB")

        inside = focused.getpixel((105, 82))
        outside = focused.getpixel((15, 15))
        self.assertEqual(inside, (80, 40, 20))
        self.assertGreater(sum(outside), sum(inside))
        self.assertLess(abs(outside[0] - outside[1]), abs(80 - 40))


if __name__ == "__main__":
    unittest.main()
