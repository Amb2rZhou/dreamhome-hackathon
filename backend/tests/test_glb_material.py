import io
import json
import struct
import unittest

from PIL import Image

from app.services.glb_material import _decode_glb, _encode_glb, postprocess_glb_bytes


def _textured_triangle_glb(color=(36, 49, 62, 255)) -> bytes:
    output = io.BytesIO()
    Image.new("RGBA", (2, 2), color).save(output, format="PNG")
    texture = output.getvalue()
    document = {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": len(texture)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(texture)}],
        "images": [{"bufferView": 0, "mimeType": "image/png"}],
        "textures": [{"source": 0}],
        "materials": [{
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "baseColorFactor": [0.5, 0.5, 0.5, 1.0],
                "metallicFactor": 1.0,
            },
        }],
        "accessors": [{"count": 3}, {"count": 3}],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 0},
            "indices": 1,
            "material": 0,
        }]}],
    }
    return _encode_glb(document, texture)


class GlbMaterialTests(unittest.TestCase):
    def test_lifts_albedo_and_normalizes_material_once(self):
        source = _textured_triangle_glb()
        processed, metadata = postprocess_glb_bytes(source, gamma=0.7)

        document, binary = _decode_glb(processed)
        view = document["bufferViews"][0]
        start = int(view.get("byteOffset") or 0)
        image = Image.open(io.BytesIO(binary[start:start + view["byteLength"]])).convert("RGB")
        self.assertGreater(image.getpixel((0, 0))[0], 36)
        pbr = document["materials"][0]["pbrMetallicRoughness"]
        self.assertEqual(pbr["metallicFactor"], 0.0)
        self.assertEqual(pbr["baseColorFactor"], [1.0, 1.0, 1.0, 1.0])
        self.assertEqual(metadata["textures_corrected"], 1)
        self.assertEqual(metadata["triangles"], 1)

        same, second = postprocess_glb_bytes(processed, gamma=0.7)
        self.assertEqual(same, processed)
        self.assertTrue(second["already_processed"])

    def test_rejects_raw_glb_without_renderable_mesh(self):
        source = _textured_triangle_glb()
        document, binary = _decode_glb(source)
        document["meshes"] = []
        with self.assertRaisesRegex(ValueError, "renderable triangle mesh"):
            postprocess_glb_bytes(_encode_glb(document, binary), gamma=0.7)

    def test_rejects_untextured_glb(self):
        source = _textured_triangle_glb()
        document, binary = _decode_glb(source)
        document["materials"] = [{}]
        with self.assertRaisesRegex(ValueError, "base-color texture"):
            postprocess_glb_bytes(_encode_glb(document, binary), gamma=0.7)


if __name__ == "__main__":
    unittest.main()
