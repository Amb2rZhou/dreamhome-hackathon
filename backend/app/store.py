"""Durable generation jobs with bounded execution concurrency.

Jobs are persisted to SQLite before they are scheduled. Atomic photo/video/
sketch jobs can therefore be queried and resumed after an API restart. Heavy
work is guarded by one shared semaphore so a burst of requests queues safely
instead of running completion and TRELLIS concurrently on the single A10.
"""
import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Dict, Optional

from . import db
from .config import settings
from .providers import get_provider
from .schemas import Job, JobStatus

_JOBS: Dict[str, Job] = {}
_REQUESTS: Dict[str, dict] = {}
_WORKFLOW_RUNNERS: Dict[str, Callable[[Job], Awaitable[None]]] = {}
_WAITING: list[str] = []
_TASKS: Dict[str, asyncio.Task] = {}
_GENERATION_SEMAPHORE: Optional[asyncio.Semaphore] = None


class GenerationQueueFull(RuntimeError):
    pass


def _job_document(job: Job) -> dict:
    if hasattr(job, "model_dump"):
        return job.model_dump(mode="json")
    return job.dict()


def _job_from_document(document: dict) -> Job:
    if hasattr(Job, "model_validate"):
        return Job.model_validate(document)
    return Job.parse_obj(document)


def _persist(job: Job, request: Optional[dict] = None) -> None:
    db.upsert_generation_job(job.job_id, _job_document(job), request)


def _refresh_queue_metadata() -> None:
    depth = len(_WAITING)
    for index, job_id in enumerate(_WAITING):
        job = _JOBS.get(job_id)
        if not job:
            continue
        job.queue_position = index + 1
        job.queue_depth = depth


def get_job(job_id: str) -> Optional[Job]:
    job = _JOBS.get(job_id)
    if not job:
        stored = db.get_generation_job(job_id)
        if not stored:
            return None
        job = _job_from_document(stored["job"])
        _JOBS[job_id] = job
        _REQUESTS[job_id] = stored["request"]
    _refresh_queue_metadata()
    _persist(job)
    return job


def _capacity_available() -> bool:
    active = sum(
        1 for job in _JOBS.values()
        if job.status in (JobStatus.queued, JobStatus.running)
    )
    return active < settings.JOB_QUEUE_MAX


def _schedule(job_id: str) -> None:
    existing = _TASKS.get(job_id)
    if existing and not existing.done():
        return
    if job_id not in _WAITING:
        _WAITING.append(job_id)
    _refresh_queue_metadata()
    _persist(_JOBS[job_id])
    _TASKS[job_id] = asyncio.create_task(_execute_queued(job_id))


def create_job(kind: str, image_path: str, *, texture: bool = True,
               meta: Optional[dict] = None) -> Job:
    if not _capacity_available():
        raise GenerationQueueFull("generation queue is full")
    provider = get_provider()
    job = Job(
        job_id=uuid.uuid4().hex,
        kind=kind,
        status=JobStatus.queued,
        provider=provider.name,
        stage="queued",
        **(meta or {}),
    )
    request = {
        "mode": "atomic",
        "kind": kind,
        "image_path": image_path,
        "texture": texture,
    }
    _JOBS[job.job_id] = job
    _REQUESTS[job.job_id] = request
    _persist(job, request)
    _schedule(job.job_id)
    return job


def create_workflow_job(kind: str, runner: Callable[[Job], Awaitable[None]], *,
                        meta: Optional[dict] = None) -> Job:
    if not _capacity_available():
        raise GenerationQueueFull("generation queue is full")
    provider = get_provider()
    job = Job(
        job_id=uuid.uuid4().hex,
        kind=kind,
        status=JobStatus.queued,
        provider=provider.name,
        stage="queued",
        **(meta or {}),
    )
    request = {"mode": "workflow", "kind": kind}
    _JOBS[job.job_id] = job
    _REQUESTS[job.job_id] = request
    _WORKFLOW_RUNNERS[job.job_id] = runner
    _persist(job, request)
    _schedule(job.job_id)
    return job


