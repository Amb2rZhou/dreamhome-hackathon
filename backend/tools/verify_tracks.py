"""定位正确性抽检:把时空索引里的追踪框画回视频帧,导出标注图。

用法: ./.venv/bin/python tools/verify_tracks.py <video_id> [每条track抽N帧,默认3]
输出: storage/verify/<video_id>/track{i}_{品类}_t{时刻}.jpg —— 肉眼看框贴不贴合。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cv2  # noqa: E402

from app import db  # noqa: E402
from app.config import settings  # noqa: E402

PALETTE = [(60, 76, 231), (113, 204, 46), (219, 152, 52), (182, 89, 155), (15, 196, 241)]


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    video_id = sys.argv[1]
    per_track = int(sys.argv[2]) if len(sys.argv) > 2 else 3

    video = db.get_video(video_id)
    if not video:
        raise SystemExit(f"video not found: {video_id}")
    # play_url -> 本地文件路径
    rel = video["play_url"].split("/storage/", 1)[-1]
    path = os.path.join(os.path.abspath(settings.STORAGE_DIR), rel)
    if not os.path.exists(path):
        raise SystemExit(f"本地视频不存在: {path}")

    out_dir = os.path.join(os.path.abspath(settings.STORAGE_DIR), "verify", video_id)
    os.makedirs(out_dir, exist_ok=True)
    cap = cv2.VideoCapture(path)
    n = 0
    for i, tr in enumerate(db.tracks_of_video(video_id)):
        frames = tr["frames"]
        step = max(1, len(frames) // per_track)
        for f in frames[::step][:per_track]:
            cap.set(cv2.CAP_PROP_POS_MSEC, f["t"] * 1000)
            ok, img = cap.read()
            if not ok:
                continue
            H, W = img.shape[:2]
            x, y, w, h = f["bbox"]
            color = PALETTE[i % len(PALETTE)]
            cv2.rectangle(img, (int(x * W), int(y * H)),
                          (int((x + w) * W), int((y + h) * H)), color, 3)
            cv2.putText(img, f"#{i} t={f['t']}", (int(x * W), max(20, int(y * H) - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
            name = f"track{i}_{tr['category']}_t{f['t']}.jpg"
            cv2.imwrite(os.path.join(out_dir, name), img)
            n += 1
    cap.release()
    print(f"导出 {n} 张标注图 → {out_dir}")
    print(f"浏览: open {out_dir}")


if __name__ == "__main__":
    main()
