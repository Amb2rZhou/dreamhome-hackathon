"""内容哈希缓存:贵操作(检测/向量/补全/3D生成)按输入内容记账,中断重跑零重复开销。

key = 输入文件内容 md5 + 参数指纹。同一张图在任何一轮批次、任何聚类方式下都命中。
缓存在 storage/op_cache/<op>/<hash>.json(附件放同名目录),删除该目录即全量重算。
"""
import hashlib
import json
import os
import shutil

from ..config import settings


def _cache_dir(op: str) -> str:
    d = os.path.join(os.path.abspath(settings.STORAGE_DIR), "op_cache", op)
    os.makedirs(d, exist_ok=True)
    return d


def content_key(*file_paths: str, extra: str = "") -> str:
    h = hashlib.md5()
    for p in file_paths:
        with open(p, "rb") as f:
            h.update(f.read())
    h.update(extra.encode())
    return h.hexdigest()


def get(op: str, key: str) -> dict | None:
    p = os.path.join(_cache_dir(op), f"{key}.json")
    if not os.path.exists(p):
        return None
    try:
        with open(p) as f:
            rec = json.load(f)
        # 记录里引用的附件文件必须还在,否则视为失效
        for fp in rec.get("_files", {}).values():
            if not os.path.exists(fp):
                return None
        return rec
    except Exception:  # noqa: BLE001 缓存损坏当 miss
        return None


def put(op: str, key: str, data: dict, files: dict[str, str] | None = None) -> None:
    """files: {名字: 源路径} —— 附件复制进缓存目录,路径写进记录的 _files。"""
    rec = dict(data)
    if files:
        adir = os.path.join(_cache_dir(op), key)
        os.makedirs(adir, exist_ok=True)
        rec["_files"] = {}
        for name, src in files.items():
            dst = os.path.join(adir, name)
            shutil.copy(src, dst)
            rec["_files"][name] = dst
    with open(os.path.join(_cache_dir(op), f"{key}.json"), "w") as f:
        json.dump(rec, f, ensure_ascii=False)
