#!/usr/bin/env python3
"""单张图片 → 干净 3D 资产(GLB),走完整质量 SOP,不是裸调生成。

流程: 补全(单体化/去背景,必过) → 单体闸 → 一致性闸 → 打标签 → TRELLIS 3D → 落库
任一闸不过会明确告知原因并退出(宁缺毋滥,不产废模型)。

用法(在仓库根目录执行):
  backend/.venv/bin/python .claude/skills/dreamhome-3d/scripts/gen_asset.py <图片路径> \
      [--name 资产名] [--hint "补全附加指令,如:保留布艺质感"] [--dry]
  --dry: 只跑到质检闸(不花 GPU),用于先看补全效果

先跑 status.py 确认依赖就绪(GPU 未开机时本脚本会明确报出)。
"""
import argparse
import asyncio
import os
import shutil
import sys
import time

SCRIPT = os.path.abspath(__file__)
REPO = os.path.abspath(os.path.join(os.path.dirname(SCRIPT), "..", "..", "..", ".."))
BACKEND = os.path.join(REPO, "backend")
sys.path.insert(0, BACKEND)

# 手动加载 backend/.env(settings 在 import 时读环境变量)
for line in open(os.path.join(BACKEND, ".env")):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

from app import db  # noqa: E402
from app.config import settings  # noqa: E402
from app.services.consistency import check_consistency, check_solo  # noqa: E402
from app.services.enhance import enhance_cutout  # noqa: E402
from app.services.labels import CATEGORIES, extract_labels  # noqa: E402
from pipeline.run import gen3d  # noqa: E402


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image", help="图片路径(jpg/png)")
    ap.add_argument("--name", default="", help="资产名(不给则用 VLM 标签)")
    ap.add_argument("--hint", default="", help="补全附加指令")
    ap.add_argument("--dry", action="store_true", help="只跑到质检闸,不进 3D")
    args = ap.parse_args()

    src = os.path.abspath(args.image)
    if not os.path.exists(src):
        print(f"✗ 图片不存在: {src}")
        return 1
    storage = os.path.abspath(settings.STORAGE_DIR)
    work = os.path.join(storage, "pipeline", "skill_assets")
    os.makedirs(work, exist_ok=True)
    stamp = str(int(time.time()))
    cut = os.path.join(work, f"in_{stamp}.jpg")
    shutil.copy(src, cut)
    desc = ",".join(x for x in [args.name, args.hint] if x) or "家具"

    # ① 补全(单体化+去背景),必过
    print("① 补全中(约 30-60s)…")
    enh = await enhance_cutout(cut, os.path.join(work, f"enh_{stamp}.png"), category=desc)
    if enh == cut:
        print("✗ 补全失败(降级直通被拒)。常见原因:图片里目标不清晰/多物体混杂。")
        print("  建议:裁剪到目标物体为主体后重试,或加 --hint 描述目标。")
        return 2

    # ② 单体闸:图里只能有这一件
    solo, why = await check_solo(enh, args.name or "目标家具")
    if not solo:
        print(f"  单体闸未过({why}),带强化指令重试补全…")
        enh = await enhance_cutout(cut, os.path.join(work, f"enh_{stamp}.png"),
                                   category=f"{desc},画面中只保留这一件家具,彻底移除其他物体")
        solo, why = await check_solo(enh, args.name or "目标家具")
        if not solo:
            print(f"✗ 重试后仍不单体({why})。请提供更干净的单体图。")
            return 2

    # ③ 一致性闸:补全图必须还是原来那件
    same, why = await check_consistency(cut, enh)
    if not same:
        print(f"✗ 一致性闸打回({why}):补全跑偏了。加 --hint 锁定形态(颜色/材质/结构)后重试。")
        return 2

    # ④ 打标签
    labels = await extract_labels(enh, category_hint="", framed=False)
    name = args.name or (labels.get("sub") if labels else "") or "未命名资产"
    print(f"② 质检闸全过 ✓  识别为: {name}  补全图: {enh}")

    if args.dry:
        print("DRY 模式结束(未进 3D)。看图满意后去掉 --dry 正式生成。")
        return 0

    # ⑤ TRELLIS 3D 生成(需 GPU,约 40s)
    print("③ TRELLIS 3D 生成中(约 40-90s)…")
    try:
        glb_url, status = await gen3d(enh)
    except Exception as e:
        print(f"✗ 3D 生成异常: {e}")
        print("  多半是 GPU 服务器未开机——按量计费实例为控成本默认关机,先跑 status.py 体检,")
        print("  需要时联系部署方开机。")
        return 3
    if status != "ready":
        print(f"✗ 3D 生成状态={status},未落库。GPU 忙/模型懒加载中可稍后重试。")
        return 3

    thumb_name = f"thumbs/skill_{stamp}.png"
    shutil.copy(enh, os.path.join(storage, thumb_name))
    fields = dict(name=name, glb_url=glb_url, status="ready",
                  thumb_url=f"{settings.PUBLIC_BASE_URL}/storage/{thumb_name}",
                  source={"video_id": "", "track_id": None, "t_best": 0, "skill_image": True},
                  created_by="skill")
    if labels and labels.get("category") in CATEGORIES:
        fields["labels"] = labels
    aid = db.insert_asset(**fields)
    print(f"\n✓ 完成!资产 {aid}")
    print(f"  GLB:  {glb_url}")
    print(f"  预览: http://localhost:8000/review/index.html (资产库搜「{name}」)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
