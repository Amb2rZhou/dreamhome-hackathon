"""Feed 圈选到正式 3D 资产的薄适配层。

这里只编排现有 production pipeline 的补全、质量门、TRELLIS 和资产库能力；
不实现第二套 provider、数据库或生成逻辑。
"""
import os
import shutil
from typing import Any, Optional

from pipeline.run import SKIP_GEN_CATEGORIES, cut_quality_ok, gen3d

from .. import db
from ..config import settings
from ..schemas import Job, JobStatus
from ..store import create_workflow_job
from ..utils import workpath
from .consistency import check_consistency, check_solo
from .enhance import enhance_cutout


class SelectionProductionError(RuntimeError):
    """可直接展示给调用方的自动质量门失败。"""


def production_readiness() -> dict[str, Any]:
    """返回可公开的能力状态，不暴露任何 key 或内部地址。"""
    blockers = []
    if settings.effective_provider not in ("fal", "selfhost"):
        blockers.append("GEN3D_PROVIDER must resolve to fal or selfhost TRELLIS")
    if settings.ENHANCE_PROVIDER != "module":
        blockers.append("ENHANCE_PROVIDER must be module for DashScope completion")
    if settings.effective_labels_provider != "dashscope":
        blockers.append("LABELS_PROVIDER must resolve to dashscope")
    if not settings.DASHSCOPE_API_KEY:
        blockers.append("DASHSCOPE_API_KEY is required for automatic QC gates")
    return {
        "ready": not blockers,
        "gen3d_provider": settings.effective_provider,
        "enhance_provider": settings.ENHANCE_PROVIDER,
        "labels_provider": settings.effective_labels_provider,
        "blockers": blockers,
    }


def _description(labels: dict[str, Any]) -> str:
    category = labels.get("category") or "家具"
    sub = labels.get("sub") or ""
    return f"{sub}({category})" if sub else category


def _touches_multiple_edges(bbox: list[float]) -> bool:
    if len(bbox) != 4:
        return True
    x, y, w, h = bbox
    return sum((x < 0.01, y < 0.01, x + w > 0.99, y + h > 0.99)) >= 2


async def _produce(
    job: Job,
    *,
    asset_id: str,
    track_id: str,
    video_id: str,
    t: float,
    bbox: list[float],
    cutout_path: str,
    labels: dict[str, Any],
    user_id: str,
    polygon: Optional[list[list[float]]] = None,
    isolation_mode: str = "bbox",
    completion_path: Optional[list[tuple[int, int]]] = None,
    source_overrides: Optional[dict[str, Any]] = None,
    library_via: str = "feed-selection",
    library_context: Optional[dict[str, Any]] = None,
) -> None:
    source = {
        "video_id": video_id,
        "track_id": track_id,
        "t_best": t,
        "bbox": bbox,
        "polygon": polygon or [],
        "isolation_mode": isolation_mode,
        "completion_input": "context_with_polygon_hint",
        "pipeline": "feed-selection-production",
    }
    if source_overrides:
        source.update(source_overrides)
    desc = _description(labels)

    try:
        job.stage = "input_qc"
        job.progress = 5
        ok, reason = cut_quality_ok(cutout_path)
        if not ok:
            raise SelectionProductionError(f"input_qc: {reason}")
        if labels.get("category") == "其他":
            raise SelectionProductionError("input_qc: category is unsupported")
        if labels.get("category") in SKIP_GEN_CATEGORIES:
            raise SelectionProductionError("input_qc: category uses a specialist/planar asset path")
        if _touches_multiple_edges(bbox):
            raise SelectionProductionError("input_qc: selection touches multiple frame edges")

        job.stage = "completion"
        job.progress = 15
        enhanced_path = workpath(f"selection-{asset_id}-completed", ".png")
        completed = await enhance_cutout(
            cutout_path, enhanced_path, category=desc,
            selection_path=completion_path,
        )
        if completed == cutout_path or not os.path.exists(completed):
            raise SelectionProductionError("completion: provider did not return a completed reference")

        job.stage = "single_object_qc"
        job.progress = 35
        solo, solo_reason = await check_solo(completed, desc, strict=True)
        if not solo:
            retry_path = workpath(f"selection-{asset_id}-completed-retry", ".png")
            completed = await enhance_cutout(
                cutout_path,
                retry_path,
                category=f"{desc},画面中只保留这一件家具,彻底移除旁边的其他家具和物体",
                selection_path=completion_path,
            )
            if completed == cutout_path or not os.path.exists(completed):
                raise SelectionProductionError("single_object_qc: completion retry failed")
            solo, solo_reason = await check_solo(completed, desc, strict=True)
            if not solo:
                raise SelectionProductionError(f"single_object_qc: {solo_reason}")

        job.stage = "identity_qc"
        job.progress = 50
        same, identity_reason = await check_consistency(
            cutout_path, completed, target_name=desc, strict=True,
        )
        if not same:
            raise SelectionProductionError(f"identity_qc: {identity_reason}")

        job.stage = "generate_3d"
        job.progress = 60
        glb_url, status = await gen3d(completed)
        if status != "ready" or not glb_url:
            raise SelectionProductionError(f"generate_3d: terminal status {status}")

        job.stage = "persist"
        job.progress = 95
        thumb_dir = os.path.join(os.path.abspath(settings.STORAGE_DIR), "thumbs")
        os.makedirs(thumb_dir, exist_ok=True)
        thumb_name = f"selection_{asset_id}.png"
        shutil.copy(completed, os.path.join(thumb_dir, thumb_name))
        thumb_url = f"{settings.PUBLIC_BASE_URL.rstrip('/')}/storage/thumbs/{thumb_name}"
        source.update({
            "pipeline_status": "ready",
            "quality_gates": ["input", "completion", "single_object", "identity"],
        })
        db.update_asset(
            asset_id,
            glb_url=glb_url,
            thumb_url=thumb_url,
            source=source,
            status="ready",
        )
        if user_id:
            db.library_add(user_id, [asset_id], library_via, library_context or {
                "video_id": video_id,
                "track_id": track_id,
                "t": t,
            })
            job.library_attached = True

        job.status = JobStatus.succeeded
        job.stage = "ready"
        job.progress = 100
        job.model_url = glb_url
        job.thumbnail_url = thumb_url
    except Exception as exc:
        source.update({"pipeline_status": "rejected", "rejection_reason": str(exc)[:240]})
        db.update_asset(asset_id, source=source, status="rejected")
        raise


