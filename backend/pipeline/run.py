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
import bisect
import hashlib
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db  # noqa: E402
from app.config import settings  # noqa: E402
from app.providers import get_provider  # noqa: E402
from app.services.detect import detect_frame  # noqa: E402
from app.services.labels import CATEGORIES, extract_labels  # noqa: E402

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


INTERP_MAX_GAP = 1.0     # 相邻可见点间隔超过此秒数 = 物体离场,不跨段插值(否则光标凭空飘)


def interpolate(points: list[dict], step: float = INDEX_STEP) -> list[dict]:
    """关键帧 bbox 线性插值到 step 间隔,给前端暂停查表用。
    只在连续可见段内插值;长间隔(离场/被挡)处断开,离场期间无索引点=前端不显示。"""
    out = []
    for a, b in zip(points, points[1:]):
        if b["t"] - a["t"] > INTERP_MAX_GAP:
            out.append({"t": a["t"], "bbox": a["bbox"]})  # 段尾点保留,然后断开
            continue
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


def context_crop(frame_path: str, bbox: list, out_path: str) -> str:
    """品类判定用的上下文图:bbox 周围 2.5 倍范围 + 红框标出目标。
    紧贴抠图会丢上下文(柜子一角认不出是柜子),带环境+红框让 VLM 判得准。"""
    from PIL import Image, ImageDraw
    img = Image.open(frame_path)
    W, H = img.size
    x, y, w, h = bbox[0] * W, bbox[1] * H, bbox[2] * W, bbox[3] * H
    px, py = w * 0.75, h * 0.75  # 每边外扩 0.75 倍 → 总视野 2.5 倍
    l, t = max(0, x - px), max(0, y - py)
    r, b = min(W, x + w + px), min(H, y + h + py)
    ctx = img.crop((int(l), int(t), int(r), int(b)))
    draw = ImageDraw.Draw(ctx)
    lw = max(3, int(min(ctx.size) * 0.008))
    draw.rectangle([x - l, y - t, x + w - l, y + h - t], outline=(255, 0, 0), width=lw)
    ctx.save(out_path, quality=88)
    return out_path


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
    """同步等待一次 3D 生成,返回 (glb_url, status)。批量场景串行即可(GPU 侧本身排队)。
    带内容哈希缓存:同一(组)输入图重跑不重新生成。"""
    from app.services import cache
    key = cache.content_key(
        image_path,
        *(extra_image_paths or []),
        extra=f"{settings.effective_provider}|albedo-gamma={settings.TRELLIS_ALBEDO_GAMMA}",
    )
    hit = cache.get("gen3d", key)
    if hit and hit.get("status") == "ready":
        # GLB 已在本机 storage(model_url 指向它),直接复用
        rel = hit["glb_url"].split("/storage/")[-1]
        if os.path.exists(os.path.join(os.path.abspath(settings.STORAGE_DIR), rel)):
            return hit["glb_url"], "ready"
    provider = get_provider()
    for attempt in range(2):  # 失败重试一次(worker CUDA 脏状态自杀重启后大概率成功)
        try:
            pjid = await provider.submit(image_path, extra_image_paths=extra_image_paths)
        except Exception as e:  # noqa: BLE001 worker 重启窗口期 submit 会连不上
            print(f"      gen3d submit 失败({type(e).__name__}),75s 后重试")
            await asyncio.sleep(75)
            continue
        failed = False
        for _ in range(150):
            await asyncio.sleep(2)
            try:
                res = await provider.poll(pjid)
            except Exception:  # noqa: BLE001 worker 重启中
                failed = True
                break
            if res.status == "succeeded":
                url = res.model_url or ""
                try:
                    from app.services.glb_material import materialize_postprocessed_glb
                    url, material_meta = await materialize_postprocessed_glb(url)
                    print(
                        f"      GLB 材质后处理: gamma={material_meta['gamma']} "
                        f"textures={material_meta['textures_corrected']} "
                        f"triangles={material_meta['triangles']}"
                    )
                except Exception as exc:  # noqa: BLE001
                    # Do not cache or expose a raw GLB as a ready canonical asset.
                    print(f"      GLB 自动验收失败: {type(exc).__name__}: {exc}")
                    failed = True
                    break
                cache.put("gen3d", key, {"glb_url": url, "status": "ready"})
                return url, "ready"
            if res.status == "failed":
                if res.error:
                    print(f"      gen3d 失败: {res.error[:120]}")
                failed = True
                break
        if failed and attempt == 0:
            await asyncio.sleep(75)  # 等 worker 自杀重启+模型加载
    return "", "rejected"


