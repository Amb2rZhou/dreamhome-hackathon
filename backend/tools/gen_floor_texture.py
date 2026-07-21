"""地板贴图生产:从视频帧裁真实地板 → 补全成正视角无缝贴图 → rebuild.html 平铺。

用法:
  cd backend && set -a; source .env; set +a
  ./.venv/bin/python tools/gen_floor_texture.py
产物 storage/textures/floor/wood.png(补全失败则保留 raw 裁切降级用)。
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.services.enhance import enhance_cutout  # noqa: E402

FRAME = "pipeline/vid_40734d7f2e6c/kf_9.0.jpg"
BBOX = [0.33, 0.86, 0.34, 0.13]      # 画面底部一块无杂物的地板(透视最弱)
PROMPT = ("木地板无缝贴图,严格俯视正视角,深浅交错的灰棕色橡木条板,"
          "参照原图的板色和纹理,去除透视、阴影、杂物和反光,平铺不留白边,完整矩形画面")


async def main() -> None:
    storage = os.path.abspath(settings.STORAGE_DIR)
    out_dir = os.path.join(storage, "textures", "floor")
    os.makedirs(out_dir, exist_ok=True)
    from PIL import Image
    src = Image.open(os.path.join(storage, FRAME)).convert("RGB")
    W, H = src.size
    x, y, w, h = BBOX
    raw = os.path.join(out_dir, "raw.jpg")
    src.crop((int(x*W), int(y*H), int((x+w)*W), int((y+h)*H))).save(raw, quality=92)
    enh = await enhance_cutout(raw, os.path.join(out_dir, "wood.png"), category=PROMPT)
    print("✓ 补全成功 → wood.png" if enh != raw else "△ 补全失败,只有 raw.jpg 可用")


if __name__ == "__main__":
    asyncio.run(main())
