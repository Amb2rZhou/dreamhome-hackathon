"""段级外观校验绑定:光标宁缺勿错。

绑了资产的轨迹逐段采样抠图 → CLIP 向量(GPU /embed,带内容缓存)→ 与资产成品图
(thumb)比余弦相似度;不像的部分解绑拆成独立"未生成"轨迹,像的部分保留绑定。
治两类错绑:跨场景嵌合体(玄关摆件≠餐边摆件)、镜头平移身份漂移(玄关台→吧台)。
不重新生成任何 3D,零 API 费。

用法: ./.venv/bin/python tools/verify_bindings.py <video_id> [--dry] [--thresh 0.75]
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db  # noqa: E402
from app.config import settings  # noqa: E402
from pipeline.run import _cos, context_crop, cutout, embed_image, extract_keyframes  # noqa: E402

SEG_GAP = 2.0        # 时间段切分间隔
MAX_SAMPLES = 8      # 每段最多采样点数
CLIP_HI = 0.92       # ≥此值免审保留(几乎同图)
CLIP_LO = 0.60       # <此值直接解绑
# 灰区(LO~HI)交 qwen 看红框上下文图对判"是否同一件实物"(¥0.008/次,带缓存)


async def _same_object_llm(ctx_a: str, ctx_b: str) -> bool | None:
    """两张红框上下文图是否为同一件实物家具。不可判时返回 None(保守保留)。"""
    if not settings.DASHSCOPE_API_KEY:
        return None
    import base64
    import re

    import httpx

    from app.services import cache
    key = cache.content_key(ctx_a, ctx_b, extra="samecheck-v1")
    hit = cache.get("consistency", key)
    if hit is not None:
        return hit["same"]
    prompt = ("两张图都截自同一条家装视频,红框各标出一件家具。判断两个红框里是否是"
              "**同一件实物**(不是'同款/同品类'——要同一件:本体外形颜色材质一致,"
              "且周围环境/相邻物体能对上)。只输出 JSON: "
              '{"same": true/false, "reason": "一句话"}')

    def _uri(p):
        with open(p, "rb") as f:
            return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    try:
        payload = {"model": settings.DASHSCOPE_VL_MODEL,
                   "messages": [{"role": "user", "content": [
                       {"type": "image_url", "image_url": {"url": _uri(ctx_a)}},
                       {"type": "image_url", "image_url": {"url": _uri(ctx_b)}},
                       {"type": "text", "text": prompt}]}]}
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            r = await client.post(
                "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.DASHSCOPE_API_KEY}"},
                json=payload)
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]
        m = re.search(r"\{.*\}", text, re.S)
        same = bool(json.loads(m.group(0)).get("same", True)) if m else None
        if same is not None:
            cache.put("consistency", key, {"same": same})
        return same
    except Exception:  # noqa: BLE001
        return None


def _segments(pts: list[dict]) -> list[list[dict]]:
    segs = [[pts[0]]]
    for a, b in zip(pts, pts[1:]):
        if b["t"] - a["t"] > SEG_GAP:
            segs.append([])
        segs[-1].append(b)
    return segs


def _samples(seg: list[dict], frame_times: list[float]) -> list[tuple[float, dict]]:
    """段内采样:取段时间范围内的关键帧时刻,配最近点的 bbox(DB 点多为插值,
    直接按点找帧会大面积落空)。返回 [(采样帧时刻, 供 bbox 的点)],首尾优先。"""
    import bisect as _b
    lo = _b.bisect_left(frame_times, seg[0]["t"] - 0.3)
    hi = _b.bisect_right(frame_times, seg[-1]["t"] + 0.3)
    cands = frame_times[lo:hi]
    if not cands:
        return []
    if len(cands) > MAX_SAMPLES:
        step = (len(cands) - 1) / (MAX_SAMPLES - 1)
        cands = sorted({cands[round(i * step)] for i in range(MAX_SAMPLES)})
    out = []
    for ft in cands:
        p = min(seg, key=lambda p: abs(p["t"] - ft))
        if abs(p["t"] - ft) <= 1.0:
            out.append((ft, p))
    return out


async def main():
    video_id = sys.argv[1]
    dry = "--dry" in sys.argv
    thresh = float(sys.argv[sys.argv.index("--thresh") + 1]) if "--thresh" in sys.argv else 0.75
    video = db.get_video(video_id)
    if not video:
        raise SystemExit(f"video not found: {video_id}")
    storage = os.path.abspath(settings.STORAGE_DIR)
    vpath = os.path.join(storage, video["play_url"].split("/storage/")[-1])
    work = os.path.join(storage, "pipeline", video_id)
    crop_dir = os.path.join(work, "verify_crops")
    os.makedirs(crop_dir, exist_ok=True)

    frames, _ = extract_keyframes(vpath, work)
    t2frame = {round(f["t"], 1): f["path"] for f in frames}

    def _frame_at(t: float) -> str | None:
        for k in (round(t, 1), round(t + 0.1, 1), round(t - 0.1, 1)):
            if k in t2frame:
                return t2frame[k]
        return None

    # 绑定校验的锚向量:优先用"原视频源头抠图"(成品图经过补全/重打光,风格差异
    # 会拉低同物相似度);thumb 作为第二锚,判定取两者较高分
    rep_emb: dict[str, list[list]] = {}
    rep_ctx: dict[str, str] = {}
    aname: dict[str, str] = {}
    trk_by_id = {t["track_id"]: t for t in db.tracks_of_video(video_id)}
    for a in db.all_assets_raw(status="ready"):
        src = json.loads(a["source_json"] or "{}")
        if src.get("video_id") != video_id:
            continue
        vecs = []
        st = trk_by_id.get(src.get("track_id"))
        if st:
            cand = [p for p in st["frames"]
                    if abs(p["t"] - src.get("t_best", -99)) <= 0.3 and _frame_at(p["t"])]
            if cand:
                p0 = cand[0]
                crop = os.path.join(crop_dir, f"rep_{a['asset_id'][:12]}.jpg")
                try:
                    cutout(_frame_at(p0["t"]), p0["bbox"], crop)
                    v = await embed_image(crop)
                    if v:
                        vecs.append(v)
                    rep_ctx[a["asset_id"]] = context_crop(
                        _frame_at(p0["t"]), p0["bbox"],
                        os.path.join(crop_dir, f"repctx_{a['asset_id'][:12]}.jpg"))
                except Exception:  # noqa: BLE001
                    pass
        if a.get("thumb_url"):
            p = os.path.join(storage, a["thumb_url"].split("/storage/")[-1])
            if os.path.exists(p):
                v = await embed_image(p)
                if v:
                    vecs.append(v)
        if vecs:
            rep_emb[a["asset_id"]] = vecs
            aname[a["asset_id"]] = a["name"]

    sem = asyncio.Semaphore(8)

    embed_stat = {"ok": 0, "fail": 0}

    async def _sample_cos(tid: str, si: int, k: int, ft: float, p: dict,
                          reps: list[list]) -> tuple[int, float | None]:
        fp = _frame_at(ft)
        if not fp:
            return k, None
        crop = os.path.join(crop_dir, f"{tid[:12]}_{si}_{k}.jpg")
        try:
            cutout(fp, p["bbox"], crop)
            async with sem:
                v = await embed_image(crop)
            embed_stat["ok" if v else "fail"] += 1
            return k, (max(_cos(v, r) for r in reps) if v else None)
        except Exception:  # noqa: BLE001 单点失败按"无法判定"处理
            return k, None

    frame_times = sorted(t2frame.keys())
    src_by_aid = {a["asset_id"]: json.loads(a["source_json"] or "{}")
                  for a in db.all_assets_raw(status="ready")}
    n_unbind_seg = n_keep_seg = n_cut_pts = 0
    for tr in db.tracks_of_video(video_id):
        aid = tr.get("asset_id")
        if not aid or aid not in rep_emb:
            continue
        rep = rep_emb[aid]
        # 资产来源轨迹的 t_best 附近强制保留(溯源锚,资产面板要能跳回来源时刻)
        src = src_by_aid.get(aid, {})
        anchor_t = src.get("t_best") if src.get("track_id") == tr["track_id"] else None
        total = embed_stat["ok"] + embed_stat["fail"]
        if total >= 10 and embed_stat["fail"] > total * 0.3:
            raise SystemExit(f"GPU /embed 大面积失败({embed_stat['fail']}/{total}),"
                             "中止,未写库 —— 先修 GPU 服务再跑")
        pts = sorted(tr["frames"], key=lambda p: p["t"])
        keep_pts, orphan_runs = [], []
        print(f"\n{tr['track_id'][:12]} {tr['category']} → {aname[aid]}"
              f"(t_best 段应高分)")
        for si, seg in enumerate(_segments(pts)):
            smp = _samples(seg, frame_times)
            scored = await asyncio.gather(
                *(_sample_cos(tr["track_id"], si, k, ft, p, rep)
                  for k, (ft, p) in enumerate(smp)))
            scored = [(k, c) for k, c in scored if c is not None]
            disp = " ".join(f"{smp[k][0]:.0f}s:{c:.2f}" for k, c in scored)
            if not scored:  # 无法判定,保守保留绑定
                keep_pts += seg
                print(f"  段{si} {seg[0]['t']:.0f}-{seg[-1]['t']:.0f}s 无法采样,保留")
                continue
            # 三档判定:CLIP 高分免审 / 低分直杀 / 灰区 qwen 看红框上下文对判
            async def _verdict(k: int, c: float) -> bool:
                if c >= CLIP_HI:
                    return True
                if c < CLIP_LO:
                    return False
                if aid not in rep_ctx:
                    return c >= thresh  # 无上下文锚,退回 CLIP 阈值
                ft, p = smp[k]
                ctx = os.path.join(crop_dir, f"ctx_{tr['track_id'][:12]}_{si}_{k}.jpg")
                context_crop(_frame_at(ft), p["bbox"], ctx)
                same = await _same_object_llm(ctx, rep_ctx[aid])
                return c >= thresh if same is None else same
            # 只审首尾两个采样(段内物体身份最多变一次:漂移是单向的)
            head_k, head_c = scored[0]
            tail_k, tail_c = scored[-1]
            head_ok = await _verdict(head_k, head_c)
            tail_ok = head_ok if head_k == tail_k else await _verdict(tail_k, tail_c)
            if head_ok and tail_ok:
                kept_flags = [True] * len(seg)
            elif not head_ok and not tail_ok:
                kept_flags = [False] * len(seg)
            else:  # 首尾不一致:在两采样中点切开,各随其侧
                mid_t = (smp[head_k][0] + smp[tail_k][0]) / 2
                kept_flags = [(head_ok if p["t"] <= mid_t else tail_ok) for p in seg]
            if anchor_t is not None:  # 溯源锚强制保留
                for k2, p in enumerate(seg):
                    if abs(p["t"] - anchor_t) <= 1.5:
                        kept_flags[k2] = True
            n_match = sum(kept_flags)
            print(f"  段{si} {seg[0]['t']:.0f}-{seg[-1]['t']:.0f}s [{disp}]"
                  f" 首{'✓' if head_ok else '✗'}尾{'✓' if tail_ok else '✗'}"
                  f" → 保留 {n_match}/{len(seg)} 点")
            if n_match == len(seg):
                keep_pts += seg
                n_keep_seg += 1
                continue
            if n_match == 0:
                orphan_runs.append(seg)
                n_unbind_seg += 1
                continue
            run: list = []
            for k, p in enumerate(seg):  # 混合段:按连续同判定切开
                if run and kept_flags[k] != kept_flags[k - 1]:
                    (keep_pts.extend if kept_flags[k - 1] else orphan_runs.append)(run)
                    run = []
                run.append(p)
            if run:
                (keep_pts.extend if kept_flags[-1] else orphan_runs.append)(run)
            n_cut_pts += len(seg) - n_match
        if dry:
            continue
        keep_pts.sort(key=lambda p: p["t"])
        if len(keep_pts) >= 2:
            db._exec(  # noqa: SLF001
                "UPDATE tracks SET frames_json=?, t_start=?, t_end=? WHERE track_id=?",
                (json.dumps(keep_pts), keep_pts[0]["t"], keep_pts[-1]["t"], tr["track_id"]))
        else:
            # 整条都不像成品图:解绑但保留索引(嵌合体被聚类错绑到别人资产上的情况)
            db._exec("UPDATE tracks SET asset_id=NULL WHERE track_id=?",  # noqa: SLF001
                     (tr["track_id"],))
        for run in orphan_runs:
            if len(run) >= 2:
                db.insert_track(video_id, tr["category"], sorted(run, key=lambda p: p["t"]),
                                t_start=run[0]["t"], t_end=run[-1]["t"],
                                best_frame_t=run[0]["t"])
    mode = "DRY(未写库)" if dry else "已写库"
    print(f"\n{mode}: 保留段 {n_keep_seg},整段解绑 {n_unbind_seg},混合段切除点 {n_cut_pts},阈值 {thresh}")

asyncio.run(main())