async def _execute_queued(job_id: str) -> None:
    global _GENERATION_SEMAPHORE
    if _GENERATION_SEMAPHORE is None:
        _GENERATION_SEMAPHORE = asyncio.Semaphore(settings.JOB_MAX_CONCURRENCY)
    job = _JOBS[job_id]
    request = _REQUESTS.get(job_id, {})
    async with _GENERATION_SEMAPHORE:
        if job_id in _WAITING:
            _WAITING.remove(job_id)
        _refresh_queue_metadata()
        job.queue_position = 0
        job.queue_depth = len(_WAITING)
        _persist(job)
        if request.get("mode") == "workflow":
            runner = _WORKFLOW_RUNNERS.get(job_id)
            if not runner:
                job.status = JobStatus.failed
                job.stage = "failed"
                job.error = "interrupted_workflow: please submit again"
                _persist(job)
                return
            await _run_workflow(job, runner)
            return
        await _run(
            job,
            request.get("image_path", ""),
            bool(request.get("texture", True)),
        )


async def _run(job: Job, image_path: str, texture: bool) -> None:
    provider = get_provider()
    try:
        # A persisted provider id means the expensive submit already happened
        # before an API restart. Resume polling instead of generating twice.
        if not job.provider_job_id:
            source_path = image_path
            if job.kind == "photo":
                job.status = JobStatus.running
                job.stage = "prepare_photo"
                job.progress = max(job.progress, 5)
                _persist(job)
                from .services.prepare import prepare_photo

                source_path, _preparation = await prepare_photo(
                    image_path,
                    category=job.category or "",
                )
                job.stage = "generate_3d"
                job.progress = max(job.progress, 10)
                _persist(job)
            provider_job_id = await provider.submit(source_path, texture=texture)
            job.provider_job_id = provider_job_id
            job.status = JobStatus.running
            _persist(job)
        provider_job_id = job.provider_job_id
        for _ in range(150):
            await asyncio.sleep(2)
            result = await provider.poll(provider_job_id)
            job.progress = result.progress
            if result.status == "succeeded":
                model_url = result.model_url
                if not model_url:
                    job.status = JobStatus.failed
                    job.stage = "failed"
                    job.error = "material_postprocess_failed: provider returned no model URL"
                    _persist(job)
                    return
                try:
                    from .services.glb_material import materialize_postprocessed_glb
                    model_url, _metadata = await materialize_postprocessed_glb(model_url)
                except Exception as exc:
                    job.status = JobStatus.failed
                    job.stage = "failed"
                    job.error = (
                        "material_postprocess_failed: "
                        f"{type(exc).__name__}: {exc}"
                    )
                    _persist(job)
                    return
                job.status = JobStatus.succeeded
                job.stage = "ready"
                job.progress = 100
                job.model_url = model_url
                job.thumbnail_url = result.thumbnail_url or job.thumbnail_url
                _persist(job)
                return
            if result.status == "failed":
                job.status = JobStatus.failed
                job.stage = "failed"
                job.error = result.error or "generation failed"
                _persist(job)
                return
            job.status = JobStatus.running
            _persist(job)
        job.status = JobStatus.failed
        job.stage = "failed"
        job.error = "timeout"
        _persist(job)
    except Exception as exc:
        job.status = JobStatus.failed
        job.stage = "failed"
        job.error = f"{type(exc).__name__}: {exc}"
        _persist(job)


async def _run_workflow(job: Job, runner: Callable[[Job], Awaitable[None]]) -> None:
    job.status = JobStatus.running
    _persist(job)
    try:
        await runner(job)
        if job.status not in (JobStatus.succeeded, JobStatus.failed):
            job.status = JobStatus.succeeded
            job.progress = 100
        _persist(job)
    except Exception as exc:
        job.status = JobStatus.failed
        job.stage = "failed"
        job.error = f"{type(exc).__name__}: {exc}"
        _persist(job)


async def restore_persisted_jobs() -> None:
    """Load prior jobs and resume restart-safe atomic work."""
    for stored in db.list_generation_jobs(include_terminal=True):
        job = _job_from_document(stored["job"])
        request = stored["request"]
        _JOBS[job.job_id] = job
        _REQUESTS[job.job_id] = request
        if job.status not in (JobStatus.queued, JobStatus.running):
            continue
        if request.get("mode") == "atomic" and request.get("image_path"):
            job.status = JobStatus.queued
            job.stage = "queued"
            _persist(job)
            _schedule(job.job_id)
        else:
            job.status = JobStatus.failed
            job.stage = "failed"
            job.error = "interrupted_workflow: please submit again"
            _persist(job)
