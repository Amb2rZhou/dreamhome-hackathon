from pathlib import Path
import unittest

from app.services.recommendations import parse_intent_with_rules, recommend


CATALOG_PATH = Path(__file__).parents[1] / "storage" / "catalog" / "structured-assets.v1.json"


class RecommendationTests(unittest.IsolatedAsyncioTestCase):
    def test_rule_parser_extracts_replacement_preferences(self):
        intent = parse_intent_with_rules("给书房换一个白色现代办公椅")
        self.assertEqual(intent["mode"], "replacement")
        self.assertEqual(intent["room"], "study")
        self.assertEqual(intent["targetCategory"], "办公椅")
        self.assertEqual(intent["colors"], ["白色"])
        self.assertEqual(intent["styles"], ["现代"])

    async def test_proactive_reuses_structured_catalog(self):
        result = await recommend({"mode": "proactive", "limit": 5}, CATALOG_PATH)
        self.assertEqual(result["catalogSize"], 190)
        self.assertFalse(result["clarificationRequired"])
        self.assertEqual(len(result["items"]), 5)
        self.assertTrue(all(isinstance(item["trialAvailable"], bool) for item in result["items"]))

    async def test_replacement_keeps_category_and_excludes_seen(self):
        selected_id = "ast_00e00df1bfeb"
        first = await recommend({"mode": "replacement", "selectedItemId": selected_id, "limit": 4}, CATALOG_PATH)
        self.assertTrue(first["items"])
        self.assertTrue(all(item["category"] == "单椅" for item in first["items"]))
        self.assertTrue(all(item["id"] != selected_id for item in first["items"]))
        seen = [item["id"] for item in first["items"]]
        second = await recommend(
            {"mode": "replacement", "selectedItemId": selected_id, "seenItemIds": seen, "limit": 4},
            CATALOG_PATH,
        )
        self.assertTrue(all(item["id"] not in seen for item in second["items"]))

    async def test_missing_replacement_target_asks_question(self):
        result = await recommend({"query": "帮我换一个更合适的"}, CATALOG_PATH)
        self.assertTrue(result["clarificationRequired"])
        self.assertIn("哪一件家具", result["clarificationQuestion"])
        self.assertEqual(result["items"], [])
