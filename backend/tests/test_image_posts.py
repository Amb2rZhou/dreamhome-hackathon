import io
import hashlib
import base64
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app import main
from app.routers import image_posts
from app.services import selection_production


VALID_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoaGj4DwAFhAKAkzqgqgAAAABJRU5ErkJggg=="
)


class ImagePostTests(unittest.TestCase):
    def setUp(self):
        image_posts._SELECTS.clear()

    def tearDown(self):
        image_posts._SELECTS.clear()

    def _post(self, client, *, second_body=b"second", second_type="image/webp", headers=None):
        return client.post(
            "/api/image-posts/import",
            data={
                "source_url": "https://v.douyin.com/example/",
                "author": "演示作者",
                "caption": "真实图文",
                "music_title": "背景音乐",
            },
            files=[
                ("files", ("1.jpg", io.BytesIO(b"first"), "image/jpeg")),
                ("files", ("2.webp", io.BytesIO(second_body), second_type)),
            ],
            headers=headers or {},
        )

    def test_import_preserves_order_and_does_not_create_assets(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "STORAGE_DIR", tmp):
            client = TestClient(main.app)
            response = self._post(client)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual([item["index"] for item in data["slides"]], [0, 1])
            self.assertEqual(data["asset_production"]["status"], "pending_selection")
            self.assertEqual(data["asset_production"]["canonical_asset_ids"], [])
            self.assertTrue(os.path.exists(os.path.join(tmp, "image-posts", data["post_id"], "manifest.json")))

    def test_reimport_is_idempotent_but_rejects_changed_source_media(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "STORAGE_DIR", tmp):
            client = TestClient(main.app)
            first = self._post(client)
            repeated = self._post(client)
            changed = self._post(client, second_body=b"different")
            self.assertEqual(first.status_code, 200)
            self.assertEqual(repeated.status_code, 200)
            self.assertEqual(repeated.json(), first.json())
            self.assertEqual(changed.status_code, 409)

    def test_validation_failure_leaves_no_partial_post(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "STORAGE_DIR", tmp):
            client = TestClient(main.app)
            response = self._post(client, second_type="text/html")
            self.assertEqual(response.status_code, 415)
            digest = hashlib.sha256(b"https://v.douyin.com/example/").hexdigest()[:16]
            self.assertFalse(os.path.exists(os.path.join(tmp, "image-posts", f"imgpost_{digest}")))

    def test_public_deployment_requires_import_token(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.object(main.settings, "STORAGE_DIR", tmp),
            patch.object(main.settings, "REQUIRE_IMAGE_POST_IMPORT_TOKEN", True),
            patch.object(main.settings, "IMAGE_POST_IMPORT_TOKEN", "server-secret"),
        ):
            client = TestClient(main.app)
            denied = self._post(client)
            accepted = self._post(
                client, headers={"X-DreamHome-Import-Token": "server-secret"}
            )
            self.assertEqual(denied.status_code, 401)
            self.assertEqual(accepted.status_code, 200)

    def test_slide_selection_uses_image_post_route_and_production_provenance(self):
        labels = {
            "category": "茶几", "sub": "方形茶几", "colors": ["黑色"],
            "materials": ["木质"], "styles": ["现代"],
        }
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "STORAGE_DIR", tmp):
            client = TestClient(main.app)
            imported = client.post(
                "/api/image-posts/import",
                data={"source_url": "https://v.douyin.com/static-select/", "author": "作者"},
                files=[("files", ("1.png", io.BytesIO(VALID_PNG), "image/png"))],
            )
            self.assertEqual(imported.status_code, 200, imported.text)
            post_id = imported.json()["post_id"]
            with patch.object(image_posts, "extract_labels", AsyncMock(return_value=labels)):
                selected = client.post(
                    f"/api/image-posts/{post_id}/select",
                    json={
                        "slide_index": 0,
                        "bbox": [0.1, 0.1, 0.6, 0.6],
                        "polygon": [[0.1, 0.1], [0.7, 0.1], [0.7, 0.7], [0.1, 0.7]],
                    },
                )
            self.assertEqual(selected.status_code, 200, selected.text)
            select_id = selected.json()["select_id"]
            with (
                patch.object(image_posts, "production_readiness", return_value={"ready": True}),
                patch.object(
                    image_posts,
                    "start_image_selection_production",
                    return_value=("ast_image", SimpleNamespace(job_id="job_image")),
                ) as start,
            ):
                confirmed = client.post(
                    f"/api/image-posts/{post_id}/select/confirm",
                    json={"select_id": select_id, "generate_new": True, "quality_mode": "production"},
                )
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            self.assertEqual(confirmed.json()["asset_id"], "ast_image")
            self.assertEqual(start.call_args.kwargs["post_id"], post_id)
            self.assertEqual(start.call_args.kwargs["slide_index"], 0)
            bindings = client.get(f"/api/image-posts/{post_id}/asset-bindings")
            self.assertEqual(bindings.status_code, 200, bindings.text)
            self.assertEqual(bindings.json()["bindings"][0]["asset_id"], "ast_image")
            self.assertEqual(bindings.json()["bindings"][0]["slide_index"], 0)
            self.assertEqual(bindings.json()["bindings"][0]["status"], "generating")

    def test_asset_bindings_replace_same_asset_slide_but_keep_other_appearances(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "STORAGE_DIR", tmp):
            post_id = "imgpost_1234567890abcdef"
            post_dir = os.path.join(tmp, "image-posts", post_id)
            os.makedirs(post_dir)
            image_posts._write_json_atomic(
                image_posts._manifest(post_id),
                {"post_id": post_id, "slides": [{"url": "/storage/image-posts/x/01.png"}]},
            )
            image_posts._upsert_asset_binding(post_id, {
                "asset_id": "ast_same", "slide_index": 0,
                "bbox": [0.1, 0.1, 0.2, 0.2], "status": "ready",
            })
            image_posts._upsert_asset_binding(post_id, {
                "asset_id": "ast_same", "slide_index": 0,
                "bbox": [0.2, 0.2, 0.3, 0.3], "status": "ready",
            })
            image_posts._upsert_asset_binding(post_id, {
                "asset_id": "ast_same", "slide_index": 1,
                "bbox": [0.4, 0.4, 0.2, 0.2], "status": "ready",
            })
            stored = image_posts._load_asset_bindings(post_id)["bindings"]
            self.assertEqual(len(stored), 2)
            self.assertEqual(stored[0]["bbox"], [0.2, 0.2, 0.3, 0.3])
            self.assertEqual([item["slide_index"] for item in stored], [0, 1])

    def test_verified_demo_bindings_seed_a_fresh_runtime_store(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "STORAGE_DIR", tmp):
            bindings = image_posts._load_asset_bindings("imgpost_178d69ed78142afc")["bindings"]
            self.assertEqual(len(bindings), 24)
            self.assertEqual(len({item["asset_id"] for item in bindings}), 12)
            bed = next(item for item in bindings if item["asset_id"] == "ast_66867682801e")
            self.assertEqual(bed["bbox"], [0.08, 0.56, 0.76, 0.30])

    def test_image_post_production_uses_supported_persisted_job_kind(self):
        labels = {"category": "单椅", "styles": [], "materials": []}
        fake_job = SimpleNamespace(job_id="job_image")
        with (
            patch.object(selection_production.db, "insert_asset", return_value="ast_image"),
            patch.object(selection_production.db, "update_asset"),
            patch.object(
                selection_production,
                "create_workflow_job",
                return_value=fake_job,
            ) as create_job,
        ):
            asset_id, job = selection_production.start_image_selection_production(
                post_id="imgpost_1234567890abcdef",
                slide_index=0,
                bbox=[0.1, 0.1, 0.5, 0.5],
                polygon=[[0.1, 0.1], [0.6, 0.1], [0.6, 0.6]],
                isolation_mode="polygon_context",
                cutout_path="/tmp/source.jpg",
                labels=labels,
                user_id="",
            )
        self.assertEqual(asset_id, "ast_image")
        self.assertEqual(job.job_id, "job_image")
        self.assertEqual(create_job.call_args.args[0], "photo")

    def test_reusing_ready_asset_persists_the_selected_slide_geometry(self):
        labels = {"category": "单椅", "sub": "休闲椅", "styles": ["现代"]}
        ready_asset = {
            "asset_id": "ast_reused", "status": "ready", "name": "休闲椅",
            "labels": labels, "glb_url": "/storage/models/reused.glb",
            "thumb_url": "/storage/thumbs/reused.png",
        }
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "STORAGE_DIR", tmp):
            client = TestClient(main.app)
            imported = client.post(
                "/api/image-posts/import",
                data={"source_url": "https://v.douyin.com/static-reuse/", "author": "作者"},
                files=[("files", ("1.png", io.BytesIO(VALID_PNG), "image/png"))],
            )
            post_id = imported.json()["post_id"]
            with (
                patch.object(image_posts, "extract_labels", AsyncMock(return_value=labels)),
                patch.object(image_posts.matching, "match_candidates", return_value=[]),
            ):
                selected = client.post(
                    f"/api/image-posts/{post_id}/select",
                    json={
                        "slide_index": 0,
                        "bbox": [0.12, 0.18, 0.42, 0.36],
                        "polygon": [[0.12, 0.18], [0.54, 0.18], [0.54, 0.54]],
                    },
                ).json()
            with (
                patch.object(image_posts.db, "get_asset", return_value=ready_asset),
                patch.object(image_posts.db, "library_add") as library_add,
            ):
                confirmed = client.post(
                    f"/api/image-posts/{post_id}/select/confirm",
                    json={
                        "select_id": selected["select_id"],
                        "use_asset_id": "ast_reused",
                        "user_id": "local-profile-test",
                    },
                )
                bindings = client.get(f"/api/image-posts/{post_id}/asset-bindings")

            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            self.assertTrue(confirmed.json()["library_attached"])
            library_add.assert_called_once_with(
                "local-profile-test", ["ast_reused"], "image_selection_reuse",
                {"image_post_id": post_id, "slide_index": 0},
            )
            self.assertEqual(bindings.status_code, 200, bindings.text)
            self.assertEqual(bindings.json()["bindings"][0]["asset_id"], "ast_reused")
            self.assertEqual(bindings.json()["bindings"][0]["bbox"], [0.12, 0.18, 0.42, 0.36])
            self.assertEqual(bindings.json()["bindings"][0]["status"], "ready")

    def test_batch_produce_preserves_static_source_and_returns_structured_jobs(self):
        labels = {
            "category": "茶几", "sub": "方形茶几", "colors": ["黑色"],
            "materials": ["木质"], "styles": ["现代"], "features": ["方形"],
        }
        fake_job = SimpleNamespace(
            job_id="job_batch", stage="queued", progress=0,
            status=SimpleNamespace(value="queued"), error=None,
        )
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "STORAGE_DIR", tmp):
            client = TestClient(main.app)
            imported = client.post(
                "/api/image-posts/import",
                data={"source_url": "https://v.douyin.com/static-batch/", "author": "作者"},
                files=[("files", ("1.png", io.BytesIO(VALID_PNG), "image/png"))],
            )
            post_id = imported.json()["post_id"]
            with (
                patch.object(image_posts, "production_readiness", return_value={"ready": True}),
                patch.object(image_posts, "extract_labels", AsyncMock(return_value=labels)),
                patch.object(
                    image_posts,
                    "start_image_selection_production",
                    return_value=("ast_batch", fake_job),
                ),
                patch.object(image_posts, "get_job", return_value=fake_job),
            ):
                response = client.post(
                    f"/api/image-posts/{post_id}/batch-produce",
                    json={"selections": [{
                        "slide_index": 0,
                        "bbox": [0.1, 0.1, 0.6, 0.6],
                        "category_hint": "茶几",
                    }]},
                )
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()
            self.assertEqual(data["source_type"], "image_post")
            self.assertEqual(data["items"][0]["status"], "queued")
            self.assertEqual(data["items"][0]["asset_id"], "ast_batch")
            self.assertTrue(os.path.exists(os.path.join(
                tmp, "image-posts", post_id, "production-result.json",
            )))

    def test_production_result_refresh_syncs_ready_assets_to_post_manifest(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "STORAGE_DIR", tmp):
            client = TestClient(main.app)
            imported = client.post(
                "/api/image-posts/import",
                data={"source_url": "https://v.douyin.com/static-result/", "author": "作者"},
                files=[("files", ("1.png", io.BytesIO(VALID_PNG), "image/png"))],
            )
            post_id = imported.json()["post_id"]
            result_path = image_posts._production_result(post_id)
            image_posts._write_json_atomic(result_path, {
                "schema_version": 1,
                "batch_id": "imgbatch_test",
                "status": "running",
                "post_id": post_id,
                "items": [{"status": "reused", "asset_id": "ast_ready"}],
            })

            response = client.get(f"/api/image-posts/{post_id}/production-result")

            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["ready_asset_ids"], ["ast_ready"])
            refreshed_post = client.get(f"/api/image-posts/{post_id}").json()
            self.assertEqual(refreshed_post["asset_production"]["status"], "completed")
            self.assertEqual(
                refreshed_post["asset_production"]["canonical_asset_ids"],
                ["ast_ready"],
            )


if __name__ == "__main__":
    unittest.main()
