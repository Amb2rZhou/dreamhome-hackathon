"""Persistent user-edited homes: project shell, rooms, finishes and asset placements."""
import json
import time
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

from .. import db

router = APIRouter(prefix="/api/home-projects", tags=["home-projects"])


def _loads(value: str | None, fallback: Any):
    try:
        return json.loads(value or "")
    except (TypeError, json.JSONDecodeError):
        return fallback


def _project(project_id: str) -> dict | None:
    row = db._row("SELECT * FROM home_projects WHERE project_id=?", (project_id,))
    if not row:
        return None
    latest = db._row(
        "SELECT revision, document_json FROM home_project_versions "
        "WHERE project_id=? ORDER BY revision DESC LIMIT 1",
        (project_id,),
    )
    if latest:
        snapshot = _loads(latest["document_json"], {})
        if isinstance(snapshot, dict):
            snapshot["id"] = project_id
            snapshot["userId"] = row["user_id"]
            snapshot["revision"] = latest["revision"]
            return snapshot
    placements = db._rows(
        "SELECT * FROM home_placements WHERE project_id=? ORDER BY created_at, placement_id",
        (project_id,),
    )
    return {
        "schemaVersion": row["schema_version"], "id": row["project_id"],
        "userId": row["user_id"], "name": row["name"],
        "source": _loads(row["source_json"], {}),
        "envelope": _loads(row["envelope_json"], {}),
        "walls": _loads(row["walls_json"], []),
        "rooms": _loads(row["rooms_json"], []),
        "windowSlots": _loads(row["window_slots_json"], []),
        "finishes": _loads(row["finishes_json"], {}),
        "placements": [{
            "id": p["placement_id"], "homeId": p["project_id"],
            "assetId": p["asset_id"], "roomId": p["room_id"],
            "position": _loads(p["position_json"], {}),
            "rotation": _loads(p["rotation_json"], {}),
            "scale": _loads(p["scale_json"], {}),
            "customSize": _loads(p["custom_size_json"], None),
            "visible": bool(p["visible"]),
        } for p in placements],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }


@router.get("")
def list_projects(user_id: str = Query("demo")):
    return db._rows(
        "SELECT project_id, name, schema_version, created_at, updated_at "
        "FROM home_projects WHERE user_id=? ORDER BY updated_at DESC", (user_id,))


@router.get("/{project_id}")
def get_project(project_id: str):
    result = _project(project_id)
    if not result:
        raise HTTPException(404, "home project not found")
    return result


@router.put("/{project_id}")
def save_project(project_id: str, doc: dict = Body(...), user_id: str = Query("demo")):
    if doc.get("id") and doc["id"] != project_id:
        raise HTTPException(400, "project id mismatch")
    placements = doc.get("placements") or []
    now = time.time()
    conn = db.get_conn()
    with db._lock:
        old = conn.execute("SELECT created_at FROM home_projects WHERE project_id=?", (project_id,)).fetchone()
        created = old["created_at"] if old else now
        conn.execute(
            """INSERT INTO home_projects(project_id,user_id,name,schema_version,source_json,
               envelope_json,walls_json,rooms_json,window_slots_json,finishes_json,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(project_id) DO UPDATE SET user_id=excluded.user_id,name=excluded.name,
               schema_version=excluded.schema_version,source_json=excluded.source_json,
               envelope_json=excluded.envelope_json,walls_json=excluded.walls_json,
               rooms_json=excluded.rooms_json,window_slots_json=excluded.window_slots_json,
               finishes_json=excluded.finishes_json,updated_at=excluded.updated_at""",
            (project_id, user_id, doc.get("name", ""), int(doc.get("schemaVersion", 2)),
             json.dumps(doc.get("source", {}), ensure_ascii=False),
             json.dumps(doc.get("envelope", {}), ensure_ascii=False),
             json.dumps(doc.get("walls", []), ensure_ascii=False),
             json.dumps(doc.get("rooms", []), ensure_ascii=False),
             json.dumps(doc.get("windowSlots", []), ensure_ascii=False),
             json.dumps(doc.get("finishes", {}), ensure_ascii=False), created, now),
        )
        conn.execute("DELETE FROM home_placements WHERE project_id=?", (project_id,))
        for p in placements:
            aid = str(p.get("assetId", ""))
            if not aid:
                continue
            conn.execute(
                """INSERT INTO home_placements(placement_id,project_id,asset_id,room_id,
                   position_json,rotation_json,scale_json,custom_size_json,visible,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (str(p.get("id") or db.new_id("plc")), project_id, aid, str(p.get("roomId", "")),
                 json.dumps(p.get("position", {})), json.dumps(p.get("rotation", {})),
                 json.dumps(p.get("scale", {})),
                 json.dumps(p.get("customSize")) if p.get("customSize") is not None else None,
                 1 if p.get("visible", True) else 0, now, now),
            )
        revision = conn.execute(
            "SELECT COALESCE(MAX(revision),0)+1 n FROM home_project_versions WHERE project_id=?",
            (project_id,),
        ).fetchone()["n"]
        snapshot = dict(doc, id=project_id, userId=user_id)
        conn.execute(
            "INSERT INTO home_project_versions VALUES(?,?,?,?,?)",
            (db.new_id("ver"), project_id, revision,
             json.dumps(snapshot, ensure_ascii=False), now),
        )
        conn.commit()
    return {"ok": True, "project_id": project_id, "revision": revision, "updated_at": now}


@router.delete("/{project_id}")
def delete_project(project_id: str):
    conn = db.get_conn()
    with db._lock:
        conn.execute("DELETE FROM home_placements WHERE project_id=?", (project_id,))
        cur = conn.execute("DELETE FROM home_projects WHERE project_id=?", (project_id,))
        conn.commit()
    if not cur.rowcount:
        raise HTTPException(404, "home project not found")
    return {"ok": True}
