"""视频 → 最清晰的一帧。

对应技术风险对策：视频截帧质量参差 → 取拉普拉斯方差最高(最锐)的一帧。
可选 bbox：用户在某一帧上圈选了区域，就只在该区域内挑锐帧并裁出。
依赖 opencv-python-headless；未安装时退化为"取中间帧"(用 imageio)。
"""
from typing import Optional, Tuple
import os


def extract_best_frame(
    video_path: str,
    out_path: str,
    bbox: Optional[Tuple[int, int, int, int]] = None,
    max_samples: int = 30,
) -> str:
    """从视频里挑一帧存成图片，返回图片路径。bbox=(x,y,w,h) 时裁剪。"""
    try:
        import cv2  # type: ignore
    except ImportError:
        return _fallback_middle_frame(video_path, out_path)

    cap = cv2.VideoCapture(video_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    if total <= 0:
        cap.release()
        return _fallback_middle_frame(video_path, out_path)

    # 均匀采样 max_samples 帧，选锐度最高的
    step = max(1, total // max_samples)
    best_frame = None
    best_score = -1.0
    idx = 0
    while idx < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break
        roi = frame
        if bbox:
            x, y, w, h = bbox
            crop = frame[max(0, y):y + h, max(0, x):x + w]
            if crop.size > 0:            # 空裁剪(越界)退回整帧，避免 Laplacian 报错
                roi = crop
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        score = cv2.Laplacian(gray, cv2.CV_64F).var()  # 方差越大越锐
        if score > best_score:
            best_score = score
            best_frame = frame
        idx += step
    cap.release()

    if best_frame is None:
        return _fallback_middle_frame(video_path, out_path)

    if bbox:
        x, y, w, h = bbox
        best_frame = best_frame[max(0, y):y + h, max(0, x):x + w]
    cv2.imwrite(out_path, best_frame)
    return out_path


def _fallback_middle_frame(video_path: str, out_path: str) -> str:
    """无 cv2 时用 imageio 取中间帧。"""
    try:
        import imageio.v3 as iio  # type: ignore
        frames = iio.imread(video_path, plugin="pyav")
        mid = frames[len(frames) // 2] if hasattr(frames, "__len__") else frames
        iio.imwrite(out_path, mid)
        return out_path
    except Exception:
        # 实在没有解码能力：把视频文件当作已经是图片处理不了，直接抛出让上层报错
        raise RuntimeError(
            "无法解码视频：请安装 opencv-python-headless 或 imageio[pyav]"
        )
