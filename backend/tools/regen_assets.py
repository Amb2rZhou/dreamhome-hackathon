"""按新 SOP 重生成资产 3D:单体化+补全(必过) → 一致性确认(必过) → 才准进 TRELLIS。

背景(2026-07-20 验收结论):56平视频 21 件资产里,原始 bbox 裁切直通 TRELLIS 的
几乎全废(输入图带杂物/遮挡/运动模糊);唯一能用的 #15 恰好走过补全。
故本工具对指定资产强制走: 抠图 → segment_api 去背景+补全 → 幻觉闸 → gen3d,
任一环失败就大声报并跳过,绝不拿脏图/原图凑数(宁少而精)。

用法:
  cd backend && set -a; source .env; set +a
  ./.venv/bin/python tools/regen_assets.py vid_605df2fff231 --only 6,7,8 [--dry]
  --only 不给则跑该视频全部资产。--dry 只产图不写库不生成3D。
产物存 storage/pipeline/<vid>/regen/,审核页可看。
"""
import argparse
import asyncio
import json
import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db  # noqa: E402
from app.config import settings  # noqa: E402
from app.services.consistency import check_consistency, check_solo  # noqa: E402
from app.services.enhance import enhance_cutout  # noqa: E402
from app.services.labels import CATEGORIES, extract_labels  # noqa: E402
from pipeline.run import context_crop, cutout, gen3d  # noqa: E402


def _frame_at(video_path: str, t: float):
    import cv2
    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, fr = cap.read()
    cap.release()
    return fr if ok else None


def _bbox_at(frames: list[dict], t: float) -> list | None:
    if not frames:
        return None
    p = min(frames, key=lambda f: abs(f["t"] - t))
    return p["bbox"] if abs(p["t"] - t) <= 1.5 else None


