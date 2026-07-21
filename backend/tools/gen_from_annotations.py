"""从 rebuild.html 圈选标注生成资产:漏检物品的手动补生成通道。

背景:检测环节漏掉的物品没有 track,regen_assets.py 走不了。Boss 在
/review/rebuild.html 对照视频圈出缺失物品(storage/annotations/<vid>.json,
含 t + 归一化 bbox + 名字),本工具按同一 SOP 补生成:
抠图 → segment_api 去背景+补全(必过) → 单体闸 → 一致性闸 → 打标签 → gen3d → 落库。

审核闸(防浪费 GPU):两阶段跑。
  prep 阶段(--prep):产补全图,状态 pending→prepped,回写 ctx/enh 图 URL,
    Boss 在 rebuild.html 标注列表里逐条看「视频红框画面 + 补全图」,点 通过/打回;
  生成阶段(默认):只处理 status=approved 的条目,gen3d 落库后状态→generated。

用法:
  cd backend && set -a; source .env; set +a
  ./.venv/bin/python tools/gen_from_annotations.py vid_40734d7f2e6c --prep [--only 0,2]
  ./.venv/bin/python tools/gen_from_annotations.py vid_40734d7f2e6c          # 只跑 approved
产物存 storage/pipeline/<vid>/manual/,索引 i 按标注文件顺序。
"""
import argparse
import asyncio
import json
import os
import shutil
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


