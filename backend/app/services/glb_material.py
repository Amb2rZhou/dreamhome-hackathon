"""Validate TRELLIS GLBs and normalize their embedded base-color materials.

Raw provider output is never considered consumer-ready.  The postprocessor
validates renderable geometry, lifts baked-in shadows with a fixed gamma curve,
normalizes metallic/base-color factors, and stores a backend-owned GLB.  An
asset marker makes the operation idempotent and prevents double correction.
"""
from __future__ import annotations

import hashlib
import io
import json
import struct
from pathlib import Path
from urllib.parse import urlparse

import httpx
from PIL import Image

from ..config import settings

_MARKER = "dreamhome_material_postprocess"


def _decode_glb(data: bytes) -> tuple[dict, bytes]:
    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError("not a GLB file")
    _, version, declared_length = struct.unpack_from("<4sII", data, 0)
    if version != 2 or declared_length != len(data):
        raise ValueError("invalid GLB v2 header")

    document = None
    binary = None
    offset = 12
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<I4s", data, offset)
        offset += 8
        payload = data[offset:offset + length]
        offset += length
        if kind == b"JSON":
            document = json.loads(payload.rstrip(b" \t\r\n\0"))
        elif kind == b"BIN\0":
            binary = payload
    if document is None or binary is None:
        raise ValueError("GLB must contain JSON and BIN chunks")
    return document, binary


def _encode_glb(document: dict, binary: bytes) -> bytes:
    document.setdefault("buffers", [{}])[0]["byteLength"] = len(binary)
    json_body = json.dumps(
        document, separators=(",", ":"), ensure_ascii=False,
    ).encode("utf-8")
    json_body += b" " * ((4 - len(json_body) % 4) % 4)
    binary += b"\0" * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(json_body) + 8 + len(binary)
    return (
        b"glTF" + struct.pack("<II", 2, total)
        + struct.pack("<I4s", len(json_body), b"JSON") + json_body
        + struct.pack("<I4s", len(binary), b"BIN\0") + binary
    )


def _base_color_images(document: dict) -> list[tuple[int, int]]:
    result: list[tuple[int, int]] = []
    seen: set[int] = set()
    textures = document.get("textures") or []
    images = document.get("images") or []
    for material in document.get("materials") or []:
        pbr = material.get("pbrMetallicRoughness") or {}
        texture_index = (pbr.get("baseColorTexture") or {}).get("index")
        if not isinstance(texture_index, int) or texture_index >= len(textures):
            continue
        image_index = textures[texture_index].get("source")
        if not isinstance(image_index, int) or image_index >= len(images) or image_index in seen:
            continue
        view_index = images[image_index].get("bufferView")
        if isinstance(view_index, int):
            result.append((image_index, view_index))
            seen.add(image_index)
    return result


def _validate_meshes(document: dict) -> dict:
    accessors = document.get("accessors") or []
    primitives = 0
    vertices = 0
    triangles = 0
    for mesh in document.get("meshes") or []:
        for primitive in mesh.get("primitives") or []:
            position_index = (primitive.get("attributes") or {}).get("POSITION")
            if not isinstance(position_index, int) or position_index >= len(accessors):
                continue
            count = int(accessors[position_index].get("count") or 0)
            if count < 3:
                continue
            primitives += 1
            vertices += count
            index_index = primitive.get("indices")
            if isinstance(index_index, int) and index_index < len(accessors):
                triangles += int(accessors[index_index].get("count") or 0) // 3
            else:
                triangles += count // 3
    if not primitives or not vertices or not triangles:
        raise ValueError("GLB has no renderable triangle mesh")
    return {"mesh_primitives": primitives, "vertices": vertices, "triangles": triangles}


def _gamma_image(data: bytes, gamma: float) -> bytes:
    image = Image.open(io.BytesIO(data)).convert("RGBA")
    table = [round(255 * ((value / 255) ** gamma)) for value in range(256)]
    rgb = image.convert("RGB").point(table * 3)
    rgb.putalpha(image.getchannel("A"))
    encoded = io.BytesIO()
    rgb.save(encoded, format="PNG", optimize=True)
    return encoded.getvalue()