def start_selection_production(
    *,
    video_id: str,
    track_id: str,
    t: float,
    bbox: list[float],
    polygon: list[list[float]],
    isolation_mode: str,
    cutout_path: str,
    labels: dict[str, Any],
    user_id: str,
    completion_path: Optional[list[tuple[int, int]]] = None,
) -> tuple[str, Job]:
    """登记 canonical asset，并异步运行与批量生产一致的自动质量链。"""
    source = {
        "video_id": video_id,
        "track_id": track_id,
        "t_best": t,
        "bbox": bbox,
        "polygon": polygon,
        "isolation_mode": isolation_mode,
        "pipeline": "feed-selection-production",
        "pipeline_status": "queued",
    }
    asset_id = db.insert_asset(
        name=labels.get("sub") or labels.get("category") or "新资产",
        labels=labels,
        thumb_url="",
        source=source,
        status="generating",
        created_by="selection_pipeline",
    )

    async def runner(job: Job) -> None:
        await _produce(
            job,
            asset_id=asset_id,
            track_id=track_id,
            video_id=video_id,
            t=t,
            bbox=bbox,
            cutout_path=cutout_path,
            labels=labels,
            user_id=user_id,
            polygon=polygon,
            isolation_mode=isolation_mode,
            completion_path=completion_path,
            library_context={"video_id": video_id, "track_id": track_id, "t": t},
        )

    styles = labels.get("styles") or []
    materials = labels.get("materials") or []
    job = create_workflow_job(
        "video",
        runner,
        meta={
            "asset_id": asset_id,
            "track_id": track_id,
            "category": labels.get("category") or None,
            "style": styles[0] if styles else None,
            "material": materials[0] if materials else None,
            "quality_mode": "production",
        },
    )
    db.update_asset(asset_id, job_id=job.job_id)
    db.bind_track_asset(track_id, asset_id, binding_source="production_generation")
    return asset_id, job


def start_image_selection_production(
    *,
    post_id: str,
    slide_index: int,
    bbox: list[float],
    polygon: list[list[float]],
    isolation_mode: str,
    cutout_path: str,
    labels: dict[str, Any],
    user_id: str,
    completion_path: Optional[list[tuple[int, int]]] = None,
) -> tuple[str, Job]:
    """Run a still-image selection through the canonical production gates.

    Image posts have no video track.  Their provenance is the immutable post,
    slide index and selection geometry; they must never be registered as a
    synthetic video merely to reuse the provider pipeline.
    """
    source = {
        "source_type": "image_post_selection",
        "image_post_id": post_id,
        "slide_index": slide_index,
        "bbox": bbox,
        "polygon": polygon,
        "isolation_mode": isolation_mode,
        "pipeline": "image-post-selection-production",
        "pipeline_status": "queued",
    }
    asset_id = db.insert_asset(
        name=labels.get("sub") or labels.get("category") or "新资产",
        labels=labels,
        thumb_url="",
        source=source,
        status="generating",
        created_by="image_selection_pipeline",
    )

    async def runner(job: Job) -> None:
        await _produce(
            job,
            asset_id=asset_id,
            track_id="",
            video_id="",
            t=float(slide_index),
            bbox=bbox,
            cutout_path=cutout_path,
            labels=labels,
            user_id=user_id,
            polygon=polygon,
            isolation_mode=isolation_mode,
            completion_path=completion_path,
            source_overrides=source,
            library_via="image-post-selection",
            library_context={"image_post_id": post_id, "slide_index": slide_index},
        )

    styles = labels.get("styles") or []
    materials = labels.get("materials") or []
    job = create_workflow_job(
        # Image-post selections share the persisted photo job kind.  The
        # workflow runner still owns completion/QC/TRELLIS, so this does not
        # route through the raw photo fast path.
        "photo",
        runner,
        meta={
            "asset_id": asset_id,
            "image_post_id": post_id,
            "slide_index": slide_index,
            "category": labels.get("category") or None,
            "style": styles[0] if styles else None,
            "material": materials[0] if materials else None,
            "quality_mode": "production",
        },
    )
    db.update_asset(asset_id, job_id=job.job_id)
    return asset_id, job
