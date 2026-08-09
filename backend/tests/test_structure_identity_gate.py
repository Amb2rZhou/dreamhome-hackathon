import unittest

from app.services.consistency import _identity_verdict


class StructureIdentityGateTests(unittest.TestCase):
    def test_accepts_only_explicit_high_confidence_structure_match(self):
        accepted, reason = _identity_verdict({
            "same": True,
            "category_match": True,
            "proportion_match": True,
            "topology_match": True,
            "visible_parts_preserved": True,
            "material_color_match": True,
            "confidence": 0.91,
            "conflicts": [],
            "reason": "same four-cubby low cabinet",
        })

        self.assertTrue(accepted)
        self.assertEqual(reason, "same four-cubby low cabinet")

    def test_rejects_missing_rubric_fields_instead_of_defaulting_to_true(self):
        accepted, reason = _identity_verdict({"same": True, "confidence": 0.99})

        self.assertFalse(accepted)
        self.assertIn("missing", reason)

    def test_rejects_topology_change_even_when_category_and_color_match(self):
        accepted, reason = _identity_verdict({
            "same": False,
            "category_match": True,
            "proportion_match": False,
            "topology_match": False,
            "visible_parts_preserved": False,
            "material_color_match": True,
            "confidence": 0.96,
            "conflicts": ["open cubbies became a glass door and drawer"],
        })

        self.assertFalse(accepted)
        self.assertIn("glass door", reason)

    def test_rejects_ambiguous_low_confidence_source(self):
        accepted, reason = _identity_verdict({
            "same": True,
            "category_match": True,
            "proportion_match": True,
            "topology_match": True,
            "visible_parts_preserved": True,
            "material_color_match": True,
            "confidence": 0.51,
            "reason": "source is too blurry to confirm the divider layout",
        })

        self.assertFalse(accepted)
        self.assertIn("blurry", reason)


if __name__ == "__main__":
    unittest.main()
