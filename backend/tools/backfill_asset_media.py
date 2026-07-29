"""Idempotently register current thumbnails and GLBs as structured asset media."""
import mimetypes
import hashlib
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import db  # noqa: E402
from app.config import settings  # noqa: E402


def local_meta(url: str):
    marker = "/storage/"
    path = urlparse(url).path
    if marker not in path:
        return None, None, None
    file = Path(settings.STORAGE_DIR).resolve() / path.split(marker, 1)[1]
    if not file.is_file():
        return None, None, None
    width = height = None
    if (mimetypes.guess_type(str(file))[0] or "").startswith("image/"):
        try:
            from PIL import Image
            with Image.open(file) as image:
                width, height = image.size
        except Exception:
            pass
    return file.stat().st_size, width, height


def local_file(url: str):
    marker = "/storage/"
    path = urlparse(url).path
    if marker not in path:
        return None
    file = Path(settings.STORAGE_DIR).resolve() / path.split(marker, 1)[1]
    return file if file.is_file() else None


def add(asset_id: str, kind: str, url: str):
    if not url or db._row("SELECT 1 FROM asset_media WHERE asset_id=? AND kind=? AND url=?",
                          (asset_id, kind, url)):
        return 0
    size, width, height = local_meta(url)
    db._exec(
        """INSERT INTO asset_media(media_id,asset_id,kind,version,url,mime_type,width_px,
           height_px,bytes,is_current,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (db.new_id("med"), asset_id, kind, 1, url,
         mimetypes.guess_type(urlparse(url).path)[0] or "", width, height, size, 1, time.time()),
    )
    return 1


def main():
    count = 0
    for asset in db.list_assets(include_all_status=True):
        count += add(asset["asset_id"], "completed_input", asset.get("thumb_url", ""))
        count += add(asset["asset_id"], "model_3d", asset.get("glb_url", ""))
    hashed = 0
    for media in db._rows("SELECT media_id,url,sha256 FROM asset_media"):
        file = local_file(media["url"])
        if not file:
            continue
        digest = hashlib.sha256()
        with file.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        size, width, height = local_meta(media["url"])
        db._exec("UPDATE asset_media SET sha256=?,bytes=?,width_px=?,height_px=? WHERE media_id=?",
                 (digest.hexdigest(), size, width, height, media["media_id"]))
        hashed += 1
    print(f"registered {count} media records; integrity refreshed for {hashed}")


if __name__ == "__main__":
    main()
