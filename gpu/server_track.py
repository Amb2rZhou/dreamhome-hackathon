"""SAM2 视频追踪模块(挂在 gpu/server.py 上,异步任务队列)。

输入: 视频文件 + 种子框 [{obj_id, t, bbox}](来自 IoU 碎轨迹的最佳帧)
处理: SAM2 video predictor 全视频传播(前向+后向,种子分批防显存)
      → 每帧 mask→bbox → 同帧 mask 高重叠的种子几何合并(碎片归一)
      → 每个物体取 top 帧做 mask 抠图(白底去背景) → CLIP 多帧平均向量
输出: {objects: [{obj_id, merged_from, frames: [{t, bbox}], embedding}]}

显存预算: sam2.1-hiera-small ~2GB + 每批 8 个种子的记忆库;与 TRELLIS 容器共卡,分批跑。
"""
import gc
import os
import queue
import threading
import time
import uuid

import numpy as np
import torch

SAMPLE_FPS = 5           # 传播帧率(0.2s 网格,和索引一致)
SEED_BATCH = int(os.environ.get("SAM2_SEED_BATCH", "6"))  # 每次传播的种子数(显存)
GEO_MERGE_IOU = 0.6      # 同帧 mask IoU ≥ 此值 → 同一物体
TOP_FRAMES_EMBED = 5     # 每物体取几帧算平均向量

_jobs: dict[str, dict] = {}
_q: "queue.Queue[tuple[str, str, list, object]]" = queue.Queue()
_predictor = None
_started = False


def get_predictor():
    global _predictor
    if _predictor is None:
        from sam2.sam2_video_predictor import SAM2VideoPredictor
        _predictor = SAM2VideoPredictor.from_pretrained("facebook/sam2.1-hiera-small")
    return _predictor


def _mask_to_bbox(mask: np.ndarray):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    H, W = mask.shape
    return [round(xs.min() / W, 4), round(ys.min() / H, 4),
            round((xs.max() - xs.min()) / W, 4), round((ys.max() - ys.min()) / H, 4)]