def postprocess_glb_bytes(data: bytes, *, gamma: float = 0.7) -> tuple[bytes, dict]:
    """Apply the DreamHome material policy to a GLB exactly once."""
    if gamma <= 0 or gamma > 1:
        raise ValueError("TRELLIS albedo gamma must be in (0, 1]")

    document, binary = _decode_glb(data)
    geometry = _validate_meshes(document)
    extras = document.setdefault("asset", {}).setdefault("extras", {})
    previous = extras.get(_MARKER)
    if isinstance(previous, dict):
        previous_gamma = previous.get("albedo_gamma")
        if previous_gamma == gamma:
            return data, {
                "gamma": gamma,
                "textures_corrected": int(previous.get("textures_corrected") or 0),
                "already_processed": True,
                **geometry,
            }
        raise ValueError(
            f"GLB already has material postprocess gamma={previous_gamma}; refusing double correction"
        )

    views = document.get("bufferViews") or []
    corrected_count = 0
    images = sorted(
        _base_color_images(document),
        key=lambda item: int(views[item[1]].get("byteOffset") or 0),
        reverse=True,
    )
    for image_index, view_index in images:
        view = views[view_index]
        start = int(view.get("byteOffset") or 0)
        old_length = int(view["byteLength"])
        old_end = start + old_length
        image_bytes = _gamma_image(binary[start:old_end], gamma)
        padded = image_bytes + b"\0" * ((4 - len(image_bytes) % 4) % 4)
        binary = binary[:start] + padded + binary[old_end:]
        delta = len(padded) - old_length
        view["byteLength"] = len(image_bytes)
        document["images"][image_index]["mimeType"] = "image/png"
        for other_index, other in enumerate(views):
            if other_index == view_index:
                continue
            offset = int(other.get("byteOffset") or 0)
            if offset >= old_end:
                other["byteOffset"] = offset + delta
        corrected_count += 1

    if not corrected_count:
        raise ValueError("GLB has no embedded base-color texture")

    for material in document.get("materials") or []:
        pbr = material.setdefault("pbrMetallicRoughness", {})
        pbr["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]
        pbr["metallicFactor"] = 0.0

    extras[_MARKER] = {
        "version": 1,
        "albedo_gamma": gamma,
        "textures_corrected": corrected_count,
    }
    return _encode_glb(document, binary), {
        "gamma": gamma,
        "textures_corrected": corrected_count,
        "already_processed": False,
        **geometry,
    }


def _local_storage_file(url: str) -> Path | None:
    path = urlparse(url).path
    if "/storage/" not in path:
        return None
    candidate = Path(settings.STORAGE_DIR).resolve() / path.split("/storage/", 1)[1]
    return candidate if candidate.is_file() else None


async def materialize_postprocessed_glb(
    model_url: str, *, gamma: float | None = None,
) -> tuple[str, dict]:
    """Download/localize a model, apply policy, and return a backend-owned URL."""
    if not model_url:
        raise ValueError("provider returned no model URL")
    selected_gamma = settings.TRELLIS_ALBEDO_GAMMA if gamma is None else gamma
    local = _local_storage_file(model_url)
    if local:
        original = local.read_bytes()
    else:
        async with httpx.AsyncClient(
            timeout=120, follow_redirects=True, trust_env=False,
        ) as client:
            response = await client.get(model_url)
            response.raise_for_status()
            original = response.content

    processed, metadata = postprocess_glb_bytes(original, gamma=selected_gamma)
    digest = hashlib.sha256(processed).hexdigest()
    models = Path(settings.STORAGE_DIR).resolve() / "models"
    models.mkdir(parents=True, exist_ok=True)
    destination = models / f"{digest[:32]}.glb"
    if not destination.exists():
        temporary = destination.with_suffix(".glb.tmp")
        temporary.write_bytes(processed)
        temporary.replace(destination)
    metadata.update({
        "sha256": digest,
        "bytes": destination.stat().st_size,
        "source_model_url": model_url,
    })
    return f"{settings.PUBLIC_BASE_URL.rstrip('/')}/storage/models/{destination.name}", metadata
