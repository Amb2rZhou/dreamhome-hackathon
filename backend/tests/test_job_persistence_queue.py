import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import db, store
from app.config import settings
from app.schemas import JobStatus


class DurableJobQueueTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = settings.DB_PATH
        self.original_concurrency = settings.JOB_MAX_CONCURRENCY
        self.original_queue_max = settings.JOB_QUEUE_MAX
        if db._conn is not None:
            db._conn.close()
        db._conn = None
        settings.DB_PATH = str(Path(self.temp_dir.name) / "jobs.db")
        settings.JOB_MAX_CONCURRENCY = 1
        settings.JOB_QUEUE_MAX = 10
        store._JOBS.clear()
        store._REQUESTS.clear()
        store._WORKFLOW_RUNNERS.clear()
        store._WAITING.clear()
        store._TASKS.clear()
        store._GENERATION_SEMAPHORE = None

    async def asyncTearDown(self):
        pending = [task for task in store._TASKS.values() if not task.done()]
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        if db._conn is not None:
            db._conn.close()
        db._conn = None
        settings.DB_PATH = self.original_db_path
        settings.JOB_MAX_CONCURRENCY = self.original_concurrency
        settings.JOB_QUEUE_MAX = self.original_queue_max
        self.temp_dir.cleanup()

    async def test_heavy_jobs_execute_one_at_a_time(self):
        active = 0
        max_active = 0

        async def fake_run(job, _image_path, _texture):
            nonlocal active, max_active
            job.status = JobStatus.running
            active += 1
            max_active = max(max_active, active)
            await asyncio.sleep(0.03)
            active -= 1
            job.status = JobStatus.succeeded
            job.progress = 100
            store._persist(job)

        with patch.object(store, "_run", side_effect=fake_run):
            jobs = [
                store.create_job("photo", f"/tmp/photo-{index}.png")
                for index in range(3)
            ]
            await asyncio.gather(*(store._TASKS[job.job_id] for job in jobs))

        self.assertEqual(max_active, 1)
        self.assertTrue(all(store.get_job(job.job_id).status == JobStatus.succeeded for job in jobs))

    async def test_terminal_job_survives_memory_reset(self):
        async def fake_run(job, _image_path, _texture):
            job.status = JobStatus.succeeded
            job.progress = 100
            job.model_url = "/storage/models/result.glb"
            store._persist(job)

        with patch.object(store, "_run", side_effect=fake_run):
            job = store.create_job("photo", "/tmp/photo.png")
            await store._TASKS[job.job_id]

        store._JOBS.clear()
        store._REQUESTS.clear()
        restored = store.get_job(job.job_id)
        self.assertIsNotNone(restored)
        self.assertEqual(restored.status, JobStatus.succeeded)
        self.assertEqual(restored.model_url, "/storage/models/result.glb")

    async def test_running_atomic_job_is_rescheduled_after_restart(self):
        job = store.create_job("photo", "/tmp/photo.png")
        original_task = store._TASKS[job.job_id]
        original_task.cancel()
        await asyncio.gather(original_task, return_exceptions=True)
        job.status = JobStatus.running
        job.provider_job_id = "provider-existing"
        store._persist(job)

        store._JOBS.clear()
        store._REQUESTS.clear()
        store._WAITING.clear()
        store._TASKS.clear()
        store._GENERATION_SEMAPHORE = None
        resumed = []

        async def fake_resume(restored_job, _image_path, _texture):
            resumed.append(restored_job.provider_job_id)
            restored_job.status = JobStatus.succeeded
            store._persist(restored_job)

        with patch.object(store, "_run", side_effect=fake_resume):
            await store.restore_persisted_jobs()
            await asyncio.gather(*store._TASKS.values())

        self.assertEqual(resumed, ["provider-existing"])
        self.assertEqual(store.get_job(job.job_id).status, JobStatus.succeeded)

    async def test_queue_limit_rejects_excess_work(self):
        settings.JOB_QUEUE_MAX = 1
        blocker = asyncio.Event()

        async def fake_run(job, _image_path, _texture):
            await blocker.wait()
            job.status = JobStatus.succeeded

        with patch.object(store, "_run", side_effect=fake_run):
            first = store.create_job("photo", "/tmp/one.png")
            with self.assertRaises(store.GenerationQueueFull):
                store.create_job("photo", "/tmp/two.png")
            blocker.set()
            await store._TASKS[first.job_id]
