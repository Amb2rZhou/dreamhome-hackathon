"""SQLite 持久层：视频 / 轨迹 / 资产 / 用户收藏。

hackathon 体量用单文件 SQLite + JSON TEXT 列，不引 ORM；生产换 PG + 对象存储。
bbox 约定：归一化 [x, y, w, h]，原点左上，0-1。
"""
import json
import os
import sqlite3
import threading
import time
import uuid
from typing import Any, Optional

from .config import settings

_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS videos(
  video_id     TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  source_url   TEXT NOT NULL DEFAULT '',   -- 原视频出处(抖音链接等)
  play_url     TEXT NOT NULL DEFAULT '',   -- 可播放地址(本地 storage / CDN)
  cover_url    TEXT NOT NULL DEFAULT '',
  duration     REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'unindexed',  -- unindexed|processing|indexed
  index_source TEXT NOT NULL DEFAULT '',           -- offline|lazy
  created_at   REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS tracks(
  track_id     TEXT PRIMARY KEY,
  video_id     TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT '',
  t_start      REAL NOT NULL DEFAULT 0,
  t_end        REAL NOT NULL DEFAULT 0,
  frames_json  TEXT NOT NULL DEFAULT '[]',  -- [{"t":1.2,"bbox":[x,y,w,h]}]
  keyframe_masks_json TEXT NOT NULL DEFAULT '[]',
  best_frame_t REAL NOT NULL DEFAULT 0,
  asset_id     TEXT,                        -- NULL = 检测到但未入库(可圈选)
  created_at   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_video ON tracks(video_id);
CREATE TABLE IF NOT EXISTS assets(
  asset_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  space        TEXT NOT NULL DEFAULT '',    -- 客厅/卧室/餐厨/通用
  labels_json  TEXT NOT NULL DEFAULT '{}',  -- 匹配依据，合并时取并集
  size_prior_json TEXT,
  embedding    BLOB,                        -- f32 数组，仅排序辅助
  glb_url      TEXT NOT NULL DEFAULT '',
  thumb_url    TEXT NOT NULL DEFAULT '',
  source_json  TEXT NOT NULL DEFAULT '{}',  -- {video_id,track_id,t_best} 溯源
  merged_from_json TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'generating',  -- generating|ready|rejected
  job_id       TEXT,                        -- 生成中时挂的 3D job
  created_by   TEXT NOT NULL DEFAULT 'preset',
  created_at   REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS user_library(
  user_id  TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  via      TEXT NOT NULL DEFAULT '',
  added_at REAL NOT NULL,
  PRIMARY KEY(user_id, asset_id)
);
CREATE TABLE IF NOT EXISTS home_projects(
  project_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 3,
  source_json TEXT NOT NULL DEFAULT '{}',
  envelope_json TEXT NOT NULL DEFAULT '{}',
  walls_json TEXT NOT NULL DEFAULT '[]',
  rooms_json TEXT NOT NULL DEFAULT '[]',
  window_slots_json TEXT NOT NULL DEFAULT '[]',
  finishes_json TEXT NOT NULL DEFAULT '{}',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_home_projects_user ON home_projects(user_id, updated_at);
CREATE TABLE IF NOT EXISTS home_placements(
  placement_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  room_id TEXT NOT NULL DEFAULT '',
  position_json TEXT NOT NULL DEFAULT '{}',
  rotation_json TEXT NOT NULL DEFAULT '{}',
  scale_json TEXT NOT NULL DEFAULT '{}',
  custom_size_json TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_home_placements_project ON home_placements(project_id);
CREATE TABLE IF NOT EXISTS home_project_versions(
  version_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  document_json TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_home_versions_revision ON home_project_versions(project_id, revision);
CREATE TABLE IF NOT EXISTS generation_jobs(
  job_id TEXT PRIMARY KEY,
  document_json TEXT NOT NULL,
  request_json TEXT NOT NULL DEFAULT '{}',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_updated ON generation_jobs(updated_at);
"""


def get_conn() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            os.makedirs(os.path.dirname(os.path.abspath(settings.DB_PATH)), exist_ok=True)
            _conn = sqlite3.connect(settings.DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.executescript(_SCHEMA)
            _conn.commit()
        return _conn


def _exec(sql: str, params: tuple = ()) -> sqlite3.Cursor:
    conn = get_conn()
    with _lock:
        cur = conn.execute(sql, params)
        conn.commit()
    return cur


def _rows(sql: str, params: tuple = ()) -> list[dict]:
    conn = get_conn()
    with _lock:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def _row(sql: str, params: tuple = ()) -> Optional[dict]:
    rs = _rows(sql, params)
    return rs[0] if rs else None


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ---- durable generation jobs ----

def upsert_generation_job(job_id: str, document: dict, request: Optional[dict] = None) -> None:
    now = time.time()
    existing = _row("SELECT request_json,created_at FROM generation_jobs WHERE job_id=?", (job_id,))
    request_json = json.dumps(
        request if request is not None else json.loads(existing["request_json"] or "{}")
        if existing else {},
        ensure_ascii=False,
    )
    created_at = existing["created_at"] if existing else now
    _exec(
        "INSERT INTO generation_jobs(job_id,document_json,request_json,created_at,updated_at)"
        " VALUES(?,?,?,?,?)"
        " ON CONFLICT(job_id) DO UPDATE SET document_json=excluded.document_json,"
        " request_json=excluded.request_json,updated_at=excluded.updated_at",
        (
            job_id,
            json.dumps(document, ensure_ascii=False),
            request_json,
            created_at,
            now,
        ),
    )


def get_generation_job(job_id: str) -> Optional[dict]:
    row = _row("SELECT * FROM generation_jobs WHERE job_id=?", (job_id,))
    if not row:
        return None
    return {
        "job": json.loads(row["document_json"]),
        "request": json.loads(row["request_json"] or "{}"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_generation_jobs(*, include_terminal: bool = True) -> list[dict]:
    rows = _rows("SELECT * FROM generation_jobs ORDER BY created_at")
    result = []
    for row in rows:
        document = json.loads(row["document_json"])
        if not include_terminal and document.get("status") in {"succeeded", "failed"}:
            continue
        result.append({
            "job": document,
            "request": json.loads(row["request_json"] or "{}"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        })
    return result


# ---- videos ----

def insert_video(**kw) -> str:
    vid = kw.get("video_id") or new_id("vid")
    _exec(
        "INSERT INTO videos(video_id,title,source_url,play_url,cover_url,duration,status,index_source,created_at)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (vid, kw.get("title", ""), kw.get("source_url", ""), kw.get("play_url", ""),
         kw.get("cover_url", ""), kw.get("duration", 0), kw.get("status", "unindexed"),
         kw.get("index_source", ""), time.time()),
    )
    return vid


def list_videos() -> list[dict]:
    return _rows("SELECT * FROM videos ORDER BY created_at DESC")


def get_video(video_id: str) -> Optional[dict]:
    return _row("SELECT * FROM videos WHERE video_id=?", (video_id,))


def set_video_status(video_id: str, status: str, index_source: str = "") -> None:
    _exec("UPDATE videos SET status=?, index_source=? WHERE video_id=?",
          (status, index_source, video_id))


# ---- tracks ----

def insert_track(video_id: str, category: str, frames: list[dict], *,
                 t_start: float = 0, t_end: float = 0, best_frame_t: float = 0,
                 keyframe_masks: Optional[list] = None, asset_id: Optional[str] = None) -> str:
    tid = new_id("trk")
    _exec(
        "INSERT INTO tracks(track_id,video_id,category,t_start,t_end,frames_json,"
        "keyframe_masks_json,best_frame_t,asset_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (tid, video_id, category, t_start, t_end, json.dumps(frames),
         json.dumps(keyframe_masks or []), best_frame_t, asset_id, time.time()),
    )
    return tid


def tracks_of_video(video_id: str) -> list[dict]:
    rows = _rows("SELECT * FROM tracks WHERE video_id=? ORDER BY t_start", (video_id,))
    for r in rows:
        r["frames"] = json.loads(r.pop("frames_json"))
        r["keyframe_masks"] = json.loads(r.pop("keyframe_masks_json"))
    return rows


def get_track(track_id: str) -> Optional[dict]:
    r = _row("SELECT * FROM tracks WHERE track_id=?", (track_id,))
    if r:
        r["frames"] = json.loads(r.pop("frames_json"))
        r["keyframe_masks"] = json.loads(r.pop("keyframe_masks_json"))
    return r


def bind_track_asset(track_id: str, asset_id: str) -> None:
    _exec("UPDATE tracks SET asset_id=? WHERE track_id=?", (asset_id, track_id))


def rebind_tracks(from_asset: str, to_asset: str) -> None:
    _exec("UPDATE tracks SET asset_id=? WHERE asset_id=?", (to_asset, from_asset))


# ---- assets ----

def insert_asset(**kw) -> str:
    aid = kw.get("asset_id") or new_id("ast")
    _exec(
        "INSERT INTO assets(asset_id,name,space,labels_json,size_prior_json,embedding,"
        "glb_url,thumb_url,source_json,merged_from_json,status,job_id,created_by,created_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (aid, kw.get("name", ""), kw.get("space", ""), json.dumps(kw.get("labels", {}), ensure_ascii=False),
         json.dumps(kw.get("size_prior")) if kw.get("size_prior") else None,
         kw.get("embedding"), kw.get("glb_url", ""), kw.get("thumb_url", ""),
         json.dumps(kw.get("source", {}), ensure_ascii=False), json.dumps(kw.get("merged_from", [])),
         kw.get("status", "generating"), kw.get("job_id"), kw.get("created_by", "preset"), time.time()),
    )
    return aid


def _hydrate_asset(r: dict) -> dict:
    r["labels"] = json.loads(r.pop("labels_json") or "{}")
    r["source"] = json.loads(r.pop("source_json") or "{}")
    r["merged_from"] = json.loads(r.pop("merged_from_json") or "[]")
    sp = r.pop("size_prior_json", None)
    r["size_prior"] = json.loads(sp) if sp else None
    r.pop("embedding", None)  # 不对外
    return r


def list_assets(space: str = "", category: str = "", q: str = "",
                status: str = "ready", include_all_status: bool = False) -> list[dict]:
    sql, params = "SELECT * FROM assets WHERE 1=1", []
    if not include_all_status:
        sql += " AND status=?"
        params.append(status)
    if space:
        sql += " AND space=?"
        params.append(space)
    rows = _rows(sql + " ORDER BY created_at DESC", tuple(params))
    out = [_hydrate_asset(r) for r in rows]
    if category:
        out = [a for a in out if a["labels"].get("category") == category]
    if q:
        needle = q.lower()
        out = [a for a in out
               if needle in json.dumps(a["labels"], ensure_ascii=False).lower()
               or needle in a["name"].lower()]
    return out


def get_asset(asset_id: str) -> Optional[dict]:
    r = _row("SELECT * FROM assets WHERE asset_id=?", (asset_id,))
    return _hydrate_asset(r) if r else None


def get_asset_raw(asset_id: str) -> Optional[dict]:
    """含 embedding/labels_json 的原始行，匹配用。"""
    return _row("SELECT * FROM assets WHERE asset_id=?", (asset_id,))


def all_assets_raw(status: str = "ready") -> list[dict]:
    return _rows("SELECT * FROM assets WHERE status=?", (status,))


def update_asset(asset_id: str, **fields: Any) -> None:
    mapping = {"labels": ("labels_json", lambda v: json.dumps(v, ensure_ascii=False)),
               "merged_from": ("merged_from_json", json.dumps),
               "source": ("source_json", lambda v: json.dumps(v, ensure_ascii=False)),
               "size_prior": ("size_prior_json", json.dumps)}
    cols, params = [], []
    for k, v in fields.items():
        col, conv = mapping.get(k, (k, lambda x: x))
        cols.append(f"{col}=?")
        params.append(conv(v))
    params.append(asset_id)
    _exec(f"UPDATE assets SET {','.join(cols)} WHERE asset_id=?", tuple(params))


def merge_assets(keep_id: str, drop_id: str) -> Optional[dict]:
    """合并重复资产：标签取并集、track 重挂、drop 方记入 merged_from 后置 rejected。"""
    keep, drop = get_asset(keep_id), get_asset(drop_id)
    if not keep or not drop:
        return None
    merged_labels = union_labels(keep["labels"], drop["labels"])
    merged_from = keep["merged_from"] + [drop_id] + drop["merged_from"]
    update_asset(keep_id, labels=merged_labels, merged_from=merged_from)
    rebind_tracks(drop_id, keep_id)
    update_asset(drop_id, status="rejected")
    return get_asset(keep_id)


def union_labels(a: dict, b: dict) -> dict:
    """标签并集：列表字段合并去重，标量字段 a 优先、a 缺则取 b。"""
    out = dict(a)
    for k, v in b.items():
        if isinstance(v, list):
            seen = list(out.get(k) or [])
            out[k] = seen + [x for x in v if x not in seen]
        elif not out.get(k):
            out[k] = v
    return out


# ---- user library ----

def library_add(user_id: str, asset_ids: list[str], via: str) -> int:
    n = 0
    for aid in asset_ids:
        try:
            _exec("INSERT OR IGNORE INTO user_library(user_id,asset_id,via,added_at) VALUES(?,?,?,?)",
                  (user_id, aid, via, time.time()))
            n += 1
        except sqlite3.Error:
            pass
    return n


def library_of(user_id: str) -> list[dict]:
    rows = _rows(
        "SELECT a.*, ul.via, ul.added_at FROM user_library ul"
        " JOIN assets a ON a.asset_id=ul.asset_id WHERE ul.user_id=? ORDER BY ul.added_at DESC",
        (user_id,),
    )
    out = []
    for r in rows:
        via, added = r.pop("via"), r.pop("added_at")
        a = _hydrate_asset(r)
        a["via"], a["added_at"] = via, added
        out.append(a)
    return out