async def embed_image(image_path: str) -> list[float] | None:
    """抠图 → CLIP 向量(GPU /embed)。不可用时返回 None,聚类自动退化为品类判重。带缓存。"""
    if not settings.REMOTE_GPU_URL:
        return None
    from app.services import cache
    key = cache.content_key(image_path, extra="clip-b32")
    hit = cache.get("embed", key)
    if hit:
        return hit["v"]
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
                v = r.json()["embedding"]
                cache.put("embed", key, {"v": v})
                return v
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


# 只进索引、不生成 3D 的品类:窗帘等平面/软性物在 3D 里是丑柱子(走 backlog 的平面化方案),
# 定位和圈选不受影响。可用 PIPELINE_SKIP_GEN 覆盖(逗号分隔)。
SKIP_GEN_CATEGORIES = set(os.environ.get("PIPELINE_SKIP_GEN", "窗帘").split(","))

EMBED_MERGE_SIM = 0.82   # 同品类 + 外观相似度 ≥ 此值 → 认为是同一物体(大件)
# 易混品类阈值更高:小物件抠图小 CLIP 区分度差(不同吊灯都是"天花板黑块");
# 桌子/柜子同房间同光照下不同件也容易过 0.82(实测两起错绑都是它们)。
# 拆错了审核页能一键合并,合错了救不回来 → 宁拆勿合。
EMBED_MERGE_SIM_SMALL = 0.90
SMALL_CATEGORIES = {"灯具", "装饰", "绿植", "桌子", "柜子"}
# 一镜到底视频:两段轨迹时间隔得越久(多半已走到别的房间),要求越像才可合并
TIME_GAP_PENALTY = 0.03  # 每隔 60s 提高阈值 0.03,上限 +0.06


def _merge_threshold(category: str, gap_seconds: float) -> float:
    base = EMBED_MERGE_SIM_SMALL if category in SMALL_CATEGORIES else EMBED_MERGE_SIM
    return base + min(0.06, max(0.0, gap_seconds / 60.0) * TIME_GAP_PENALTY)
# 多视角生成每簇用几张图。实测跨时刻抠图角度/光照差异大会互相打架(v3 质量回退),
# 默认 1(单图);等补全模块把图洗干净后再调回 2-3 试
MAX_VIEWS = int(os.environ.get("PIPELINE_MAX_VIEWS", "1"))


def cluster_tracks(tracks: list[dict], embeds: list) -> list[list[int]]:
    """聚类:质量分高的 track 当簇代表,后续 track 满足
    (同品类 + 外观相似 + 时间重叠低)时加入**相似度最高**的簇。
    (不能先到先得:两件相似同品类家具都过门槛时,碎片会挂错对象 → 光点名字标反。)"""
    clusters: list[list[int]] = []
    for i, tr in enumerate(tracks):
        best_cl, best_sim = None, -1.0
        for cl in clusters:
            rep = tracks[cl[0]]
            if rep["category"] != tr["category"]:
                continue
            gap = max(tr["points"][0]["t"] - rep["points"][-1]["t"],
                      rep["points"][0]["t"] - tr["points"][-1]["t"], 0.0)
            if _time_overlap_ratio(rep, tr) > 0.3:
                continue  # 同时出现在两个位置 → 两个不同物体
            if embeds[i] is not None and embeds[cl[0]] is not None:
                sim = _cos(embeds[i], embeds[cl[0]])
                if sim < _merge_threshold(tr["category"], gap):
                    continue
            elif tr["category"] in SMALL_CATEGORIES:
                continue  # 小物件没有向量时不盲合
            else:
                sim = 0.0  # 无向量的大件:仅品类+时间约束,相当于最低优先级候选
            if sim > best_sim:
                best_cl, best_sim = cl, sim
        if best_cl is not None:
            best_cl.append(i)
        else:
            clusters.append([i])
    return clusters


