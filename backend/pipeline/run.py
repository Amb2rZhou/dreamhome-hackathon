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


MIN_CUT_PX = 140         # 抠图短边下限(px),太小的生成必是废品
MIN_CUT_BRIGHTNESS = 35  # 平均亮度下限(0-255),太暗的跳过


def cutout(frame_path: str, bbox: list, out_path: str) -> str:
    from PIL import Image
    img = Image.open(frame_path).convert("RGB")
    W, H = img.size
    x, y, w, h = bbox
    pad = 0.08  # 外扩,防止家具边缘被 bbox 切掉(补全/rembg 需要完整轮廓)
    box = (max(0, int((x - pad) * W)), max(0, int((y - pad) * H)),
           min(W, int((x + w + pad) * W)), min(H, int((y + h + pad) * H)))
    img.crop(box).save(out_path)
    return out_path


def cut_quality_ok(cut_path: str) -> tuple[bool, str]:
    """质量闸:太小/太暗的抠图直接跳过,不浪费 GPU 也不污染资产库。"""
    from PIL import Image, ImageStat
    img = Image.open(cut_path)
    if min(img.size) < MIN_CUT_PX:
        return False, f"太小({img.size[0]}x{img.size[1]})"
    brightness = ImageStat.Stat(img.convert("L")).mean[0]
    if brightness < MIN_CUT_BRIGHTNESS:
        return False, f"太暗(亮度{brightness:.0f})"
    return True, ""


async def gen3d(image_path: str, extra_image_paths: list[str] | None = None) -> tuple[str, str]:
    """同步等待一次 3D 生成,返回 (glb_url, status)。批量场景串行即可(GPU 侧本身排队)。"""
    provider = get_provider()
    pjid = await provider.submit(image_path, extra_image_paths=extra_image_paths)
    for _ in range(150):
        await asyncio.sleep(2)
        res = await provider.poll(pjid)
        if res.status == "succeeded":
            return res.model_url or "", "ready"
        if res.status == "failed":
            return "", "rejected"
    return "", "rejected"


async def embed_image(image_path: str) -> list[float] | None:
    """抠图 → CLIP 向量(GPU /embed)。不可用时返回 None,聚类自动退化为品类判重。"""
    if not settings.REMOTE_GPU_URL:
        return None
    import base64
    import httpx
    with open(image_path, "rb") as f:
        uri = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
                r = await client.post(f"{settings.REMOTE_GPU_URL}/embed",
                                      json={"image_data_uri": uri})
                r.raise_for_status()
                return r.json()["embedding"]
        except Exception:  # noqa: BLE001
            if attempt == 2:
                return None
            await asyncio.sleep(1.5)
    return None


def _cos(a: list[float], b: list[float]) -> float:
    num = sum(x * y for x, y in zip(a, b))
    return num  # 向量已归一化


def _time_overlap_ratio(a: dict, b: dict) -> float:
    """两条 track 时间区间的重叠占比(相对较短者)。同一物体的碎片几乎不重叠;
    重叠大且是两个框 → 是两个不同的同款物体,不能合并。"""
    lo = max(a["points"][0]["t"], b["points"][0]["t"])
    hi = min(a["points"][-1]["t"], b["points"][-1]["t"])
    inter = max(0.0, hi - lo)
    dur = min(a["points"][-1]["t"] - a["points"][0]["t"],
              b["points"][-1]["t"] - b["points"][0]["t"])
    return inter / max(dur, 0.5)


EMBED_MERGE_SIM = 0.82   # 同品类 + 外观相似度 ≥ 此值 → 认为是同一物体
# 多视角生成每簇用几张图。实测跨时刻抠图角度/光照差异大会互相打架(v3 质量回退),
# 默认 1(单图);等补全模块把图洗干净后再调回 2-3 试
MAX_VIEWS = int(os.environ.get("PIPELINE_MAX_VIEWS", "1"))


