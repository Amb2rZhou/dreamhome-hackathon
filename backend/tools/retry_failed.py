"""重试生成失败的资产:用缓存的补全图重新提交 gen3d,成功则转 ready。

生成偶发超时/失败会被标 rejected(name 缩略图仍在);本工具按 thumb 找回补全图重试。
用法: ./.venv/bin/python tools/retry_failed.py <video_id>
"""
import asyncio
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json  # noqa: E402
import sqlite3  # noqa: E402

from app.config import settings  # noqa: E402
from pipeline.run import gen3d  # noqa: E402


async def main():
    video_id = sys.argv[1]
    storage = os.path.abspath(settings.STORAGE_DIR)
    con = sqlite3.connect(os.path.join(storage, "dreamhome.db"))
    con.row_factory = sqlite3.Row
    rows = [r for r in con.execute(
        "SELECT asset_id, name, thumb_url, source_json, glb_url FROM assets WHERE status='rejected'")
        if video_id in (r["source_json"] or "") and not r["glb_url"]]
    print(f"待重试 {len(rows)} 件")
    for r in rows:
        m = re.search(rf"{video_id}_(?:aug)?(\d+)\.jpg", r["thumb_url"] or "")
        if not m:
            print(f"  {r['name']}: 找不到编号,跳过"); continue
        ci = m.group(1)
        cands = [os.path.join(storage, "pipeline", video_id, f"enh_{ci}.jpg"),
                 os.path.join(storage, "pipeline", f"{video_id}_aug", f"aug_enh_{ci}.jpg"),
                 os.path.join(storage, "pipeline", video_id, f"cut_{ci}.jpg")]
        src = next((p for p in cands if os.path.exists(p)), None)
        if not src:
            print(f"  {r['name']}: 补全图缺失"); continue
        url, status = await gen3d(src)
        print(f"  {r['name']} → {status}")
        if status == "ready":
            con.execute("UPDATE assets SET glb_url=?, status='ready' WHERE asset_id=?",
                        (url, r["asset_id"]))
            con.commit()


if __name__ == "__main__":
    asyncio.run(main())