async def sam2_upgrade_tracks(video_path: str, tracks: list[dict], frames: list[dict],
                              detections: list[dict] | None = None,
                              ) -> tuple[list[dict], dict[int, list]]:
    """混合架构:SAM2 只负责聚类/合并碎片 + mask抠图多帧向量(merged_from + embedding),
    轨迹点(光标位置)始终用碎片轨迹的原始检测点合并——检测器开火才有点,不会把偶发误报
    传播成持续可见错误。SAM2 不可用时原样返回(embeds 由调用方本地计算)。
    pipeline 和预审工具共用此函数,保证预审页和真实聚类一致(结果有内容缓存)。"""
    sam2_embeds: dict[int, list] = {}
    if os.environ.get("TRACKER", "sam2") != "sam2" or not tracks:
        return tracks, sam2_embeds
    _sharp0 = {f["path"]: f["sharpness"] for f in frames}
    seeds = []
    for i, tr in enumerate(tracks):
        b = max(tr["points"], key=lambda p: _sharp0.get(p["frame"], 0) * p["bbox"][2] * p["bbox"][3])
        seeds.append({"obj_id": i, "t": b["t"], "bbox": b["bbox"]})
    from app.services.track import sam2_track
    res = await sam2_track(video_path, seeds)
    if not (res and res.get("objects")):
        return tracks, sam2_embeds

    new_tracks = []
    for obj in res["objects"]:
        members = [m for m in obj["merged_from"] if m < len(tracks)]
        if not members:
            continue
        cats = [tracks[m]["category"] for m in members]
        # sorted 保证平票时结果确定(set 迭代序受哈希随机化影响,平票会跨进程抖动)
        cat = max(sorted(set(cats)), key=cats.count)
        # 混合架构:光标位置回归原始检测点(检测器开火才有点,不会漂到空处/未进场时段),
        # SAM2 的 frames 丢弃,只保留分组关系(merged_from)和 embedding
        pts, seen = [], set()
        for p in sorted((p for m in members for p in tracks[m]["points"]),
                        key=lambda p: p["t"]):
            k = round(p["t"], 2)
            if k in seen:
                continue
            seen.add(k)
            pts.append(p)
        if len(pts) < 2:
            continue
        new_tracks.append({"category": cat, "points": pts})
        if obj.get("embedding"):
            sam2_embeds[len(new_tracks) - 1] = obj["embedding"]
    if not new_tracks:
        return tracks, sam2_embeds

    # 同品类同帧共存合并:检测器常对同一物体打两个偏框(整桌 vs 桌角+边柜),SAM2 按
    # 外观分组后仍是两条轨迹 → 同屏双光标+重复资产。判据必须"同帧共存+高覆盖",
    # 只同品类不共存的(餐桌/化妆桌)不能合。
    def _containment(a: list, b: list) -> float:
        ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
        iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
        return ix * iy / (min(a[2] * a[3], b[2] * b[3]) or 1)

    # 点级压制(NMS):短轨迹中被长轨迹邻近点(±0.75s,家具静止,检测器对同一物体的
    # 两种框法常跨帧交替出现,同帧撞不上)高覆盖(>0.5)的同品类点视为重复框删掉;
    # 整条轨迹不合并——嵌合体轨迹(部分重复+部分误检在别处)只该删重复的那部分点。
    # 点删到 <2 的轨迹整条去掉。
    NMS_WINDOW = 0.75
    order = sorted(range(len(new_tracks)), key=lambda i: -len(new_tracks[i]["points"]))
    dropped_pts = 0
    for ai, i in enumerate(order):
        li = new_tracks[i]
        if not li["points"]:
            continue
        lts = [p["t"] for p in li["points"]]
        for j in order[ai + 1:]:
            sj = new_tracks[j]
            if sj["category"] != li["category"] or not sj["points"]:
                continue
            keep = []
            for p in sj["points"]:
                lo = bisect.bisect_left(lts, p["t"] - NMS_WINDOW)
                hi = bisect.bisect_right(lts, p["t"] + NMS_WINDOW)
                if any(_containment(p["bbox"], li["points"][k]["bbox"]) > 0.5
                       for k in range(lo, hi)):
                    continue
                keep.append(p)
            dropped_pts += len(sj["points"]) - len(keep)
            sj["points"] = keep
    if dropped_pts:
        idx_map, kept = {}, []
        for i, tr in enumerate(new_tracks):
            if len(tr["points"]) >= 2:
                idx_map[i] = len(kept)
                kept.append(tr)
        sam2_embeds = {idx_map[i]: e for i, e in sam2_embeds.items() if i in idx_map}
        print(f"      同品类同帧压制: 删 {dropped_pts} 个重复框点, {len(new_tracks)} → {len(kept)} 条")
        new_tracks = kept

    # 分段品类复核 + 嵌合体拆分:检测器只看框内像素会误判(床标成"桌子"),SAM2 分组
    # 还会把不同物体的碎片归进一条轨迹(嵌合体)。按时间段(>2s 间隔)各自取最佳点做
    # 红框上下文图让 qwen 重判(¥0.008/次,内容缓存重跑免费):段间判定一致 → 整条改判;
    # 不一致 → 按判定品类拆成多条轨迹(床段从"桌子"轨迹里拆出去)。小段(<4 点)判定
    # 不可靠,跟随大段投票;复核失败由 category_hint 兜底,不会比检测更差。
    crop_dir = os.path.dirname(frames[0]["path"]) if frames else None
    if crop_dir and os.environ.get("CATEGORY_RECHECK", "1") != "0":
        sem = asyncio.Semaphore(5)
        SEG_GAP = 2.0
        MIN_SEG_JUDGE = 4   # 少于 4 点的小段不独立定品类

        def _segments(pts: list[dict]) -> list[list[dict]]:
            segs = [[pts[0]]]
            for a, b in zip(pts, pts[1:]):
                if b["t"] - a["t"] > SEG_GAP:
                    segs.append([])
                segs[-1].append(b)
            return segs

        async def _judge(i: int, si: int, seg: list[dict], hint: str) -> str:
            best = max(seg, key=lambda p: _sharp0.get(p["frame"], 0) * p["bbox"][2] * p["bbox"][3])
            crop = os.path.join(crop_dir, f"catchk_{i}_{si}.jpg")
            try:
                context_crop(best["frame"], best["bbox"], crop)
                async with sem:
                    labels = await extract_labels(crop, category_hint=hint, framed=True)
                cat = labels.get("category")
                return cat if cat in CATEGORIES else hint
            except Exception as e:  # noqa: BLE001 复核挂了不碍主流程
                print(f"      ⚠️ 品类复核失败 track{i}.{si}: {type(e).__name__}: {e}")
                return hint

        async def _recheck(i: int, tr: dict):
            segs = _segments(tr["points"])
            cats = await asyncio.gather(*(_judge(i, si, s, tr["category"])
                                          for si, s in enumerate(segs)))
            return segs, list(cats)

        results = await asyncio.gather(*(_recheck(i, tr) for i, tr in enumerate(new_tracks)))
        rebuilt, rebuilt_embeds, flips, n_split = [], {}, [], 0
        from collections import Counter
        for i, (tr, (segs, cats)) in enumerate(zip(new_tracks, results)):
            # 大段按点数加权投票出主品类;小段跟随主品类
            weight: dict[str, int] = {}
            for s, c in zip(segs, cats):
                if len(s) >= MIN_SEG_JUDGE:
                    weight[c] = weight.get(c, 0) + len(s)
            if not weight:
                for s, c in zip(segs, cats):
                    weight[c] = weight.get(c, 0) + len(s)
            main_cat = max(weight, key=lambda c: weight[c])
            groups: dict[str, list] = {}
            for s, c in zip(segs, cats):
                c2 = c if (len(s) >= MIN_SEG_JUDGE and c in weight) else main_cat
                groups.setdefault(c2, []).extend(s)
            if len(groups) > 1:
                n_split += len(groups) - 1
            for c, pts in groups.items():
                if len(pts) < 2:
                    continue
                if c != tr["category"]:
                    flips.append(f"{tr['category']}→{c}")
                if c == main_cat and i in sam2_embeds:
                    rebuilt_embeds[len(rebuilt)] = sam2_embeds[i]  # 主段继承向量,拆出段本地重算
                rebuilt.append({"category": c, "points": sorted(pts, key=lambda p: p["t"])})
        if flips or n_split:
            fc = Counter(flips)
            print(f"      品类复核: {len(fc)} 种改判 共{len(flips)}处 拆出{n_split}条 "
                  + " ".join(f"{k}×{v}" for k, v in fc.most_common(6)))
        sam2_embeds = rebuilt_embeds
        new_tracks = rebuilt

    print(f"      SAM2: {len(tracks)} 种子 → {len(new_tracks)} 条完整轨迹"
          f"(几何合并 {len(tracks) - len(new_tracks)} 个碎片)")
    return new_tracks, sam2_embeds


