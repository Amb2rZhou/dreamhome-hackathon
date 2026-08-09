"""Image-post intake for real carousel Feed items.

This route preserves still-image semantics.  It stores the original ordered
slides and metadata but deliberately does not pretend the post is a video or
mark any furniture as a canonical asset.  Object selection and production are
separate quality-gated operations.
"""
import hashlib
import json
import os
import re
import secrets
import shutil
import time
import uuid
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import db, matching
from ..config import settings
from ..store import GenerationQueueFull, get_job
from ..schemas_lib import MatchCandidate, SelectConfirmRequest, SelectConfirmResponse, SelectResponse
from ..services.labels import extract_labels
from ..services.selection_production import production_readiness, start_image_selection_production
from pipeline.run import SKIP_GEN_CATEGORIES
from .videos import _save_selection_images, _validate_bbox

router = APIRouter(prefix="/api/image-posts", tags=["image-posts"])
ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_SLIDES = 20
MAX_SLIDE_BYTES = 12 * 1024 * 1024
POST_ID_PATTERN = re.compile(r"^imgpost_[0-9a-f]{16}$")
_SELECTS: dict[str, dict] = {}


class ImagePostSelectRequest(BaseModel):
    slide_index: int = Field(ge=0, lt=MAX_SLIDES)
    bbox: list[float]
    polygon: list[list[float]] = Field(default_factory=list)
    category_hint: str = ""


class ImagePostBatchSelection(BaseModel):
    slide_index: int = Field(ge=0, lt=MAX_SLIDES)
    bbox: list[float]
    polygon: list[list[float]] = Field(default_factory=list)
    category_hint: str = ""
    use_asset_id: str | None = None


class ImagePostBatchProduceRequest(BaseModel):
    selections: list[ImagePostBatchSelection] = Field(min_length=1, max_length=100)
    user_id: str = ""
    force: bool = False


def _root() -> Path:
    path = Path(settings.STORAGE_DIR) / "image-posts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _manifest(post_id: str) -> Path:
    return _root() / post_id / "manifest.json"


def _production_result(post_id: str) -> Path:
    return _root() / post_id / "production-result.json"


def _asset_bindings(post_id: str) -> Path:
    return _root() / post_id / "asset-bindings.json"


def _seed_asset_bindings(post_id: str) -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "image-post-bindings" / f"{post_id}.json"


