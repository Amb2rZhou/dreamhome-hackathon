"""轨迹冲突修复:同一物体被不同品类词各检出一条轨迹、且都挂了资产时,
暂停帧上会出现两个光点、其中一个名字是错的(如茶几顶着"边柜")。

判定:两条挂了不同资产的轨迹,时间重叠 ≥1s 且重叠期平均 IoU ≥0.5
→ 视为同一物体的重复检出,解绑「时长更短」的那条(轨迹保留,光点消失)。

用法: ./.venv/bin/python tools/repair_conflicts.py <video_id> [--dry]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db  # noqa: E402


def _iou(a, b):
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def overlap_iou(ta, tb):
    """两轨迹时间交集时长与交集内平均 IoU。frames 都是 0.2s 网格,按最近点配对。"""
    lo = max(ta["t_start"], tb["t_start"])
    hi = min(ta["t_end"], tb["t_end"])
    if hi - lo < 1.0:
        return 0.0, 0.0
    fb = {round(f["t"], 1): f["bbox"] for f in tb["frames"]}
    ious = [_iou(f["bbox"], fb[round(f["t"], 1)])
            for f in ta["frames"] if lo <= f["t"] <= hi and round(f["t"], 1) in fb]
    return (hi - lo, sum(ious) / len(ious)) if ious else (0.0, 0.0)


def main():
    video_id = sys.argv[1]
    dry = "--dry" in sys.argv
    tracks = [t for t in db.tracks_of_video(video_id) if t["asset_id"]]
    unbound = []
    for i in range(len(tracks)):
        for j in range(i + 1, len(tracks)):
            a, b = tracks[i], tracks[j]
            if a["asset_id"] == b["asset_id"]:
                continue
            dur, iou = overlap_iou(a, b)
            if dur >= 1.0 and iou >= 0.5:
                loser = a if (a["t_end"] - a["t_start"]) <= (b["t_end"] - b["t_start"]) else b
                winner = b if loser is a else a
                print(f"冲突: {a['category']}({a['track_id'][:10]}) × {b['category']}({b['track_id'][:10]})"
                      f" 重叠{dur:.1f}s IoU={iou:.2f} → 解绑 {loser['category']}")
                unbound.append(loser["track_id"])
    if not dry:
        for tid in set(unbound):
            db.bind_track_asset(tid, None)
    print(f"{'[dry-run] ' if dry else ''}解绑 {len(set(unbound))} 条冲突轨迹")


if __name__ == "__main__":
    main()