async def process(video_path: str, title: str, source_url: str) -> str:
    storage = os.path.abspath(settings.STORAGE_DIR)
    # video_id 按内容哈希固定:同一条视频反复重建 id 不变,review 页链接不失效
    with open(video_path, "rb") as _f:
        video_id = "vid_" + hashlib.md5(_f.read()).hexdigest()[:12]
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
    from app.services import cache
    detections, skipped, cached = [], 0, 0
    for idx, f in enumerate(frames):
        ck = cache.content_key(f["path"], extra=f"detect|{settings.effective_detect_provider}")
        hit = cache.get("detect", ck)
        if hit is not None:
            boxes = hit["boxes"]
            cached += 1
        else:
            import base64
            with open(f["path"], "rb") as fh:
                uri = "data:image/jpeg;base64," + base64.b64encode(fh.read()).decode()
            boxes = None
            for attempt in range(3):  # 单帧网络抖动重试,连败跳帧不炸整个视频
                try:
                    boxes = await detect_frame(video_id, f["t"], uri)
                    cache.put("detect", ck, {"boxes": boxes})
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
    print(f"      {len(detections)} 个检测框"
          + (f"(跳过 {skipped} 帧)" if skipped else "")
          + (f"(缓存命中 {cached} 帧)" if cached else ""))

    print("[3/6] 跨帧关联成 track")
    tracks = link_tracks(detections)
    print(f"      {len(tracks)} 条 track (≥{MIN_TRACK_LEN} 帧)")
    # 真实视频轨迹碎片多,按"存在时长×平均面积"排序,可用 PIPELINE_MAX_ASSETS 截断控量
    tracks.sort(key=lambda tr: -(len(tr["points"]) *
                                 sum(p["bbox"][2] * p["bbox"][3] for p in tr["points"]) / len(tr["points"])))
    tracks, sam2_embeds = await sam2_upgrade_tracks(video_path, tracks, frames, detections)

    sharp = {f["path"]: f["sharpness"] for f in frames}

    def _edge_cut(b: list) -> int:
        """bbox 触到几条画面边 = 物体被切掉几边(部分视角,补全会脑补形态)。"""
        return sum([b[0] < 0.01, b[1] < 0.01, b[0] + b[2] > 0.99, b[1] + b[3] > 0.99])

    def quality(p: dict) -> float:
        # 切边惩罚:宁选完整的小图,不选被裁的大图
        return (sharp.get(p["frame"], 0) * p["bbox"][2] * p["bbox"][3]
                * (0.3 ** _edge_cut(p["bbox"])))

    # [4/6] 每条 track 取最佳帧抠图 → CLIP 向量 → 聚类去重(同一物体的碎片合成一簇)
    print("[4/6] 最佳帧抠图 + 外观聚类去重")
    cuts: list[str] = []
    for i, tr in enumerate(tracks):
        best = max(tr["points"], key=quality)
        tr["best"] = best
        cut_path = os.path.join(work, f"cut_{i}.jpg")
        cutout(best["frame"], best["bbox"], cut_path)
        cuts.append(cut_path)
    # SAM2 已带回 mask抠图多帧平均向量(背景剔除,聚类更准);缺的才本地补算
    embeds = [sam2_embeds.get(i) or await embed_image(p) for i, p in enumerate(cuts)]
    clusters = cluster_tracks(tracks, embeds)
    n_embed = sum(1 for e in embeds if e is not None)
    print(f"      {len(tracks)} 条轨迹 → {len(clusters)} 个物体"
          f"(embedding 覆盖 {n_embed}/{len(tracks)})")

    # 人工聚类修正(CLUSTER_FIX=corrections.json,索引=预审页簇编号):
    # merge 合并同物体的簇 / redistribute 按相似度拆混簇 / drop 剔除垃圾簇(只入索引)
    dropped_by_fix: set[int] = set()
    fix_path = os.environ.get("CLUSTER_FIX", "")
    if fix_path and os.path.exists(fix_path):
        import json as _json
        fix = _json.load(open(fix_path))
        cmap = {i: cl for i, cl in enumerate(clusters)}
        for a, b in fix.get("redistribute", []):
            if a in cmap and b in cmap:
                rep_a, rep_b = cmap[a][0], cmap[b][0]
                keep = [cmap[a][0]]
                for j in cmap[a][1:]:
                    if embeds[j] and embeds[rep_a] and embeds[rep_b] and \
                       _cos(embeds[j], embeds[rep_b]) > _cos(embeds[j], embeds[rep_a]):
                        cmap[b].append(j)
                    else:
                        keep.append(j)
                cmap[a] = keep
        for group in fix.get("merge", []):
            group = [g for g in group if g in cmap]
            if len(group) < 2:
                continue
            base = group[0]
            for g in group[1:]:
                cmap[base].extend(cmap.pop(g))
        dropped_by_fix = {i for i in fix.get("drop", []) if i in cmap}
        clusters = [cl for i, cl in sorted(cmap.items()) if i not in dropped_by_fix]
        for i in sorted(dropped_by_fix):
            for j in cmap[i]:
                tr = tracks[j]
                db.insert_track(video_id, tr["category"], interpolate(tr["points"]),
                                t_start=tr["points"][0]["t"], t_end=tr["points"][-1]["t"],
                                best_frame_t=tr["best"]["t"] if "best" in tr else tr["points"][0]["t"])
        print(f"      修正后: {len(clusters)} 个物体(剔除 {len(dropped_by_fix)} 簇)")

    max_assets = int(os.environ.get("PIPELINE_MAX_ASSETS", "0"))
    gen_clusters = clusters[:max_assets] if max_assets else clusters
    if len(gen_clusters) < len(clusters):
        print(f"      ⚠️ 截断: 只生成前 {max_assets} 簇,其余 {len(clusters)-len(gen_clusters)} 簇只入索引")

    from app.services.enhance import enhance_cutout

    from app.services.labels import CATEGORIES

    def _index_only(cl, cat=None):
        for j in cl:
            tr = tracks[j]
            db.insert_track(video_id, cat or tr["category"], interpolate(tr["points"]),
                            t_start=tr["points"][0]["t"], t_end=tr["points"][-1]["t"],
                            best_frame_t=tr["best"]["t"])

    def _ctx_image(cl, tag):
        """带红框+环境上下文的判定图:紧贴抠图会丢上下文(柜子一角认不出),红框图判得准。"""
        rep = tracks[cl[0]]
        return context_crop(rep["best"]["frame"], rep["best"]["bbox"],
                            os.path.join(work, f"ctx_{tag}.jpg"))

    async def _corrected_labels(cl, hint, tag):
        """qwen 看红框上下文图定品类(¥0.008,内容缓存)。抠图质量不够时返回 None。
        "未生成"轨迹也走这一步 —— 预审页/圈选提示的品类才不会是检测器的错标签。"""
        if not cut_quality_ok(cuts[cl[0]])[0]:
            return None
        return await extract_labels(
            _ctx_image(cl, tag), category_hint=hint, framed=True, strict=True,
        )

    for ci, cl in enumerate(gen_clusters):
        rep = tracks[cl[0]]
        best = rep["best"]
        ok, why = cut_quality_ok(cuts[cl[0]])
        labels = None
        cat = rep["category"]
        if ok:
            # 标签前置:qwen 看红框上下文图定品类,比检测词表准(电视机被检成"装饰"这类在此纠正);
            # "其他" = 词表误触发(门锁当家电),在花钱补全/生成之前就打回
            labels = await extract_labels(
                _ctx_image(cl, ci), category_hint=rep["category"], framed=True, strict=True,
            )
            if labels.get("category") == "其他":
                ok, why, cat = False, f"标签判'其他'({labels.get('sub', '')})", "其他"
            elif labels.get("category") in CATEGORIES:
                cat = labels["category"]
        if ok and _edge_cut(rep["best"]["bbox"]) >= 2:
            ok, why = False, "所有帧都被画面切边(部分视角,生成会脑补形态)"
        if ok and cat in SKIP_GEN_CATEGORIES:
            ok, why = False, "品类不生成3D(平面化方案)"
        if not ok:
            print(f"[5/6] 物体#{ci} {rep['category']} 跳过({why}),轨迹仍入索引")
            _index_only(cl, cat)
            continue
        # 补全强制(2026-07-20 验收定死的 SOP:单体化→补全→单体闸→一致性闸,任一环不过不生成)。
        # 原始 bbox 裁切带杂物/遮挡直通 TRELLIS 的 3D 几乎全废,"完整可见跳过补全"的省钱分流已删。
        # 识别内容进补全 prompt:光靠残缺抠图补全会脑补错形态,把红框上下文判出的
        # 具体子类(如"白色岩板餐桌")一起传给补全模型约束方向(segment_api 按自由文本拼prompt)
        desc = f"{labels['sub']}({cat})" if labels and labels.get("sub") else cat
        main_view = await enhance_cutout(cuts[cl[0]],
                                         os.path.join(work, f"enh_{ci}.jpg"),
                                         category=desc)
        if main_view == cuts[cl[0]]:
            print(f"[5/6] 物体#{ci} {cat} 补全失败(不许直通),轨迹仍入索引")
            _index_only(cl, cat)
            continue
        # 单体闸:补全图混入其他家具(餐桌图残留椅子) → 强化指令重试一次,再不过就打回
        from app.services.consistency import check_consistency, check_solo
        solo, swhy = await check_solo(main_view, desc)
        if not solo:
            print(f"[5/6] 物体#{ci} {cat} 单体闸未过({swhy}),强化指令重试补全")
            main_view = await enhance_cutout(
                cuts[cl[0]], os.path.join(work, f"enh_{ci}.jpg"),
                category=f"{desc},画面中只保留这一件家具,彻底移除旁边的其他家具和物体")
            solo, swhy = (await check_solo(main_view, desc)) \
                if main_view != cuts[cl[0]] else (False, "补全失败")
            if not solo:
                print(f"[5/6] 物体#{ci} {cat} 重试后仍不单体({swhy}),轨迹仍入索引")
                _index_only(cl, cat)
                continue
        # 幻觉闸:补全图必须还是原图那件家具(碎片框会被脑补成不存在的家具)
        same, why2 = await check_consistency(cuts[cl[0]], main_view)
        if not same:
            print(f"[5/6] 物体#{ci} {cat} 幻觉打回({why2}),轨迹仍入索引")
            _index_only(cl)
            continue
        # 多视角选图:代表帧 + 时间上离得最远的成员帧;默认 MAX_VIEWS=1 即单图
        views = [main_view]
        others = sorted(cl[1:], key=lambda j: -abs(tracks[j]["best"]["t"] - best["t"]))
        views += [cuts[j] for j in others[:MAX_VIEWS - 1]]

        print(f"[5/6] 物体#{ci} {cat} @ {best['t']}s"
              f"({len(cl)} 段轨迹,{len(views)} 视角)→ 3D")
        glb_url, status = await gen3d(views[0], extra_image_paths=views[1:])

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
            tid = db.insert_track(video_id, cat, interpolate(tr["points"]),
                                  t_start=tr["points"][0]["t"], t_end=tr["points"][-1]["t"],
                                  best_frame_t=tr["best"]["t"])
            db.bind_track_asset(tid, asset_id)
            if j == cl[0]:
                rep_track_id = tid
        db.update_asset(asset_id, source={"video_id": video_id,
                                          "track_id": rep_track_id, "t_best": best["t"]})
        print(f"      asset={asset_id} status={status}")

    # 截断掉的簇只入索引(可圈选后补生成);品类同样过 qwen 纠正,预审/圈选提示才不带错标签
    for ti, cl in enumerate(clusters[len(gen_clusters):]):
        cat = tracks[cl[0]]["category"]
        lb = await _corrected_labels(cl, cat, f"t{ti}")
        if lb and lb.get("category") in CATEGORIES:
            cat = lb["category"]
        for j in cl:
            tr = tracks[j]
            db.insert_track(video_id, cat, interpolate(tr["points"]),
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
