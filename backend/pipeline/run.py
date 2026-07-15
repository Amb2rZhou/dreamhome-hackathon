"""离线资产生产 pipeline(asset-library-plan.md 核心设计 A)。

视频文件 → 抽帧 → 检测 → 跨帧关联成 track → 最佳帧 → 抠图 → 3D 生成 + 打标签 → 落库。

用法:
  cd backend && ./.venv/bin/python -m pipeline.run <video.mp4> \
      --title "奶油风客厅" --source-url "https://v.douyin.com/xxx"

provider 由 .env 决定,全 mock 也能端到端跑通(用于验证链路/灌联调数据):
  DETECT_PROVIDER=remote + REMOTE_GPU_URL → 真检测(GPU 上的 gpu/server.py)
  GEN3D_PROVIDER=fal + FAL_KEY           → 真 3D 生成(TRELLIS)
  LABELS_PROVIDER=anthropic/dashscope    → 真打标签

追踪说明:v1 用「相邻关键帧 IoU+品类 贪心关联」做 CPU 基线追踪,不依赖 SAM2;
GPU 环境就绪后可切 SAM2 精确追踪(gpu/server.py /track),接口不变。
"""
import argparse
import asyncio
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db  # noqa: E402
from app.config import settings  # noqa: E402
from app.providers import get_provider  # noqa: E402
from app.services.detect import detect_frame  # noqa: E402
from app.services.labels import extract_labels  # noqa: E402

KEYFRAME_INTERVAL = 0.5     # 检测采样间隔(秒)
INDEX_STEP = 0.2            # 时空索引 bbox 采样间隔(秒)
IOU_LINK = 0.3              # 相邻关键帧同品类 IoU>此值 → 认为是同一物体
MIN_TRACK_LEN = 2           # 少于 N 个关键帧的 track 丢弃(误检)


def extract_keyframes(video_path: str, out_dir: str) -> tuple[list[dict], float]:
    """按固定间隔抽关键帧。返回 ([{t, path, sharpness}], duration)。"""
    import cv2
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    duration = total / fps
    os.makedirs(out_dir, exist_ok=True)
    frames, t = [], 0.0
    while t < duration:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, img = cap.read()
        if not ok:
            break
        path = os.path.join(out_dir, f"kf_{t:.1f}.jpg")
        cv2.imwrite(path, img)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
        frames.append({"t": round(t, 2), "path": path, "sharpness": sharpness})
        t += KEYFRAME_INTERVAL
    cap.release()
    return frames, duration


def _iou(a: list, b: list) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def link_tracks(detections: list[dict]) -> list[dict]:
    """贪心关联:按时间序,把每帧检测框接到「品类相同且 IoU 最大」的活跃 track 尾部。
    detections: [{t, bbox, category, frame}]  →  [{category, points:[{t,bbox,frame}]}]
    """
    active: list[dict] = []
    done: list[dict] = []
    last_t = None
    for det in sorted(detections, key=lambda d: d["t"]):
        if last_t is not None and det["t"] > last_t:
            # 跨帧:超过 2 个采样间隔没接上的 track 结束
            still = []
            for tr in active:
                if det["t"] - tr["points"][-1]["t"] > KEYFRAME_INTERVAL * 2 + 1e-6:
                    done.append(tr)
                else:
                    still.append(tr)
            active = still
        best, best_iou = None, IOU_LINK
        for tr in active:
            if tr["category"] != det["category"] or tr["points"][-1]["t"] >= det["t"]:
                continue
            iou = _iou(tr["points"][-1]["bbox"], det["bbox"])
            if iou > best_iou:
                best, best_iou = tr, iou
        point = {"t": det["t"], "bbox": det["bbox"], "frame": det["frame"]}
        if best:
            best["points"].append(point)
        else:
            active.append({"category": det["category"], "points": [point]})
        last_t = det["t"]
    done += active
    return [tr for tr in done if len(tr["points"]) >= MIN_TRACK_LEN]


def interpolate(points: list[dict], step: float = INDEX_STEP) -> list[dict]:
    """关键帧 bbox 线性插值到 step 间隔,给前端暂停查表用。"""
    out = []
    for a, b in zip(points, points[1:]):
        t = a["t"]
        while t < b["t"] - 1e-9:
            p = (t - a["t"]) / (b["t"] - a["t"])
            bbox = [round(a["bbox"][i] + (b["bbox"][i] - a["bbox"][i]) * p, 3) for i in range(4)]
            out.append({"t": round(t, 2), "bbox": bbox})
            t += step
    out.append({"t": points[-1]["t"], "bbox": points[-1]["bbox"]})
    return out