def cluster_tracks(tracks: list[dict], embeds: list) -> list[list[int]]:
    """贪心聚类:质量分高的 track 当簇代表,后续 track 满足
    (同品类 + 外观相似 + 时间重叠低)并入。返回按代表质量排序的成员下标簇。"""
    clusters: list[list[int]] = []
    for i, tr in enumerate(tracks):
        placed = False
        for cl in clusters:
            rep = tracks[cl[0]]
            if rep["category"] != tr["category"]:
                continue
            if embeds[i] is not None and embeds[cl[0]] is not None:
                if _cos(embeds[i], embeds[cl[0]]) < EMBED_MERGE_SIM:
                    continue
            if _time_overlap_ratio(rep, tr) > 0.3:
                continue  # 同时出现在两个位置 → 两个不同物体
            cl.append(i)
            placed = True
            break
        if not placed:
            clusters.append([i])
    return clusters


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
    detections, skipped = [], 0
    for idx, f in enumerate(frames):
        import base64
        with open(f["path"], "rb") as fh:
            uri = "data:image/jpeg;base64," + base64.b64encode(fh.read()).decode()
        boxes = None
        for attempt in range(3):  # 单帧网络抖动重试,连败跳帧不炸整个视频
            try:
                boxes = await detect_frame(video_id, f["t"], uri)
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    skipped += 1
                    print(f"      ⚠️ t={f['t']} 检测失败已跳过: {type(e).__name__}: {e}")
                else:
                    await asyncio.sleep(1.5 * (attempt + 1))
        for box in boxes or []:
            detections.append({"t": f["t"], "bbox": box["bbox"],
                               "category": box["category"], "frame": f["path"]})
        if idx % 40 == 39:
            print(f"      检测进度 {idx+1}/{len(frames)}")
    print(f"      {len(detections)} 个检测框" + (f"(跳过 {skipped} 帧)" if skipped else ""))

    print("[3/6] 跨帧关联成 track")
    tracks = link_tracks(detections)
    print(f"      {len(tracks)} 条 track (≥{MIN_TRACK_LEN} 帧)")
    # 真实视频轨迹碎片多,按"存在时长×平均面积"排序,可用 PIPELINE_MAX_ASSETS 截断控量
    tracks.sort(key=lambda tr: -(len(tr["points"]) *
                                 sum(p["bbox"][2] * p["bbox"][3] for p in tr["points"]) / len(tr["points"])))
    sharp = {f["path"]: f["sharpness"] for f in frames}

    def quality(p: dict) -> float:
        return sharp.get(p["frame"], 0) * p["bbox"][2] * p["bbox"][3]

    # [4/6] 每条 track 取最佳帧抠图 → CLIP 向量 → 聚类去重(同一物体的碎片合成一簇)
    print("[4/6] 最佳帧抠图 + 外观聚类去重")
    cuts: list[str] = []
    for i, tr in enumerate(tracks):
        best = max(tr["points"], key=quality)
        tr["best"] = best
        cut_path = os.path.join(work, f"cut_{i}.jpg")
        cutout(best["frame"], best["bbox"], cut_path)
        cuts.append(cut_path)
    embeds = [await embed_image(p) for p in cuts]
    clusters = cluster_tracks(tracks, embeds)
    n_embed = sum(1 for e in embeds if e is not None)
    print(f"      {len(tracks)} 条轨迹 → {len(clusters)} 个物体"
          f"(embedding 覆盖 {n_embed}/{len(tracks)})")

    max_assets = int(os.environ.get("PIPELINE_MAX_ASSETS", "0"))
    gen_clusters = clusters[:max_assets] if max_assets else clusters
    if len(gen_clusters) < len(clusters):
        print(f"      ⚠️ 截断: 只生成前 {max_assets} 簇,其余 {len(clusters)-len(gen_clusters)} 簇只入索引")

    from app.services.enhance import enhance_cutout

    for ci, cl in enumerate(gen_clusters):
        rep = tracks[cl[0]]
        best = rep["best"]
        ok, why = cut_quality_ok(cuts[cl[0]])
        if not ok:
            print(f"[5/6] 物体#{ci} {rep['category']} 跳过({why}),轨迹仍入索引")
            for j in cl:
                tr = tracks[j]
                db.insert_track(video_id, tr["category"], interpolate(tr["points"]),
                                t_start=tr["points"][0]["t"], t_end=tr["points"][-1]["t"],
                                best_frame_t=tr["best"]["t"])
            continue
        # 补全卡槽(队友模块):残帧抠图 → 完整产品图;未接入时直通
        main_view = await enhance_cutout(cuts[cl[0]],
                                         os.path.join(work, f"enh_{ci}.jpg"))
        # 多视角选图:代表帧 + 时间上离得最远的成员帧;默认 MAX_VIEWS=1 即单图
        views = [main_view]
        others = sorted(cl[1:], key=lambda j: -abs(tracks[j]["best"]["t"] - best["t"]))
        views += [cuts[j] for j in others[:MAX_VIEWS - 1]]

        print(f"[5/6] 物体#{ci} {rep['category']} @ {best['t']}s"
              f"({len(cl)} 段轨迹,{len(views)} 视角)→ 3D + 标签")
        (glb_url, status), labels = await asyncio.gather(
            gen3d(views[0], extra_image_paths=views[1:]),
            extract_labels(views[0], category_hint=rep["category"]))

        thumb_name = f"thumbs/{video_id}_{ci}.jpg"
        os.makedirs(os.path.join(storage, "thumbs"), exist_ok=True)
        shutil.copy(views[0], os.path.join(storage, thumb_name))

        from app.matching import pack_embedding
        rep_track_id = ""
        asset_id = db.insert_asset(
            name=labels.get("sub") or rep["category"], labels=labels,
            glb_url=glb_url, thumb_url=f"{settings.PUBLIC_BASE_URL}/storage/{thumb_name}",
            source={"video_id": video_id, "track_id": "", "t_best": best["t"]},
            status=status, created_by="pipeline",
            embedding=pack_embedding(embeds[cl[0]]) if embeds[cl[0]] else None,
        )
        # 簇内所有轨迹段都挂同一资产:暂停在任何片段,框都指向同一个 3D
        for j in cl:
            tr = tracks[j]
            tid = db.insert_track(video_id, tr["category"], interpolate(tr["points"]),
                                  t_start=tr["points"][0]["t"], t_end=tr["points"][-1]["t"],
                                  best_frame_t=tr["best"]["t"])
            db.bind_track_asset(tid, asset_id)
            if j == cl[0]:
                rep_track_id = tid
        db.update_asset(asset_id, source={"video_id": video_id,
                                          "track_id": rep_track_id, "t_best": best["t"]})
        print(f"      asset={asset_id} status={status}")

    # 截断掉的簇只入索引(可圈选后补生成)
    for cl in clusters[len(gen_clusters):]:
        for j in cl:
            tr = tracks[j]
            db.insert_track(video_id, tr["category"], interpolate(tr["points"]),
                            t_start=tr["points"][0]["t"], t_end=tr["points"][-1]["t"],
                            best_frame_t=tr["best"]["t"])

    db.set_video_status(video_id, "indexed", index_source="offline")
    print(f"[6/6] 完成: video={video_id}, {len(gen_clusters)} 件资产"
          f"(合并自 {len(tracks)} 条轨迹)入库,待审核")
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
