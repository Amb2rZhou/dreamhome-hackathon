"""Read-only spatial assemblies shared by inspiration cases and personal demos.

An assembly is not a canonical asset and does not clone furniture. It stores a
room envelope, canonical asset placements, explicit spatial relationships and
consumer bindings. Frontends may render the assembly directly or request the
compatible home-project projection.
"""
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/space-assemblies", tags=["space-assemblies"])

ASSEMBLY_DIR = Path(__file__).resolve().parents[2] / "storage" / "space_assemblies"


def _documents() -> list[dict[str, Any]]:
    documents = []
    for path in sorted(ASSEMBLY_DIR.glob("*.json")) if ASSEMBLY_DIR.exists() else []:
        doc = json.loads(path.read_text(encoding="utf-8"))
        _validate(doc, path)
        documents.append(doc)
    return documents


def _validate(doc: dict[str, Any], path: Path) -> None:
    assembly_id = doc.get("assembly_id")
    if not isinstance(assembly_id, str) or not assembly_id.startswith("asm_"):
        raise RuntimeError(f"invalid assembly_id in {path}")
    room_ids = {item.get("id") for item in doc.get("rooms", [])}
    placement_ids = {item.get("placement_id") for item in doc.get("placements", [])}
    node_ids = room_ids | placement_ids | {
        item.get("id") for item in doc.get("surfaces", [])
    } | {
        item.get("id") for item in doc.get("walls", [])
    }
    if None in node_ids or len(placement_ids) != len(doc.get("placements", [])):
        raise RuntimeError(f"duplicate or missing node id in {path}")
    for placement in doc.get("placements", []):
        if placement.get("room_id") not in room_ids:
            raise RuntimeError(f"unknown room for {placement.get('placement_id')} in {path}")
        if not str(placement.get("asset_id", "")).startswith("ast_"):
            raise RuntimeError(f"invalid canonical asset reference in {path}")
    for relation in doc.get("relationships", []):
        if relation.get("subject") not in node_ids or relation.get("object") not in node_ids:
            raise RuntimeError(f"unknown relationship node in {path}: {relation}")


def _get(assembly_id: str) -> dict[str, Any]:
    for doc in _documents():
        if doc["assembly_id"] == assembly_id:
            return doc
    raise HTTPException(404, "space assembly not found")


def _summary(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "assembly_id": doc["assembly_id"],
        "schema_version": doc["schema_version"],
        "title": doc.get("title", ""),
        "status": doc.get("status", ""),
        "room_count": len(doc.get("rooms", [])),
        "placement_count": len(doc.get("placements", [])),
        "bindings": doc.get("consumer_bindings", []),
    }


@router.get("")
def list_space_assemblies():
    return [_summary(doc) for doc in _documents()]


@router.get("/resolve")
def resolve_space_assembly(
    surface: str = Query(...),
    region: str = Query(...),
    slot: str = Query(...),
):
    for doc in _documents():
        for binding in doc.get("consumer_bindings", []):
            if (
                binding.get("surface") == surface
                and binding.get("region") == region
                and str(binding.get("slot")) == slot
            ):
                return {"binding": binding, "assembly": doc}
    raise HTTPException(404, "space assembly binding not found")


@router.get("/{assembly_id}")
def get_space_assembly(assembly_id: str):
    return _get(assembly_id)


@router.get("/{assembly_id}/scene")
def get_scene_projection(assembly_id: str):
    """Project an assembly to the scene shape already understood by the 3D editor."""
    doc = _get(assembly_id)
    envelope = doc["envelope"]
    return {
        "assembly_id": assembly_id,
        "title": doc["title"],
        "room": {
            "w": envelope["width"],
            "d": envelope["depth"],
            "h": envelope["height"],
        },
        "balcony": None,
        "extras": [],
        "cfg": doc.get("environment", {}),
        "items": [
            {
                "id": placement["asset_id"],
                "placementId": placement["placement_id"],
                "name": placement["name"],
                "glb": placement["model_url"],
                "tags": placement.get("tags", []),
                "sizePrior": {
                    "w": placement["target_size_m"]["width"],
                    "h": placement["target_size_m"]["height"],
                    "d": placement["target_size_m"]["depth"],
                },
                "pos": [
                    placement["position"]["x"],
                    placement["position"]["y"],
                    placement["position"]["z"],
                ],
                "rotYDeg": placement["rotation"]["y"] * 180 / 3.141592653589793,
                "scale": [
                    placement["scale"]["x"],
                    placement["scale"]["y"],
                    placement["scale"]["z"],
                ],
                "mount": placement["mount"],
            }
            for placement in doc.get("placements", [])
        ],
        "relationships": doc.get("relationships", []),
    }


@router.get("/{assembly_id}/home-project")
def get_home_project_projection(assembly_id: str):
    doc = _get(assembly_id)
    envelope = doc["envelope"]
    room = doc["rooms"][0]
    project_id = doc["project_seed_id"]
    return {
        "schemaVersion": 3,
        "id": project_id,
        "name": doc["title"],
        "source": {
            "type": "space_assembly",
            "assemblyId": assembly_id,
            "imagePostId": doc.get("source", {}).get("image_post_id"),
        },
        "realScene": {
            "room": {"w": envelope["width"], "d": envelope["depth"], "h": envelope["height"]},
            "balcony": None,
            "extras": [],
            "cfg": doc.get("environment", {}),
        },
        "envelope": {"width": envelope["width"], "depth": envelope["depth"]},
        "walls": doc.get("walls", []),
        "rooms": doc.get("rooms", []),
        "windowSlots": doc.get("window_slots", []),
        "finishes": doc.get("finishes", {}),
        "daylight": doc.get("environment", {}).get("light", "day"),
        "placements": [
            {
                "id": placement["placement_id"],
                "homeId": project_id,
                "assetId": placement["asset_id"],
                "roomId": placement["room_id"],
                "position": placement["position"],
                "rotation": placement["rotation"],
                "scale": placement["scale"],
                "sourceScale": placement["scale"],
                "customSize": placement.get("target_size_m"),
                "visible": placement.get("visible", True),
            }
            for placement in doc.get("placements", [])
        ],
        "relationships": doc.get("relationships", []),
    }