def cutout(frame_path: str, bbox: list, out_path: str) -> str:
    from PIL import Image
    img = Image.open(frame_path).convert("RGB")
    W, H = img.size
    x, y, w, h = bbox
    pad = 0.03  # 稍微外扩,别切掉边缘
    box = (max(0, int((x - pad) * W)), max(0, int((y - pad) * H)),
           min(W, int((x + w + pad) * W)), min(H, int((y + h + pad) * H)))
    img.crop(box).save(out_path)
    return out_path


async def gen3d(image_path: str) -> tuple[str, str]:
    """同步等待一次 3D 生成,返回 (glb_url, status)。批量场景串行即可(fal 侧本身排队)。"""
    provider = get_provider()
    pjid = await provider.submit(image_path)
    for _ in range(150):
        await asyncio.sleep(2)
        res = await provider.poll(pjid)
        if res.status == "succeeded":
            return res.model_url or "", "ready"
        if res.status == "failed":
            return "", "rejected"
    return "", "rejected"


async def process(video_path: str, title: str, source_url: str) -> str:
    storage = os.path.abspath(settings.STORAGE_DIR)
    video_id = db.new_id("vid")
    work = os.path.join(storage, "pipeline", video_id)
    os.makedirs(work, exist_ok=True)

    # 0. 视频复制进 storage 供前端播放
    play_name = f"videos/{video_id}{os.path.splitext(video_path)[1] or '.mp4'}"
    os.makedirs(os.path.join(storage, "videos"), exist_ok=True)
    shutil.copy(video_path, os.path.join(storage, play_name))

    print(f"[1/6] 抽帧 {video_path}")
    frames, duration = extract_keyframes(video_path, work)
    print(f"      {len(frames)} 关键帧, 时长 {duration:.1f}s")

    db.insert_video(video_id=video_id, title=title or os.path.basename(video_path),
                    source_url=source_url, duration=round(duration, 2),
                    play_url=f"{settings.PUBLIC_BASE_URL}/storage/{play_name}",
                    status="processing")

    print(f"[2/6] 检测 (provider={settings.effective_detect_provider})")
    detections = []
    for f in frames:
        import base64
        with open(f["path"], "rb") as fh:
            uri = "data:image/jpeg;base64," + base64.b64encode(fh.read()).decode()
        for box in await detect_frame(video_id, f["t"], uri):
            detections.append({"t": f["t"], "bbox": box["bbox"],
                               "category": box["category"], "frame": f["path"]})
    print(f"      {len(detections)} 个检测框")

    print("[3/6] 跨帧关联成 track")
    tracks = link_tracks(detections)
    print(f"      {len(tracks)} 条 track (≥{MIN_TRACK_LEN} 帧)")

    sharp = {f["path"]: f["sharpness"] for f in frames}
    for i, tr in enumerate(tracks):
        # [4/6] 最佳帧:清晰度 × 面积
        best = max(tr["points"], key=lambda p: sharp.get(p["frame"], 0) * p["bbox"][2] * p["bbox"][3])
        cut_path = os.path.join(work, f"cut_{i}.jpg")
        cutout(best["frame"], best["bbox"], cut_path)

        # [5/6] 3D 生成 + 打标签并行
        print(f"[5/6] track#{i} {tr['category']} @ {best['t']}s → 3D + 标签")
        (glb_url, status), labels = await asyncio.gather(
            gen3d(cut_path), extract_labels(cut_path, category_hint=tr["category"]))

        thumb_name = f"thumbs/{video_id}_{i}.jpg"
        os.makedirs(os.path.join(storage, "thumbs"), exist_ok=True)
        shutil.copy(cut_path, os.path.join(storage, thumb_name))

        track_id = db.insert_track(video_id, tr["category"], interpolate(tr["points"]),
                                   t_start=tr["points"][0]["t"], t_end=tr["points"][-1]["t"],
                                   best_frame_t=best["t"])
        asset_id = db.insert_asset(
            name=labels.get("sub") or tr["category"], labels=labels,
            glb_url=glb_url, thumb_url=f"{settings.PUBLIC_BASE_URL}/storage/{thumb_name}",
            source={"video_id": video_id, "track_id": track_id, "t_best": best["t"]},
            status=status, created_by="pipeline",
        )
        db.bind_track_asset(track_id, asset_id)
        print(f"      asset={asset_id} status={status}")

    db.set_video_status(video_id, "indexed", index_source="offline")
    print(f"[6/6] 完成: video={video_id}, {len(tracks)} 资产入库(待审核页人工筛选)")
    return video_id


def main() -> None:
    ap = argparse.ArgumentParser(description="离线资产生产 pipeline")
    ap.add_argument("video", help="本地视频文件路径")
    ap.add_argument("--title", default="")
    ap.add_argument("--source-url", default="", help="原视频出处(抖音链接)")
    args = ap.parse_args()
    asyncio.run(process(args.video, args.title, args.source_url))


if __name__ == "__main__":
    main()
