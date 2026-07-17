"""重绑修复:对已生产的视频,重算「轨迹→资产」绑定,不重新生成任何东西。

用途:聚类逻辑升级后(最优分配/更严阈值),把存量视频的错绑一次性清掉。
只需 GPU 在线算 CLIP 向量(~2min,几毛钱),零 API 费、不动 GLB。

流程:读库里该视频全部轨迹 → 用工作目录里的抠图重算 embedding(有缓存)
→ 新聚类逻辑重新分簇 → 含"资产源头轨迹"的簇整簇绑到该资产,其余簇解绑。

用法: ./.venv/bin/python tools/rebind_tracks.py <video_id> [--dry]
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db  # noqa: E402
from app.config import settings  # noqa: E402
from pipeline.run import cluster_tracks, embed_image, cutout  # noqa: E402


async def main():
    video_id = sys.argv[1]
    dry = "--dry" in sys.argv
    video = db.get_video(video_id)
    if not video:
        raise SystemExit(f"video not found: {video_id}")

    rows = db.tracks_of_video(video_id)
    # 还原 pipeline 的 track 结构(points = frames)
    tracks = [{"track_id": r["track_id"], "category": r["category"],
               "points": [{"t": f["t"], "bbox": f["bbox"]} for f in r["frames"]],
               "best": {"t": r["best_frame_t"]}} for r in rows]

    # 资产源头轨迹: asset.source.track_id → asset_id(判簇归属的锚)
    anchor = {}
    for a in db.all_assets_raw(status="ready"):
        src = json.loads(a["source_json"] or "{}")
        if src.get("video_id") == video_id and src.get("track_id"):
            anchor[src["track_id"]] = a["asset_id"]
    print(f"{len(tracks)} 条轨迹,{len(anchor)} 个资产锚点")

    # 重算向量:从原视频帧按 best_frame_t 重新抠图(工作目录可能已被清理)
    play_rel = video["play_url"].split("/storage/")[-1]
    vpath = os.path.join(os.path.abspath(settings.STORAGE_DIR), play_rel)
    import cv2
    cap = cv2.VideoCapture(vpath)
    tmp = "/tmp/rebind_crops"
    os.makedirs(tmp, exist_ok=True)
    embeds = []
    for i, tr in enumerate(tracks):
        f = min(tr["points"], key=lambda p: abs(p["t"] - tr["best"]["t"]))
        cap.set(cv2.CAP_PROP_POS_MSEC, f["t"] * 1000)
        ok, img = cap.read()
        crop_path = os.path.join(tmp, f"{tr['track_id']}.jpg")
        if ok:
            cv2.imwrite(os.path.join(tmp, "_frame.jpg"), img)
            cutout(os.path.join(tmp, "_frame.jpg"), f["bbox"], crop_path)
            embeds.append(await embed_image(crop_path))
        else:
            embeds.append(None)
        if i % 30 == 29:
            print(f"  向量 {i+1}/{len(tracks)}")
    n_ok = sum(1 for e in embeds if e)
    print(f"embedding 覆盖 {n_ok}/{len(tracks)}")
    if n_ok < len(tracks) * 0.7:
        raise SystemExit("向量覆盖不足(GPU 不在线?),中止以免误绑")

    clusters = cluster_tracks(tracks, embeds)
    changed = 0
    for cl in clusters:
        aids = {anchor[tracks[j]["track_id"]] for j in cl if tracks[j]["track_id"] in anchor}
        target = aids.pop() if len(aids) == 1 else None  # 一簇多锚=可疑,保守解绑
        for j in cl:
            tid = tracks[j]["track_id"]
            cur = rows[j]["asset_id"]
            if cur != target:
                changed += 1
                print(f"  {tracks[j]['category']} {tid[:12]}: {cur or '∅'} → {target or '∅'}")
                if not dry:
                    db.bind_track_asset(tid, target)
    print(f"{'[dry-run] ' if dry else ''}{len(clusters)} 簇,改绑 {changed} 条")


if __name__ == "__main__":
    asyncio.run(main())