def _extract_frames(video_path: str, out_dir: str):
    import cv2
    os.makedirs(out_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    duration = total / fps
    ts, idx = [], 0
    t = 0.0
    while t < duration:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, img = cap.read()
        if not ok:
            break
        cv2.imwrite(os.path.join(out_dir, f"{idx:05d}.jpg"), img)
        ts.append(round(t, 2))
        idx += 1
        t += 1.0 / SAMPLE_FPS
    cap.release()
    return ts


def _iou_masks(a, b):
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return inter / union if union else 0.0


def _clip_embed_masked(img_bgr, mask, clip_model, clip_proc):
    """mask 抠图(白底)→ CLIP 向量。背景剔除是聚类准确度的关键。"""
    import cv2
    from PIL import Image
    ys, xs = np.where(mask)
    if len(xs) < 64:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    crop = img_bgr[y0:y1 + 1, x0:x1 + 1].copy()
    m = mask[y0:y1 + 1, x0:x1 + 1]
    crop[~m] = 255
    pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    inputs = clip_proc(images=pil, return_tensors="pt").to("cuda")
    with torch.no_grad():
        feat = clip_model.get_image_features(**inputs)
    if not torch.is_tensor(feat):
        feat = feat.pooler_output
    feat = feat.flatten()
    return (feat / feat.norm()).cpu().numpy()


def run_track_job(job_id: str, video_path: str, seeds: list, clip_getter):
    job = _jobs[job_id]
    work = os.path.join(os.path.dirname(video_path), f"frames_{job_id}")
    try:
        import cv2  # try 内:缺依赖时任务标 failed 而不是炸死 worker 线程
        job["status"] = "running"
        ts = _extract_frames(video_path, work)
        n_frames = len(ts)
        t2idx = lambda t: min(range(n_frames), key=lambda i: abs(ts[i] - t))  # noqa: E731
        predictor = get_predictor()

        # 分批传播,收集 每物体每帧 bbox + 采样 mask
        obj_frames: dict[int, dict[int, list]] = {}
        obj_masks: dict[int, dict[int, np.ndarray]] = {}
        for bstart in range(0, len(seeds), SEED_BATCH):
            batch = seeds[bstart:bstart + SEED_BATCH]
            with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
                # 帧张量放 CPU 内存:498帧全上显存(~6GB)会和 TRELLIS 常驻打架 OOM
                state = predictor.init_state(video_path=work, offload_video_to_cpu=True)
                for s in batch:
                    fi = t2idx(s["t"])
                    x, y, w, h = s["bbox"]
                    img0 = cv2.imread(os.path.join(work, f"{fi:05d}.jpg"))
                    H, W = img0.shape[:2]
                    box = np.array([x * W, y * H, (x + w) * W, (y + h) * H], dtype=np.float32)
                    predictor.add_new_points_or_box(state, frame_idx=fi, obj_id=s["obj_id"], box=box)
                for reverse in (False, True):
                    for fi, obj_ids, masks in predictor.propagate_in_video(state, reverse=reverse):
                        for oid, m in zip(obj_ids, masks):
                            mk = (m[0] > 0).cpu().numpy()
                            bb = _mask_to_bbox(mk)
                            if bb is None or bb[2] * bb[3] < 0.0004:
                                continue
                            obj_frames.setdefault(int(oid), {})[fi] = bb
                            if fi % 5 == 0:  # 稀疏采样 mask 供合并/向量,省内存
                                obj_masks.setdefault(int(oid), {})[fi] = mk
                predictor.reset_state(state)
                del state
            gc.collect()
            torch.cuda.empty_cache()
            job["progress"] = f"传播 {min(bstart + SEED_BATCH, len(seeds))}/{len(seeds)}"

        # 几何合并:同帧 mask 高重叠 = 同一物体(碎片种子归一)
        oids = sorted(obj_frames)
        parent = {o: o for o in oids}

        def find(o):
            while parent[o] != o:
                parent[o] = parent[parent[o]]
                o = parent[o]
            return o

        for i in range(len(oids)):
            for j in range(i + 1, len(oids)):
                a, b = oids[i], oids[j]
                common = set(obj_masks.get(a, {})) & set(obj_masks.get(b, {}))
                if len(common) < 2:
                    continue
                ious = [_iou_masks(obj_masks[a][f], obj_masks[b][f]) for f in sorted(common)[:6]]
                if ious and sum(ious) / len(ious) >= GEO_MERGE_IOU:
                    parent[find(b)] = find(a)

        groups: dict[int, list[int]] = {}
        for o in oids:
            groups.setdefault(find(o), []).append(o)

        clip_model, clip_proc = clip_getter()
        objects = []
        for root, members in groups.items():
            frames_map: dict[int, list] = {}
            for m in members:
                for fi, bb in obj_frames[m].items():
                    frames_map.setdefault(fi, bb)  # 重叠帧取先到的(同物体,差异小)
            # 向量:面积最大的 TOP_FRAMES_EMBED 帧做 mask 抠图平均
            cand = []
            for m in members:
                for fi, mk in obj_masks.get(m, {}).items():
                    cand.append((mk.sum(), fi, mk))
            cand.sort(key=lambda x: -x[0])
            embs = []
            for _, fi, mk in cand[:TOP_FRAMES_EMBED]:
                img = cv2.imread(os.path.join(work, f"{fi:05d}.jpg"))
                e = _clip_embed_masked(img, mk, clip_model, clip_proc)
                if e is not None:
                    embs.append(e)
            emb = None
            if embs:
                v = np.mean(embs, axis=0)
                emb = (v / np.linalg.norm(v)).tolist()
            objects.append({
                "obj_id": root, "merged_from": members,
                "frames": [{"t": ts[fi], "bbox": bb} for fi, bb in sorted(frames_map.items())],
                "embedding": emb,
            })
        job["result"] = {"objects": objects, "n_frames": n_frames}
        job["status"] = "succeeded"
    except Exception as e:  # noqa: BLE001
        job["status"] = "failed"
        job["error"] = f"{type(e).__name__}: {e}"
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)
        try:
            os.remove(video_path)
        except OSError:
            pass
        gc.collect()
        torch.cuda.empty_cache()


def _worker(clip_getter):
    while True:
        job_id, video_path, seeds, _ = _q.get()
        try:
            run_track_job(job_id, video_path, seeds, clip_getter)
        except Exception as e:  # noqa: BLE001 任何逃逸异常都不许杀 worker 线程
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"] = f"worker: {type(e).__name__}: {e}"


def submit_track(video_path: str, seeds: list, clip_getter) -> str:
    global _started
    if not _started:
        threading.Thread(target=_worker, args=(clip_getter,), daemon=True).start()
        _started = True
    job_id = uuid.uuid4().hex
    _jobs[job_id] = {"status": "queued", "error": None, "progress": "", "created": time.time()}
    _q.put((job_id, video_path, seeds, None))
    return job_id


def track_status(job_id: str):
    return _jobs.get(job_id)
