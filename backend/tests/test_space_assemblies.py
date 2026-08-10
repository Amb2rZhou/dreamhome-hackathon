import unittest
from math import cos, sin

from fastapi.testclient import TestClient

from app.main import app


class SpaceAssemblyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_bedroom_assembly_has_canonical_placements_and_valid_relationships(self):
        response = self.client.get("/api/space-assemblies/asm_bedroom_3a2749b355d9")
        self.assertEqual(response.status_code, 200)
        doc = response.json()

        self.assertEqual(doc["schema_version"], "dreamhome-space-assembly/v1")
        self.assertEqual(len(doc["placements"]), 12)
        self.assertEqual(len({item["asset_id"] for item in doc["placements"]}), 12)
        self.assertTrue(all(item["asset_id"].startswith("ast_") for item in doc["placements"]))

        nodes = (
            {item["placement_id"] for item in doc["placements"]}
            | {item["id"] for item in doc["rooms"]}
            | {item["id"] for item in doc["walls"]}
            | {item["id"] for item in doc["surfaces"]}
        )
        self.assertTrue(all(rel["subject"] in nodes and rel["object"] in nodes for rel in doc["relationships"]))
        supported = {(rel["subject"], rel["object"]) for rel in doc["relationships"] if rel["type"] == "supported_by"}
        self.assertIn(("plc_ornament_white", "plc_coffee_table"), supported)
        self.assertIn(("plc_ornament_color", "plc_coffee_table"), supported)

    def test_floor_furniture_stays_inside_room_envelope(self):
        doc = self.client.get(
            "/api/space-assemblies/asm_bedroom_3a2749b355d9"
        ).json()
        half_width = doc["envelope"]["width"] / 2
        half_depth = doc["envelope"]["depth"] / 2
        for item in doc["placements"]:
            if item["mount"] != "floor" or item["placement_id"] == "plc_rug":
                continue
            size = item["target_size_m"]
            angle = item["rotation"]["y"]
            extent_x = abs(cos(angle)) * size["width"] / 2 + abs(sin(angle)) * size["depth"] / 2
            extent_z = abs(sin(angle)) * size["width"] / 2 + abs(cos(angle)) * size["depth"] / 2
            with self.subTest(placement_id=item["placement_id"]):
                self.assertLessEqual(abs(item["position"]["x"]) + extent_x, half_width)
                self.assertLessEqual(abs(item["position"]["z"]) + extent_z, half_depth)

    def test_surface_items_have_explicit_support_and_matching_height(self):
        doc = self.client.get(
            "/api/space-assemblies/asm_bedroom_3a2749b355d9"
        ).json()
        placements = {item["placement_id"]: item for item in doc["placements"]}
        supports = {
            rel["subject"]: rel["object"]
            for rel in doc["relationships"]
            if rel["type"] == "supported_by"
        }
        for item in placements.values():
            if item["mount"] != "surface":
                continue
            host = placements[supports[item["placement_id"]]]
            host_top = host["position"]["y"] + host["target_size_m"]["height"]
            with self.subTest(placement_id=item["placement_id"]):
                self.assertAlmostEqual(item["position"]["y"], host_top, delta=0.02)

    def test_two_consumer_surfaces_resolve_to_the_same_assembly(self):
        inspiration = self.client.get(
            "/api/space-assemblies/resolve",
            params={"surface": "inspiration_library", "region": "featured_cards", "slot": "2"},
        )
        personal = self.client.get(
            "/api/space-assemblies/resolve",
            params={"surface": "personal_demo", "region": "home_projects", "slot": "primary"},
        )
        self.assertEqual(inspiration.status_code, 200)
        self.assertEqual(personal.status_code, 200)
        self.assertEqual(
            inspiration.json()["assembly"]["assembly_id"],
            personal.json()["assembly"]["assembly_id"],
        )

    def test_home_project_projection_is_frontend_ready_without_cloning_assets(self):
        response = self.client.get(
            "/api/space-assemblies/asm_bedroom_3a2749b355d9/home-project"
        )
        self.assertEqual(response.status_code, 200)
        project = response.json()
        self.assertEqual(project["schemaVersion"], 3)
        self.assertEqual(project["source"]["type"], "space_assembly")
        self.assertEqual(len(project["placements"]), 12)
        self.assertEqual(project["placements"][0]["homeId"], project["id"])
        self.assertTrue(all(item["roomId"] == "room_bedroom" for item in project["placements"]))

    def test_scene_projection_matches_existing_editor_contract(self):
        response = self.client.get(
            "/api/space-assemblies/asm_bedroom_3a2749b355d9/scene"
        )
        self.assertEqual(response.status_code, 200)
        scene = response.json()
        self.assertEqual(scene["room"], {"w": 3.6, "d": 5.4, "h": 2.8})
        self.assertEqual(len(scene["items"]), 12)
        self.assertTrue(all(len(item["pos"]) == 3 for item in scene["items"]))
        self.assertTrue(all(len(item["scale"]) == 3 for item in scene["items"]))
        self.assertTrue(all(item["glb"].endswith(".glb") for item in scene["items"]))


if __name__ == "__main__":
    unittest.main()
