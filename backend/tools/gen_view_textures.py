"""窗外景色贴图生产:从视频帧裁窗景 → 补全(去窗框/百叶帘/反光) → 存贴图库。

产物给 rebuild.html 的窗户资产用:窗户=框体几何+玻璃+景色贴图平面,
换 demo 时换贴图即可。清单+产物存 storage/textures/views/(manifest.json 供前端枚举)。

用法:
  cd backend && set -a; source .env; set +a
  ./.venv/bin/python tools/gen_view_textures.py           # 跑 CROPS 里的全部
  ./.venv/bin/python tools/gen_view_textures.py --only dusk_city
原图裁切版本(raw_*.jpg,视频原样)也一并保留,补全若跑偏可直接用 raw。
"""
import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.services.enhance import enhance_cutout  # noqa: E402

# 视频帧里的窗景裁切清单(bbox 归一化 [x,y,w,h])
CROPS = [
    { "name": "dusk_city",      "label": "黄昏城市(视频原样·飘窗)",
      "frame": "pipeline/vid_40734d7f2e6c/kf_10.5.jpg", "bbox": [0.09, 0.235, 0.28, 0.225] },
    { "name": "dusk_sky", "label": "傍晚偏蓝天空(视频原样·卧室窗)",
      "frame": "pipeline/vid_40734d7f2e6c/kf_4.0.jpg", "bbox": [0.555, 0.26, 0.225, 0.16] },
]
PROMPT = ("窗外风景照片,{label},完整矩形画面,彻底去除窗框、玻璃反光和百叶帘,"
          "补全被遮挡的景物,保持真实摄影质感,不要出现室内物体")


def trim_opaque(path: str) -> None:
    """裁掉四周的透明/半透明残带,输出不透明 RGB 贴图。"""
    from PIL import Image
    import numpy as np
    img = Image.open(path).convert("RGBA")
    a = np.asarray(img)[:, :, 3]
    solid_rows = np.where((a > 250).mean(axis=1) > 0.98)[0]
    solid_cols = np.where((a > 250).mean(axis=0) > 0.98)[0]
    if len(solid_rows) and len(solid_cols):
        img = img.crop((solid_cols[0], solid_rows[0], solid_cols[-1] + 1, solid_rows[-1] + 1))
    img.convert("RGB").save(path)


def crop(src: str, bbox: list, out: str) -> str:
    from PIL import Image
    img = Image.open(src).convert("RGB")
    W, H = img.size
    x, y, w, h = bbox
    img.crop((int(x*W), int(y*H), int((x+w)*W), int((y+h)*H))).save(out, quality=92)
    return out


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="逗号分隔的 name")
    args = ap.parse_args()
    only = {x for x in args.only.split(",") if x.strip()} or None

    storage = os.path.abspath(settings.STORAGE_DIR)
    out_dir = os.path.join(storage, "textures", "views")
    os.makedirs(out_dir, exist_ok=True)
    manifest_path = os.path.join(out_dir, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"views": []}
    have = {v["name"]: v for v in manifest["views"]}

    for c in CROPS:
        if only and c["name"] not in only:
            continue
        src = os.path.join(storage, c["frame"])
        raw = crop(src, c["bbox"], os.path.join(out_dir, f"raw_{c['name']}.jpg"))
        enh = await enhance_cutout(raw, os.path.join(out_dir, f"{c['name']}.png"),
                                   category=PROMPT.format(label=c["label"]))
        if enh != raw:
            trim_opaque(enh)                        # 去背景可能留透明残带,裁到不透明主体
        final = enh if enh != raw else raw          # 补全失败降级用原样裁切
        rel = f"/storage/textures/views/{os.path.basename(final)}"
        have[c["name"]] = { "name": c["name"], "label": c["label"], "url": rel,
                            "raw_url": f"/storage/textures/views/raw_{c['name']}.jpg",
                            "enhanced": enh != raw }
        print(f"{'✓' if enh != raw else '△(降级原样)'} {c['name']} → {rel}")

    manifest["views"] = list(have.values())
    json.dump(manifest, open(manifest_path, "w"), ensure_ascii=False, indent=2)
    print(f"manifest: {manifest_path} 共 {len(manifest['views'])} 种")


if __name__ == "__main__":
    asyncio.run(main())