async def run(video_id: str, only: set[int] | None, prep: bool,
              force: bool = False, hint: str = "") -> None:
    storage = os.path.abspath(settings.STORAGE_DIR)
    ann_path = os.path.join(storage, "annotations", f"{video_id}.json")
    if not os.path.exists(ann_path):
        sys.exit(f"没有标注文件: {ann_path}(先在 /review/rebuild.html 圈选)")
    doc = json.load(open(ann_path))
    items = doc.get("items", [])
    if not items:
        sys.exit("标注文件是空的,没东西可生成")
    video_path = os.path.join(storage, "videos", f"{video_id}.mp4")
    work = os.path.join(storage, "pipeline", video_id, "manual")
    os.makedirs(work, exist_ok=True)

    def flush():
        with open(ann_path, "w") as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)

    ok_n = fail_n = 0
    for i, ann in enumerate(items):
        if only and i not in only:
            continue
        status = ann.get("status", "pending")
        if prep and status not in ("pending", "rejected") and not force:
            continue   # 已有补全图/已审,prep 不重跑;打回的重跑;--force 强制重做
        if not prep and status != "approved":
            continue   # 生成阶段只碰 Boss 点过通过的
        t, bbox = ann["t"], ann["bbox"]
        note = ann.get("note") or f"标注{i}"
        # 打回原因 + 命令行 hint 都拼进补全指令,重做才有的放矢
        extra = ",".join(x for x in [hint, ann.get("reject_reason", "")] if x)
        if extra:
            note = f"{note},{extra}"
        tag = f"[{i}] {note} @{t}s"

        if prep:
            fr = _frame_at(video_path, t)
            if fr is None:
                print(f"✗ {tag}: 抽帧失败")
                fail_n += 1
                continue
            import cv2
            frame_path = os.path.join(work, f"frame_{i}.jpg")
            cv2.imwrite(frame_path, fr)

            # ① 单体抠图
            cut_path = cutout(frame_path, bbox, os.path.join(work, f"cut_{i}.jpg"))

            # ② 补全(segment_api)。必过:失败/直通都算废
            enh_path = await enhance_cutout(cut_path, os.path.join(work, f"enh_{i}.png"),
                                            category=note)
            if enh_path == cut_path:
                print(f"✗ {tag}: 补全失败(降级直通被拒)")
                ann["status"] = "prep_failed"; flush()
                fail_n += 1
                continue

            # ②b 单体闸,不过则带强化指令重试一次
            solo, swhy = await check_solo(enh_path, note)
            if not solo:
                print(f"  {tag}: 单体检查未过({swhy}),强化指令重试补全")
                enh_path = await enhance_cutout(
                    cut_path, os.path.join(work, f"enh_{i}.png"),
                    category=f"{note},画面中只保留这一件家具,彻底移除旁边的其他家具和物体")
                if enh_path == cut_path:
                    print(f"✗ {tag}: 重试补全失败")
                    ann["status"] = "prep_failed"; flush()
                    fail_n += 1
                    continue
                solo, swhy = await check_solo(enh_path, note)
                if not solo:
                    print(f"✗ {tag}: 重试后仍不单体({swhy})")
                    ann["status"] = "prep_failed"; flush()
                    fail_n += 1
                    continue

            # ③ 幻觉闸
            same, why = await check_consistency(cut_path, enh_path)
            if not same:
                print(f"✗ {tag}: 一致性打回({why})")
                ann["status"] = "prep_failed"; flush()
                fail_n += 1
                continue

            # ④ 上下文红框图(审核界面用) + 状态回写,等 Boss 审
            context_crop(frame_path, bbox, os.path.join(work, f"ctx_{i}.jpg"))
            base = f"{settings.PUBLIC_BASE_URL}/storage/pipeline/{video_id}/manual"
            ann["status"] = "prepped"
            ann["ctx_url"] = f"{base}/ctx_{i}.jpg"
            ann["enh_url"] = f"{base}/enh_{i}.png"
            flush()
            print(f"PREP {tag}: 补全✓ 单体✓ 一致✓ → 待 Boss 审核")
            ok_n += 1
            continue

        # ---- 生成阶段(status=approved) ----
        enh_path = os.path.join(work, f"enh_{i}.png")
        ctx_path = os.path.join(work, f"ctx_{i}.jpg")
        if not os.path.exists(enh_path):
            print(f"✗ {tag}: 找不到补全图 {enh_path},先跑 --prep")
            fail_n += 1
            continue
        # 打标签(名字以 Boss 圈选时写的为准,labels 只做分类/检索)
        labels = await extract_labels(ctx_path, category_hint="", framed=True) \
            if os.path.exists(ctx_path) else {}
        name = note

        # ⑤ 3D 生成(真金白银,~40s/件)
        print(f"… {tag}: 已审核通过 → TRELLIS 生成中")
        glb_url, status3d = await gen3d(enh_path)
        if status3d != "ready":
            print(f"✗ {tag}: gen3d 状态={status3d},不写库")
            fail_n += 1
            continue

        thumb_name = f"thumbs/{video_id}_m{i}.png"
        shutil.copy(enh_path, os.path.join(storage, thumb_name))
        fields = dict(
            name=name, glb_url=glb_url, status="ready",
            thumb_url=f"{settings.PUBLIC_BASE_URL}/storage/{thumb_name}",
            source={"video_id": video_id, "track_id": None, "t_best": t,
                    "manual_annotation": True, "bbox": bbox},
            created_by="annotation",
        )
        if labels and labels.get("category") in CATEGORIES:
            fields["labels"] = labels
        aid = db.insert_asset(**fields)
        ann["status"] = "generated"
        ann["asset_id"] = aid
        flush()
        print(f"✓ {tag}: 新资产 {aid} {glb_url}")
        ok_n += 1

    print(f"\n完成: 成功 {ok_n},失败/跳过 {fail_n}{'(prep 阶段,未生成3D)' if prep else ''}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video_id")
    ap.add_argument("--only", default="", help="逗号分隔的标注序号,如 0,2")
    ap.add_argument("--prep", action="store_true", help="只产补全图供审核,不进3D")
    ap.add_argument("--force", action="store_true", help="prep 时无视状态强制重做")
    ap.add_argument("--hint", default="", help="补全附加指令,如'保留布艺面料质感'")
    args = ap.parse_args()
    only = {int(x) for x in args.only.split(",") if x.strip()} if args.only else None
    asyncio.run(run(args.video_id, only, args.prep, args.force, args.hint))


if __name__ == "__main__":
    main()
