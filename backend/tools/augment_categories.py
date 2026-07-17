"""增量补品类:词表扩充后,对已生产的视频只补检新品类并生成资产,不动存量。

用法: ./.venv/bin/python tools/augment_categories.py <video_id> --cats 卫浴,家电
"""
import asyncio
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db  # noqa: E402
from app.config import settings  # noqa: E402
from app.services.consistency import check_consistency  # noqa: E402
from app.services.detect import detect_frame  # noqa: E402
from app.services.enhance import enhance_cutout  # noqa: E402
from app.services.labels import extract_labels  # noqa: E402
from pipeline.run import (SKIP_GEN_CATEGORIES, cluster_tracks, cut_quality_ok,  # noqa: E402
                          cutout, embed_image, extract_keyframes, gen3d,
                          interpolate, link_tracks)


async def main():
    video_id = sys.argv[1]
    cats = set((sys.argv[sys.argv.index("--cats") + 1] if "--cats" in sys.argv
                else "卫浴,家电").split(","))
    video = db.get_video(video_id)
    if not video:
        raise SystemExit("video not found")
    storage = os.path.abspath(settings.STORAGE_DIR)
    vpath = os.path.join(storage, video["play_url"].split("/storage/")[-1])
    work = os.path.join(storage, "pipeline", f"{video_id}_aug")
    os.makedirs(work, exist_ok=True)

    print(f"[1/4] 抽帧+检测(只保留 {cats})")
    frames, _ = extract_keyframes(vpath, work)
    import base64
    detections = []
    for idx, f in enumerate(frames):
        from app.services import cache
        ck = cache.content_key(f["path"], extra=f"detect|{settings.effective_detect_provider}")
        hit = cache.get("detect", ck)
        if hit is not None:
            boxes = hit["boxes"]
        else:
            with open(f["path"], "rb") as fh:
                uri = "data:image/jpeg;base64," + base64.b64encode(fh.read()).decode()
            try:
                boxes = await detect_frame(video_id, f["t"], uri)
                cache.put("detect", ck, {"boxes": boxes})
            except Exception:  # noqa: BLE001
                boxes = []
        for b in boxes:
            if b["category"] in cats:
                detections.append({"t": f["t"], "bbox": b["bbox"],
                                   "category": b["category"], "frame": f["path"]})
        if idx % 60 == 59:
            print(f"      {idx+1}/{len(frames)}")
    print(f"      新品类检测框 {len(detections)} 个")

    tracks = link_tracks(detections)
    print(f"[2/4] {len(tracks)} 条轨迹")
    if not tracks:
        raise SystemExit("没有新品类物体")
    sharp = {f["path"]: f["sharpness"] for f in frames}
    cuts = []
    for i, tr in enumerate(tracks):
        best = max(tr["points"], key=lambda p: sharp.get(p["frame"], 0) * p["bbox"][2] * p["bbox"][3])
        tr["best"] = best
        cp = os.path.join(work, f"aug_cut_{i}.jpg")
        cutout(best["frame"], best["bbox"], cp)
        cuts.append(cp)
    embeds = [await embed_image(p) for p in cuts]
    clusters = cluster_tracks(tracks, embeds)
    print(f"[3/4] {len(clusters)} 个物体")

    for ci, cl in enumerate(clusters):
        rep = tracks[cl[0]]
        best = rep["best"]
        ok, why = cut_quality_ok(cuts[cl[0]])
        if rep["category"] in SKIP_GEN_CATEGORIES:
            ok, why = False, "品类不生成"
        if ok:
            enh = await enhance_cutout(cuts[cl[0]], os.path.join(work, f"aug_enh_{ci}.jpg"),
                                       category=rep["category"])
            if enh != cuts[cl[0]]:
                same, why2 = await check_consistency(cuts[cl[0]], enh)
                if not same:
                    ok, why = False, f"幻觉打回({why2})"
        if not ok:
            print(f"[4/4] 物体#{ci} {rep['category']} 跳过({why}),入索引")
            for j in cl:
                tr = tracks[j]
                db.insert_track(video_id, tr["category"], interpolate(tr["points"]),
                                t_start=tr["points"][0]["t"], t_end=tr["points"][-1]["t"],
                                best_frame_t=tr["best"]["t"])
            continue
        print(f"[4/4] 物体#{ci} {rep['category']} @ {best['t']}s → 3D + 标签")
        (glb_url, status), labels = await asyncio.gather(
            gen3d(enh), extract_labels(enh, category_hint=rep["category"]))
        thumb = f"thumbs/{video_id}_aug{ci}.jpg"
        shutil.copy(cuts[cl[0]], os.path.join(storage, thumb))
        from app.matching import pack_embedding
        aid = db.insert_asset(
            name=labels.get("sub") or rep["category"], labels=labels,
            glb_url=glb_url, thumb_url=f"{settings.PUBLIC_BASE_URL}/storage/{thumb}",
            source={"video_id": video_id, "track_id": "", "t_best": best["t"]},
            status=status, created_by="pipeline",
            embedding=pack_embedding(embeds[cl[0]]) if embeds[cl[0]] else None)
        rep_tid = ""
        for j in cl:
            tr = tracks[j]
            tid = db.insert_track(video_id, tr["category"], interpolate(tr["points"]),
                                  t_start=tr["points"][0]["t"], t_end=tr["points"][-1]["t"],
                                  best_frame_t=tr["best"]["t"])
            db.bind_track_asset(tid, aid)
            if j == cl[0]:
                rep_tid = tid
        db.update_asset(aid, source={"video_id": video_id, "track_id": rep_tid,
                                     "t_best": best["t"]})
        print(f"      asset={aid} status={status}")
    print("完成")


if __name__ == "__main__":
    asyncio.run(main())