def _write_json_atomic(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    os.replace(temporary, path)


def _binding_key(binding: dict) -> tuple[str, int]:
    return str(binding.get("asset_id") or ""), int(binding.get("slide_index", -1))


def _load_asset_bindings(post_id: str) -> dict:
    path = _asset_bindings(post_id)
    if not path.exists():
        seed_path = _seed_asset_bindings(post_id)
        if not seed_path.exists():
            return {"schema_version": 1, "post_id": post_id, "bindings": []}
        path = seed_path
    value = _load_manifest(path)
    if value.get("post_id") != post_id or not isinstance(value.get("bindings"), list):
        raise HTTPException(500, "stored image-post asset bindings are invalid")
    return value


def _upsert_asset_binding(post_id: str, binding: dict) -> dict:
    document = _load_asset_bindings(post_id)
    key = _binding_key(binding)
    now = time.time()
    normalized = {
        **binding,
        "asset_id": key[0],
        "slide_index": key[1],
        "bbox": _validate_bbox(binding.get("bbox") or []),
        "polygon": binding.get("polygon") or [],
        "updated_at": now,
    }
    bindings = document["bindings"]
    for index, existing in enumerate(bindings):
        if _binding_key(existing) == key:
            normalized["created_at"] = existing.get("created_at") or now
            bindings[index] = normalized
            break
    else:
        normalized["created_at"] = now
        bindings.append(normalized)
    document["updated_at"] = now
    _write_json_atomic(_asset_bindings(post_id), document)
    return normalized


def _sync_asset_bindings_from_result(post_id: str, result: dict) -> None:
    """Persist every usable batch appearance without cloning its asset."""
    for item in result.get("items") or []:
        if (
            item.get("status") not in {"ready", "reused"}
            or not item.get("asset_id")
            or item.get("slide_index") is None
            or not item.get("bbox")
        ):
            continue
        document = _load_asset_bindings(post_id)
        key = (str(item["asset_id"]), int(item.get("slide_index", -1)))
        if any(_binding_key(binding) == key for binding in document["bindings"]):
            continue
        _upsert_asset_binding(post_id, {
            "asset_id": item["asset_id"],
            "slide_index": item["slide_index"],
            "bbox": item["bbox"],
            "polygon": item.get("polygon") or [],
            "status": "ready",
            "source": "batch_production",
        })


def _refresh_asset_bindings(post_id: str) -> dict:
    document = _load_asset_bindings(post_id)
    changed = False
    for binding in document["bindings"]:
        asset = db.get_asset(str(binding.get("asset_id") or ""))
        if not asset:
            continue
        asset_status = str(asset.get("status") or "")
        status = "ready" if asset_status == "ready" else asset_status
        patch = {
            "status": status,
            "name": asset.get("name") or binding.get("name") or "已有资产",
            "labels": asset.get("labels") or binding.get("labels") or {},
            "model_url": asset.get("glb_url") or binding.get("model_url") or "",
            "thumbnail_url": asset.get("thumb_url") or binding.get("thumbnail_url") or "",
        }
        for key, value in patch.items():
            if binding.get(key) != value:
                binding[key] = value
                changed = True
    if changed:
        document["updated_at"] = time.time()
        _write_json_atomic(_asset_bindings(post_id), document)
    return document


def _label_key(labels: dict) -> tuple:
    """Conservative within-request dedupe for identical labelled selections."""
    return (
        str(labels.get("category") or ""),
        str(labels.get("sub") or ""),
        tuple(sorted(str(v) for v in labels.get("colors") or [])),
        tuple(sorted(str(v) for v in labels.get("materials") or [])),
        tuple(sorted(str(v) for v in labels.get("features") or [])),
    )


def _refresh_batch_result(result: dict) -> dict:
    for item in result.get("items") or []:
        job_id = item.get("job_id")
        if not job_id or item.get("status") in {"ready", "rejected", "skipped", "reused"}:
            continue
        job = get_job(job_id)
        if not job:
            item.update({
                "status": "rejected",
                "reason_code": "job_not_found",
                "reason": "批量生产任务记录不存在",
            })
            continue
        state = job.status.value if hasattr(job.status, "value") else str(job.status)
        item["stage"] = job.stage
        item["progress"] = job.progress
        if state == "succeeded":
            item.update({
                "status": "ready",
                "model_url": job.model_url,
                "thumbnail_url": job.thumbnail_url,
            })
        elif state == "failed":
            reason = str(job.error or "production job failed")
            item.update({
                "status": "rejected",
                "reason_code": reason.split(":", 1)[0].replace(" ", "_")[:64],
                "reason": reason[:240],
            })
        else:
            item["status"] = state

    counts = Counter(str(item.get("status") or "unknown") for item in result.get("items") or [])
    result["counts"] = dict(counts)
    result["ready_asset_ids"] = [
        item["asset_id"] for item in result.get("items") or []
        if item.get("status") in {"ready", "reused"} and item.get("asset_id")
    ]
    terminal = all(
        item.get("status") in {"ready", "rejected", "skipped", "reused"}
        for item in result.get("items") or []
    )
    result["status"] = (
        "completed_with_skips"
        if terminal and (counts.get("rejected") or counts.get("skipped"))
        else ("completed" if terminal else "running")
    )
    result["updated_at"] = time.time()
    return result


def _sync_manifest_production(post_id: str, result: dict) -> None:
    """Keep the image-post summary aligned with its refreshed batch result."""
    manifest_path = _manifest(post_id)
    if not manifest_path.exists():
        return
    manifest = _load_manifest(manifest_path)
    manifest["asset_production"] = {
        "status": result["status"],
        "batch_id": result["batch_id"],
        "result_url": f"/api/image-posts/{post_id}/production-result",
        "canonical_asset_ids": result["ready_asset_ids"],
    }
    _write_json_atomic(manifest_path, manifest)
    _sync_asset_bindings_from_result(post_id, result)


def _require_import_token(provided: str | None) -> None:
    if not settings.REQUIRE_IMAGE_POST_IMPORT_TOKEN:
        return
    expected = settings.IMAGE_POST_IMPORT_TOKEN
    if not expected:
        raise HTTPException(503, "image-post import is not configured")
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(401, "invalid image-post import token")


def _clean_text(value: str, *, field: str, limit: int, required: bool = False) -> str:
    cleaned = value.strip()
    if required and not cleaned:
        raise HTTPException(400, f"{field} is required")
    if len(cleaned) > limit:
        raise HTTPException(400, f"{field} exceeds {limit} characters")
    return cleaned


def _load_manifest(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(500, "stored image-post manifest is unreadable") from exc
    if not isinstance(value, dict):
        raise HTTPException(500, "stored image-post manifest is invalid")
    return value


@router.post("/import")
async def import_image_post(
    files: list[UploadFile] = File(...),
    source_url: str = Form(...),
    author: str = Form(...),
    caption: str = Form(""),
    music_title: str = Form(""),
    import_token: str | None = Header(default=None, alias="X-DreamHome-Import-Token"),
):
    _require_import_token(import_token)
    if not 1 <= len(files) <= MAX_SLIDES:
        raise HTTPException(400, f"image post requires 1-{MAX_SLIDES} slides")
    source_url = source_url.strip()
    parsed_url = urlparse(source_url)
    if parsed_url.scheme not in {"https", "http"} or not parsed_url.hostname:
        raise HTTPException(400, "source_url must be public http(s)")
    author = _clean_text(author, field="author", limit=120, required=True)
    caption = _clean_text(caption, field="caption", limit=4000)
    music_title = _clean_text(music_title, field="music_title", limit=200)
    digest = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:16]
    post_id = f"imgpost_{digest}"

    prepared: list[tuple[str, str, bytes, str]] = []
    for index, upload in enumerate(files, start=1):
        suffix = ALLOWED_TYPES.get(upload.content_type or "")
        if not suffix:
            raise HTTPException(415, f"unsupported slide type: {upload.content_type}")
        body = await upload.read(MAX_SLIDE_BYTES + 1)
        if not body or len(body) > MAX_SLIDE_BYTES:
            raise HTTPException(413, f"slide {index} is empty or exceeds 12 MiB")
        filename = f"{index:02d}{suffix}"
        prepared.append((filename, upload.content_type or "", body, hashlib.sha256(body).hexdigest()))

    slides = []
    for index, (filename, content_type, _body, sha256) in enumerate(prepared):
        slides.append({
            "index": index,
            "url": f"/storage/image-posts/{post_id}/{filename}",
            "content_type": content_type,
            "sha256": sha256,
        })

    host = (parsed_url.hostname or "").lower()
    manifest = {
        "schema_version": 1,
        "post_id": post_id,
        "source_type": "douyin_image_post" if host == "douyin.com" or host.endswith(".douyin.com") else "image_post",
        "source_url": source_url,
        "author": author,
        "caption": caption,
        "music": {"title": music_title, "audio_url": None},
        "slides": slides,
        "cover_url": slides[0]["url"],
        "asset_production": {
            "status": "pending_selection",
            "canonical_asset_ids": [],
        },
    }
    target = _manifest(post_id)
    if target.exists():
        existing = _load_manifest(target)
        if existing == manifest:
            return existing
        raise HTTPException(409, "image post already exists with different content")

    post_dir = target.parent
    staging = _root() / f".{post_id}.{secrets.token_hex(8)}.tmp"
    staging.mkdir(mode=0o700)
    try:
        for filename, _content_type, body, _sha256 in prepared:
            (staging / filename).write_bytes(body)
        (staging / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        try:
            os.rename(staging, post_dir)
        except FileExistsError:
            existing = _load_manifest(target)
            if existing != manifest:
                raise HTTPException(409, "image post already exists with different content")
            return existing
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return manifest


@router.get("/{post_id}")
def get_image_post(post_id: str):
    if not POST_ID_PATTERN.fullmatch(post_id):
        raise HTTPException(400, "invalid post_id")
    path = _manifest(post_id)
    if not path.exists():
        raise HTTPException(404, "image post not found")
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("/{post_id}/production-result")
def get_image_post_production_result(post_id: str):
    if not POST_ID_PATTERN.fullmatch(post_id):
        raise HTTPException(400, "invalid post_id")
    path = _production_result(post_id)
    if not path.exists():
        raise HTTPException(404, "image-post production result not found")
    result = _refresh_batch_result(_load_manifest(path))
    _write_json_atomic(path, result)
    _sync_manifest_production(post_id, result)
    return result


@router.get("/{post_id}/asset-bindings")
def get_image_post_asset_bindings(post_id: str):
    """Return persistent ready/pending asset appearances for carousel hotspots."""
    if not POST_ID_PATTERN.fullmatch(post_id):
        raise HTTPException(400, "invalid post_id")
    if not _manifest(post_id).exists():
        raise HTTPException(404, "image post not found")
    result_path = _production_result(post_id)
    if result_path.exists():
        _sync_asset_bindings_from_result(post_id, _refresh_batch_result(_load_manifest(result_path)))
    return _refresh_asset_bindings(post_id)


def _post_and_slide(post_id: str, slide_index: int) -> tuple[dict, Path]:
    if not POST_ID_PATTERN.fullmatch(post_id):
        raise HTTPException(400, "invalid post_id")
    manifest_path = _manifest(post_id)
    if not manifest_path.exists():
        raise HTTPException(404, "image post not found")
    manifest = _load_manifest(manifest_path)
    slides = manifest.get("slides") or []
    if slide_index < 0 or slide_index >= len(slides):
        raise HTTPException(404, "image-post slide not found")
    filename = Path(str(slides[slide_index].get("url") or "")).name
    slide_path = manifest_path.parent / filename
    if not filename or not slide_path.is_file() or slide_path.parent != manifest_path.parent:
        raise HTTPException(500, "stored image-post slide is unavailable")
    return manifest, slide_path


@router.post("/{post_id}/batch-produce")
async def batch_produce_image_post(post_id: str, req: ImagePostBatchProduceRequest):
    """Queue a curated static-image batch through the full production gates.

    The request keeps slide identity and selection geometry explicit. It never
    turns still images into a synthetic video, and every non-reused item enters
    the same completion/QC/TRELLIS workflow as an interactive image selection.
    """
    readiness = production_readiness()
    if not readiness["ready"]:
        raise HTTPException(503, {
            "message": "production pipeline is not ready",
            "capability": readiness,
        })
    manifest_path = _manifest(post_id)
    if not POST_ID_PATTERN.fullmatch(post_id) or not manifest_path.exists():
        raise HTTPException(404, "image post not found")
    result_path = _production_result(post_id)
    if result_path.exists() and not req.force:
        existing = _refresh_batch_result(_load_manifest(result_path))
        if existing.get("status") in {"running", "completed", "completed_with_skips"}:
            _write_json_atomic(result_path, existing)
            return existing

    result = {
        "schema_version": 1,
        "batch_id": f"imgbatch_{uuid.uuid4().hex[:16]}",
        "status": "running",
        "post_id": post_id,
        "source_type": "image_post",
        "source_url": _load_manifest(manifest_path).get("source_url"),
        "providers": {
            "detect": settings.effective_detect_provider,
            "labels": settings.effective_labels_provider,
            "completion": settings.ENHANCE_PROVIDER,
            "gen3d": settings.effective_provider,
            "material_gamma": settings.TRELLIS_ALBEDO_GAMMA,
        },
        "objects_found": len(req.selections),
        "items": [],
        "created_at": time.time(),
    }
    seen_labels: dict[tuple, int] = {}
    for object_index, selection in enumerate(req.selections):
        base_item = {
            "object_index": object_index,
            "slide_index": selection.slide_index,
            "bbox": selection.bbox,
            "polygon": selection.polygon,
        }
        if selection.use_asset_id:
            asset = db.get_asset(selection.use_asset_id)
            if not asset or asset.get("status") != "ready":
                result["items"].append({
                    **base_item,
                    "status": "skipped",
                    "reason_code": "reuse_asset_not_ready",
                    "reason": "指定复用资产不存在或尚未 ready",
                })
                continue
            result["items"].append({
                **base_item,
                "name": asset.get("name") or "已有资产",
                "labels": asset.get("labels") or {},
                "status": "reused",
                "asset_id": selection.use_asset_id,
                "model_url": asset.get("glb_url"),
                "thumbnail_url": asset.get("thumb_url"),
                "reason_code": "explicit_ready_asset_reuse",
                "reason": "用户确认复用当前图文中已生成的 ready 资产",
            })
            continue

        _manifest_data, slide_path = _post_and_slide(post_id, selection.slide_index)
        try:
            bbox = _validate_bbox(selection.bbox)
            polygon = selection.polygon or [
                [bbox[0], bbox[1]],
                [bbox[0] + bbox[2], bbox[1]],
                [bbox[0] + bbox[2], bbox[1] + bbox[3]],
                [bbox[0], bbox[1] + bbox[3]],
            ]
            (frame_path, source_context, recognition_context, _frame_size,
             isolation_mode, completion_path) = _save_selection_images(
                None, slide_path.read_bytes(), bbox, polygon,
            )
            labels = await extract_labels(
                recognition_context,
                category_hint=selection.category_hint,
                framed=True,
                strict=True,
            )
            name = labels.get("sub") or labels.get("category") or "未识别物体"
            category = labels.get("category") or "其他"
            if category == "其他" or category in SKIP_GEN_CATEGORIES:
                result["items"].append({
                    **base_item,
                    "name": name,
                    "labels": labels,
                    "status": "skipped",
                    "reason_code": "specialist_or_unsupported_category",
                    "reason": "该品类使用专项/平面化方案或不适合独立生成 3D",
                })
                continue
            key = _label_key(labels)
            if key in seen_labels:
                result["items"].append({
                    **base_item,
                    "name": name,
                    "labels": labels,
                    "status": "skipped",
                    "reason_code": "duplicate_in_image_post",
                    "reason": f"与批次对象 {seen_labels[key]} 标签完全一致，避免重复付费",
                })
                continue
            seen_labels[key] = object_index
            asset_id, job = start_image_selection_production(
                post_id=post_id,
                slide_index=selection.slide_index,
                bbox=bbox,
                polygon=polygon,
                isolation_mode=isolation_mode,
                cutout_path=source_context,
                labels=labels,
                user_id=req.user_id,
                completion_path=completion_path,
            )
            result["items"].append({
                **base_item,
                "bbox": bbox,
                "polygon": polygon,
                "name": name,
                "labels": labels,
                "status": "queued",
                "asset_id": asset_id,
                "job_id": job.job_id,
                "stage": job.stage,
                "progress": job.progress,
            })
        except GenerationQueueFull as exc:
            result["items"].append({
                **base_item,
                "status": "skipped",
                "reason_code": "generation_queue_full",
                "reason": str(exc),
            })
        except Exception as exc:
            result["items"].append({
                **base_item,
                "status": "rejected",
                "reason_code": f"prepare_{type(exc).__name__}",
                "reason": str(exc)[:240],
            })

    result = _refresh_batch_result(result)
    _write_json_atomic(result_path, result)
    _sync_manifest_production(post_id, result)
    return result


@router.post("/{post_id}/select", response_model=SelectResponse)
async def select_image_post(post_id: str, req: ImagePostSelectRequest):
    """Recognize one user-selected object from an immutable carousel slide."""
    _manifest_data, slide_path = _post_and_slide(post_id, req.slide_index)
    bbox = _validate_bbox(req.bbox)
    frame_bytes = slide_path.read_bytes()
    (frame_path, source_context, recognition_context, frame_size,
     isolation_mode, completion_path) = _save_selection_images(
        None, frame_bytes, bbox, req.polygon,
    )
    try:
        labels = await extract_labels(
            recognition_context,
            category_hint=req.category_hint,
            framed=True,
            strict=bool(req.polygon),
        )
    except RuntimeError as exc:
        raise HTTPException(503, f"production labels unavailable: {exc}") from exc

    candidates = []
    for candidate in matching.match_candidates(labels):
        asset = db.get_asset(candidate["asset_id"])
        if asset and asset.get("status") == "ready":
            candidates.append(MatchCandidate(
                asset=asset,
                score=candidate["score"],
                reason=candidate["reason"],
            ))
    select_id = uuid.uuid4().hex
    _SELECTS[select_id] = {
        "post_id": post_id,
        "slide_index": req.slide_index,
        "bbox": bbox,
        "polygon": req.polygon,
        "labels": labels,
        "frame": frame_path,
        "frame_size": frame_size,
        "source_crop": source_context,
        "recognition_context": recognition_context,
        "completion_path": completion_path,
        "isolation_mode": isolation_mode,
        "created": time.time(),
    }
    return SelectResponse(select_id=select_id, labels=labels, candidates=candidates)


@router.post("/{post_id}/select/confirm", response_model=SelectConfirmResponse)
async def confirm_image_post_selection(post_id: str, req: SelectConfirmRequest):
    selection = _SELECTS.get(req.select_id)
    if not selection or selection.get("post_id") != post_id:
        raise HTTPException(404, "select session not found (expired?)")
    if req.use_asset_id and req.generate_new:
        raise HTTPException(400, "use_asset_id and generate_new are mutually exclusive")
    if req.use_asset_id:
        asset = db.get_asset(req.use_asset_id)
        if not asset:
            raise HTTPException(404, "asset not found")
        if asset.get("status") != "ready":
            raise HTTPException(409, "only ready canonical assets can be reused")
        _upsert_asset_binding(post_id, {
            "asset_id": req.use_asset_id,
            "slide_index": selection["slide_index"],
            "bbox": selection["bbox"],
            "polygon": selection["polygon"],
            "status": "ready",
            "source": "interactive_reuse",
            "name": asset.get("name") or "已有资产",
            "labels": asset.get("labels") or {},
            "model_url": asset.get("glb_url") or "",
            "thumbnail_url": asset.get("thumb_url") or "",
        })
        _SELECTS.pop(req.select_id, None)
        library_attached = False
        if req.user_id:
            db.library_add(req.user_id, [req.use_asset_id], "image_selection_reuse", {
                "image_post_id": post_id,
                "slide_index": selection["slide_index"],
            })
            library_attached = True
        return SelectConfirmResponse(
            asset_id=req.use_asset_id,
            quality_mode="reuse",
            library_attached=library_attached,
        )
    if not req.generate_new:
        raise HTTPException(400, "either use_asset_id or generate_new=true")
    if req.quality_mode != "production":
        raise HTTPException(400, "image-post generation only supports production quality")
    if selection.get("isolation_mode") != "polygon_context":
        raise HTTPException(422, "production mode requires a valid polygon selection")
    readiness = production_readiness()
    if not readiness["ready"]:
        raise HTTPException(503, {
            "message": "production pipeline is not ready",
            "capability": readiness,
        })
    asset_id, job = start_image_selection_production(
        post_id=post_id,
        slide_index=selection["slide_index"],
        bbox=selection["bbox"],
        polygon=selection["polygon"],
        isolation_mode=selection["isolation_mode"],
        cutout_path=selection["source_crop"],
        labels=selection["labels"],
        user_id=req.user_id,
        completion_path=selection.get("completion_path") or [],
    )
    _upsert_asset_binding(post_id, {
        "asset_id": asset_id,
        "slide_index": selection["slide_index"],
        "bbox": selection["bbox"],
        "polygon": selection["polygon"],
        "status": "generating",
        "source": "interactive_generation",
        "job_id": job.job_id,
        "name": selection["labels"].get("sub") or selection["labels"].get("category") or "新资产",
        "labels": selection["labels"],
    })
    _SELECTS.pop(req.select_id, None)
    return SelectConfirmResponse(
        asset_id=asset_id,
        job_id=job.job_id,
        quality_mode="production",
        library_attached=False,
    )
