import unittest
from unittest.mock import AsyncMock, patch

from app.providers.base import Gen3DResult
from app.schemas import Job, JobStatus
from app import store
from pipeline import run as production_pipeline


class _SuccessfulProvider:
    name = "fal"

    async def submit(self, image_path, texture=True, **kwargs):
        return "provider-job"

    async def poll(self, provider_job_id):
        return Gen3DResult(
            status="succeeded",
            progress=100,
            model_url="https://provider.example/raw.glb",
        )


class GenerationMaterialGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_atomic_job_fails_closed_when_material_processing_fails(self):
        job = Job(job_id="job-1", kind="photo", status=JobStatus.queued)
        with (
            patch.object(store, "get_provider", return_value=_SuccessfulProvider()),
            patch.object(store.asyncio, "sleep", new=AsyncMock()),
            patch(
                "app.services.glb_material.materialize_postprocessed_glb",
                new=AsyncMock(side_effect=ValueError("invalid GLB")),
            ),
        ):
            await store._run(job, "/tmp/input.png", True)

        self.assertEqual(job.status, JobStatus.failed)
        self.assertIsNone(job.model_url)
        self.assertIn("material_postprocess_failed", job.error)
        self.assertIn("invalid GLB", job.error)

    async def test_atomic_job_exposes_only_backend_owned_processed_model(self):
        job = Job(job_id="job-2", kind="photo", status=JobStatus.queued)
        processed = "https://api.example/storage/models/processed.glb"
        with (
            patch.object(store, "get_provider", return_value=_SuccessfulProvider()),
            patch.object(store.asyncio, "sleep", new=AsyncMock()),
            patch(
                "app.services.glb_material.materialize_postprocessed_glb",
                new=AsyncMock(return_value=(processed, {"triangles": 1})),
            ),
        ):
            await store._run(job, "/tmp/input.png", True)

        self.assertEqual(job.status, JobStatus.succeeded)
        self.assertEqual(job.model_url, processed)

    async def test_photo_job_submits_prepared_image(self):
        job = Job(
            job_id="job-photo-prepared",
            kind="photo",
            status=JobStatus.queued,
            category="沙发",
        )
        provider = _SuccessfulProvider()
        provider.submit = AsyncMock(return_value="provider-job")
        with (
            patch.object(store, "get_provider", return_value=provider),
            patch.object(store.asyncio, "sleep", new=AsyncMock()),
            patch(
                "app.services.prepare.prepare_photo",
                new=AsyncMock(return_value=(
                    "/tmp/prepared.jpg",
                    {"prepped": True},
                )),
            ),
            patch(
                "app.services.glb_material.materialize_postprocessed_glb",
                new=AsyncMock(return_value=(
                    "https://api.example/storage/models/processed.glb",
                    {"triangles": 1},
                )),
            ),
        ):
            await store._run(job, "/tmp/original.jpg", True)

        provider.submit.assert_awaited_once_with(
            "/tmp/prepared.jpg",
            texture=True,
        )

    async def test_production_generation_rejects_when_material_gate_fails(self):
        provider = _SuccessfulProvider()
        with (
            patch.object(production_pipeline, "get_provider", return_value=provider),
            patch.object(production_pipeline.asyncio, "sleep", new=AsyncMock()),
            patch("app.services.cache.content_key", return_value="test-key"),
            patch("app.services.cache.get", return_value=None),
            patch("app.services.cache.put") as cache_put,
            patch(
                "app.services.glb_material.materialize_postprocessed_glb",
                new=AsyncMock(side_effect=ValueError("bad material")),
            ),
        ):
            model_url, status = await production_pipeline.gen3d("/tmp/input.png")

        self.assertEqual((model_url, status), ("", "rejected"))
        cache_put.assert_not_called()

    async def test_production_generation_caches_processed_glb_only(self):
        provider = _SuccessfulProvider()
        processed = "https://api.example/storage/models/processed.glb"
        with (
            patch.object(production_pipeline, "get_provider", return_value=provider),
            patch.object(production_pipeline.asyncio, "sleep", new=AsyncMock()),
            patch("app.services.cache.content_key", return_value="test-key"),
            patch("app.services.cache.get", return_value=None),
            patch("app.services.cache.put") as cache_put,
            patch(
                "app.services.glb_material.materialize_postprocessed_glb",
                new=AsyncMock(return_value=(processed, {
                    "gamma": 0.7,
                    "textures_corrected": 1,
                    "triangles": 1,
                })),
            ),
        ):
            model_url, status = await production_pipeline.gen3d("/tmp/input.png")

        self.assertEqual((model_url, status), (processed, "ready"))
        cached_payload = cache_put.call_args.args[2]
        self.assertEqual(cached_payload["glb_url"], processed)


if __name__ == "__main__":
    unittest.main()
