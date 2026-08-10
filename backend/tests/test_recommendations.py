from pathlib import Path
import unittest

from app.services.recommendations import (
    parse_intent,
    parse_intent_with_rules,
    recommend,
    recommend_from_catalog,
)


CATALOG_PATH = Path(__file__).parents[1] / "storage" / "catalog" / "structured-assets.v1.json"


class RecommendationTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def asset(
        asset_id,
        category,
        *,
        status="ready",
        video="",
        styles=None,
        colors=None,
        materials=None,
        appearances=1,
        model=True,
        thumbnail=True,
    ):
        return {
            "asset_id": asset_id,
            "name": f"{category}-{asset_id}",
            "status": status,
            "classification": {"category": category, "subcategory": category},
            "tags": {"normalized": {
                "styles": styles or [],
                "colors": colors or [],
                "materials": materials or [],
            }},
            "source": {"video_id": video},
            "appearance_count": appearances,
            "media": {
                "thumbnail": f"/{asset_id}.png" if thumbnail else "",
                "model_3d": f"/{asset_id}.glb" if model else "",
            },
        }

    def test_rule_parser_extracts_replacement_preferences(self):
        intent = parse_intent_with_rules("给书房换一个白色现代办公椅")
        self.assertEqual(intent["mode"], "replacement")
        self.assertEqual(intent["room"], "study")
        self.assertEqual(intent["targetCategory"], "单椅")
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

    def test_filters_non_ready_placed_seen_and_selected_assets(self):
        assets = [
            self.asset("ready", "灯具"),
            self.asset("draft", "灯具", status="processing"),
            self.asset("placed", "灯具"),
            self.asset("seen", "灯具"),
            self.asset("selected", "灯具"),
        ]
        items = recommend_from_catalog(assets, {
            "mode": "replacement",
            "targetCategory": "灯具",
            "placedItemIds": ["placed"],
            "seenItemIds": ["seen"],
            "selectedItemId": "selected",
            "limit": 6,
        }, {"mode": "replacement"})
        self.assertEqual([item["id"] for item in items], ["ready"])

    def test_replacement_returns_only_the_target_category(self):
        assets = [self.asset("lamp", "灯具"), self.asset("chair", "单椅")]
        items = recommend_from_catalog(assets, {
            "mode": "replacement", "targetCategory": "灯具", "limit": 6,
        }, {"mode": "replacement"})
        self.assertTrue(items)
        self.assertTrue(all(item["category"] == "灯具" for item in items))

    def test_same_video_and_exact_tags_add_the_documented_scores(self):
        assets = [
            self.asset("plain", "灯具", appearances=1),
            self.asset(
                "matched", "灯具", video="vid_home", styles=["现代"],
                colors=["白色"], materials=["金属"], appearances=1,
            ),
        ]
        items = recommend_from_catalog(assets, {
            "mode": "space",
            "targetCategory": "灯具",
            "styles": ["现代"],
            "colors": ["白色"],
            "materials": ["金属"],
            "sourceVideoId": "vid_home",
            "limit": 2,
        }, {"mode": "space"})
        scores = {item["id"]: item["score"] for item in items}
        self.assertEqual(scores["matched"] - scores["plain"], 50)
        matched = next(item for item in items if item["id"] == "matched")
        self.assertEqual(
            matched["reasonCodes"],
            ["functional_complement", "missing_category", "same_video", "style_match", "color_match", "material_match"],
        )

    def test_complement_and_missing_categories_are_prioritized(self):
        assets = [self.asset("lamp", "灯具"), self.asset("appliance", "家电")]
        items = recommend_from_catalog(assets, {
            "mode": "space", "categories": ["床"], "limit": 2,
        }, {"mode": "space"})
        self.assertEqual(items[0]["id"], "lamp")
        self.assertIn("functional_complement", items[0]["reasonCodes"])
        self.assertIn("missing_category", items[0]["reasonCodes"])

    def test_room_priority_does_not_invent_a_functional_complement(self):
        items = recommend_from_catalog(
            [self.asset("bed", "床", styles=["现代"])],
            {"mode": "space", "room": "bedroom", "styles": ["现代"], "limit": 1},
            {"mode": "space", "room": "bedroom"},
        )
        self.assertNotIn("functional_complement", items[0]["reasonCodes"])
        self.assertIn("missing_category", items[0]["reasonCodes"])

    def test_first_four_are_diverse_and_caps_category_and_same_video(self):
        categories = ["灯具", "柜子", "地毯", "装饰", "绿植", "桌子"]
        assets = []
        for category in categories:
            assets.extend([
                self.asset(f"{category}-same", category, video="vid_home", appearances=9),
                self.asset(f"{category}-other", category, video="vid_other", appearances=8),
                self.asset(f"{category}-third", category, video="vid_third", appearances=7),
            ])
        items = recommend_from_catalog(assets, {
            "mode": "space",
            "categories": ["床"],
            "sourceVideoId": "vid_home",
            "limit": 6,
        }, {"mode": "space"})
        self.assertEqual(len(items), 6)
        self.assertEqual(len({item["category"] for item in items[:4]}), 4)
        self.assertEqual(len({item["id"] for item in items}), 6)
        category_counts = {category: sum(item["category"] == category for item in items) for category in categories}
        self.assertLessEqual(max(category_counts.values()), 2)
        same_video_ids = {f"{category}-same" for category in categories}
        self.assertLessEqual(sum(item["id"] in same_video_ids for item in items), 2)

    def test_missing_model_remains_but_trial_is_disabled(self):
        items = recommend_from_catalog(
            [self.asset("no-model", "装饰", model=False)],
            {"mode": "proactive", "limit": 1},
            {"mode": "proactive"},
        )
        self.assertEqual(items[0]["id"], "no-model")
        self.assertFalse(items[0]["trialAvailable"])

    async def test_batches_are_stable_and_seen_ids_change_the_whole_batch(self):
        request = {"mode": "space", "room": "living", "limit": 6}
        first = await recommend(request, CATALOG_PATH)
        repeated = await recommend(request, CATALOG_PATH)
        self.assertEqual([item["id"] for item in first["items"]], [item["id"] for item in repeated["items"]])
        second = await recommend({**request, "seenItemIds": first["nextSeenItemIds"]}, CATALOG_PATH)
        self.assertFalse(set(item["id"] for item in first["items"]) & set(item["id"] for item in second["items"]))
        self.assertEqual(second["strategyVersion"], "structured-multirecall-v1")

    async def test_query_compatibility_never_calls_an_external_model(self):
        fallback = parse_intent_with_rules("给卧室推荐现代灯具", "space")
        parsed = await parse_intent("给卧室推荐现代灯具", fallback)
        self.assertIs(parsed, fallback)
        self.assertEqual(parsed["source"], "rules")

    async def test_missing_replacement_target_asks_question(self):
        result = await recommend({"query": "帮我换一个更合适的"}, CATALOG_PATH)
        self.assertTrue(result["clarificationRequired"])
        self.assertIn("哪一件家具", result["clarificationQuestion"])
        self.assertEqual(result["items"], [])
