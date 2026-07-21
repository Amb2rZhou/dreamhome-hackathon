"""回填存量资产的 labels_json.mount(挂载属性: ceiling|wall|surface|floor)。

单一事实源:app/services/labels.py 的 assign_mount。
用法: backend/.venv/bin/python backend/tools/backfill_mount.py [--dry-run]
写库前自动备份 db 到 storage/dreamhome.db.bak-mount。
"""
import json
import shutil
import sqlite3
import sys
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.labels import assign_mount  # noqa: E402

DB = BACKEND / "storage" / "dreamhome.db"
BAK = BACKEND / "storage" / "dreamhome.db.bak-mount"


def main() -> None:
    dry = "--dry-run" in sys.argv
    if not dry:
        shutil.copy2(DB, BAK)
        print(f"[backup] {BAK}")

    conn = sqlite3.connect(DB)
    rows = conn.execute("SELECT asset_id, name, labels_json FROM assets").fetchall()
    stats: Counter = Counter()
    updates = []
    for asset_id, name, labels_json in rows:
        try:
            labels = json.loads(labels_json or "{}")
        except json.JSONDecodeError:
            labels = {}
        mount = assign_mount(labels)
        stats[mount] += 1
        if labels.get("mount") != mount:
            labels["mount"] = mount
            updates.append((json.dumps(labels, ensure_ascii=False), asset_id))
        print(f"  {mount:8s} {asset_id}  {labels.get('category','')}/{labels.get('sub','')}  {name}")

    if not dry:
        conn.executemany("UPDATE assets SET labels_json=? WHERE asset_id=?", updates)
        conn.commit()
    conn.close()

    print(f"\n[stats] total={len(rows)} updated={len(updates)}{' (dry-run)' if dry else ''}")
    for mount, n in sorted(stats.items()):
        print(f"  {mount:8s} {n}")


if __name__ == "__main__":
    main()