async def regen(video_id: str, only: set[int] | None, dry: bool) -> None:
    conn = sqlite3.connect(settings.DB_PATH)
    conn.row_factory = sqlite3.Row
    video_path = os.path.join(settings.STORAGE_DIR, "videos", f"{video_id}.mp4")
    work = os.path.join(os.path.abspath(settings.STORAGE_DIR), "pipeline", video_id, "regen")
    os.makedirs(work, exist_ok=True)

    assets = conn.execute(
        "SELECT * FROM assets WHERE thumb_url LIKE ? AND status != 'rejected'",
        (f"%{video_id}%",)).fetchall()
    ok_n = fail_n = 0
    for a in assets:
        m = re.search(r"_(\d+)r?\.(?:jpg|png)", a["thumb_url"] or "")
        ci = int(m.group(1)) if m else None
        if ci is None or (only and ci not in only):
            continue
        src = json.loads(a["source_json"] or "{}")
        t_best = src.get("t_best")
        tr = conn.execute("SELECT frames_json FROM tracks WHERE track_id=?",
                          (src.get("track_id", ""),)).fetchone()
        frames = json.loads(tr["frames_json"]) if tr else []
        if not frames:  # 源轨迹被外观校验整段解绑时,退回任何仍绑本资产的轨迹
            tr2 = conn.execute("SELECT frames_json FROM tracks WHERE asset_id=? LIMIT 1",
                               (a["asset_id"],)).fetchone()
            frames = json.loads(tr2["frames_json"]) if tr2 else []
        bbox = _bbox_at(frames, t_best) if t_best is not None else None
        tag = f"#{ci} {a['name']}"
        if bbox is None:
            print(f"✗ {tag}: 找不到 t_best={t_best} 附近的 bbox,跳过")
            fail_n += 1
            continue

        fr = _frame_at(video_path, t_best)
        if fr is None:
            print(f"✗ {tag}: 抽帧失败 @ {t_best}s")
            fail_n += 1
            continue
        import cv2
        frame_path = os.path.join(work, f"frame_{ci}.jpg")
        cv2.imwrite(frame_path, fr)

        # ① 单体抠图(bbox 裁切,含少量边距)
        cut_path = cutout(frame_path, bbox, os.path.join(work, f"cut_{ci}.jpg"))

        # ② 补全(单体化+去背景+补全,segment_api)。必过:失败/直通都算废
        labels_old = json.loads(a["labels_json"] or "{}")
        desc = f"{labels_old.get('sub') or a['name']}({labels_old.get('category') or ''})"
        enh_path = await enhance_cutout(cut_path, os.path.join(work, f"enh_{ci}.png"),
                                        category=desc)
        if enh_path == cut_path:
            print(f"✗ {tag}: 补全失败(降级直通被拒),不进3D")
            fail_n += 1
            continue

        # ②b 单体闸:图里混入别的家具(如餐桌图里残留椅子) → 带强化指令重试一次
        solo, swhy = await check_solo(enh_path, a["name"])
        if not solo:
            print(f"  {tag}: 单体检查未过({swhy}),强化指令重试补全")
            enh_path = await enhance_cutout(
                cut_path, os.path.join(work, f"enh_{ci}.png"),
                category=f"{desc},画面中只保留这一件家具,彻底移除旁边的其他家具和物体")
            if enh_path == cut_path:
                print(f"✗ {tag}: 重试补全失败,不进3D")
                fail_n += 1
                continue
            solo, swhy = await check_solo(enh_path, a["name"])
            if not solo:
                print(f"✗ {tag}: 重试后仍不单体({swhy}),不进3D")
                fail_n += 1
                continue

        # ③ 幻觉闸:补全图必须还是原来那件
        same, why = await check_consistency(cut_path, enh_path)
        if not same:
            print(f"✗ {tag}: 一致性打回({why}),不进3D")
            fail_n += 1
            continue

        # ④ 干净图重新定名(顺带纠正 显示器/电视 这类错名)
        ctx_path = context_crop(frame_path, bbox, os.path.join(work, f"ctx_{ci}.jpg"))
        labels = await extract_labels(ctx_path, category_hint=labels_old.get("category", ""),
                                      framed=True)
        new_name = (labels.get("sub") or a["name"]) if labels else a["name"]

        if dry:
            print(f"DRY {tag}: 补全✓ 一致✓ 名={new_name} → {enh_path}")
            ok_n += 1
            continue

        # ⑤ 3D 生成(输入图变了 → 新缓存键,真金白银,~40s/件)
        print(f"… {tag}: 补全✓ 一致✓ → TRELLIS 生成中")
        glb_url, status = await gen3d(enh_path)
        if status != "ready":
            print(f"✗ {tag}: gen3d 状态={status},保留旧GLB不写库")
            fail_n += 1
            continue

        import shutil
        thumb_name = f"thumbs/{video_id}_{ci}r.png"
        shutil.copy(enh_path, os.path.join(os.path.abspath(settings.STORAGE_DIR), thumb_name))
        fields = dict(glb_url=glb_url, status="ready",
                      thumb_url=f"{settings.PUBLIC_BASE_URL}/storage/{thumb_name}")
        if labels and labels.get("category") in CATEGORIES:
            fields["labels"] = labels
            if new_name != a["name"]:
                fields["name"] = new_name
                print(f"  改名: {a['name']} → {new_name}")
        db.update_asset(a["asset_id"], **fields)
        print(f"✓ {tag}: 新GLB已写库 {glb_url}")
        ok_n += 1

    print(f"\n完成: 成功 {ok_n},失败/跳过 {fail_n}{'(DRY 未写库未生成)' if dry else ''}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video_id")
    ap.add_argument("--only", default="", help="逗号分隔的 ci 编号,如 6,7,8")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    only = {int(x) for x in args.only.split(",") if x.strip()} if args.only else None
    asyncio.run(regen(args.video_id, only, args.dry))


if __name__ == "__main__":
    main()
