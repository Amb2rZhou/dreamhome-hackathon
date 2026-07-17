"""聚类预审页:3D 生成前,把"哪些轨迹会被当成同一物体"摆出来人工审。

复算 pipeline 到聚类为止(检测/向量全走缓存,秒级),输出静态 HTML:
每簇一行 = 代表抠图(将用于生成) + 全部成员抠图 + 品类/时段/预判(会生成/会跳过及原因)。

用法: ./.venv/bin/python tools/preview_clusters.py <抖音链接或本地视频路径>
输出: storage/review_clusters/<key>/index.html
"""
import asyncio
import hashlib
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.services import cache  # noqa: E402
from app.services.detect import detect_frame  # noqa: E402
from pipeline.run import (SKIP_GEN_CATEGORIES, cluster_tracks, cut_quality_ok,  # noqa: E402
                          cutout, embed_image, extract_keyframes, link_tracks)


async def main():
    src = sys.argv[1]
    if src.startswith("http"):
        from tools.douyin_dl import download as dy_download
        key = hashlib.md5(src.encode()).hexdigest()[:12]
        vpath = os.path.join(os.path.abspath(settings.STORAGE_DIR), "downloads", f"{key}.mp4")
        if not os.path.exists(vpath):
            dy_download(src, vpath)
    else:
        vpath, key = src, hashlib.md5(src.encode()).hexdigest()[:12]

    out_dir = os.path.join(os.path.abspath(settings.STORAGE_DIR), "review_clusters", key)
    os.makedirs(out_dir, exist_ok=True)
    work = os.path.join(out_dir, "work")
    os.makedirs(work, exist_ok=True)

    print("[1/3] 抽帧+检测(走缓存)")
    frames, _ = extract_keyframes(vpath, work)
    import base64
    detections = []
    for idx, f in enumerate(frames):
        ck = cache.content_key(f["path"], extra=f"detect|{settings.effective_detect_provider}")
        hit = cache.get("detect", ck)
        if hit is not None:
            boxes = hit["boxes"]
        else:
            with open(f["path"], "rb") as fh:
                uri = "data:image/jpeg;base64," + base64.b64encode(fh.read()).decode()
            try:
                boxes = await detect_frame("preview", f["t"], uri)
                cache.put("detect", ck, {"boxes": boxes})
            except Exception:  # noqa: BLE001
                boxes = []
        for b in boxes:
            detections.append({"t": f["t"], "bbox": b["bbox"],
                               "category": b["category"], "frame": f["path"]})
        if idx % 60 == 59:
            print(f"      {idx+1}/{len(frames)}")

    tracks = link_tracks(detections)
    sharp = {f["path"]: f["sharpness"] for f in frames}

    def edge_cut(b):
        return sum([b[0] < 0.01, b[1] < 0.01, b[0] + b[2] > 0.99, b[1] + b[3] > 0.99])

    def quality(p):
        return sharp.get(p["frame"], 0) * p["bbox"][2] * p["bbox"][3] * (0.3 ** edge_cut(p["bbox"]))

    tracks.sort(key=lambda tr: -(len(tr["points"]) *
                                 sum(p["bbox"][2] * p["bbox"][3] for p in tr["points"]) / len(tr["points"])))
    cuts = []
    for i, tr in enumerate(tracks):
        best = max(tr["points"], key=quality)
        tr["best"] = best
        cp = os.path.join(out_dir, f"cut_{i}.jpg")
        cutout(best["frame"], best["bbox"], cp)
        cuts.append(cp)
    print(f"[2/3] {len(tracks)} 条轨迹,算向量(走缓存)")
    embeds = [await embed_image(p) for p in cuts]
    clusters = cluster_tracks(tracks, embeds)

    rows = []
    for ci, cl in enumerate(clusters):
        rep = tracks[cl[0]]
        ok, why = cut_quality_ok(cuts[cl[0]])
        if rep["category"] in SKIP_GEN_CATEGORIES:
            ok, why = False, "品类不生成(平面化)"
        elif ok and edge_cut(rep["best"]["bbox"]) >= 2:
            ok, why = False, "切边严重(防形态脑补)"
        spans = "、".join(f"{tracks[j]['points'][0]['t']:.0f}-{tracks[j]['points'][-1]['t']:.0f}s" for j in cl)
        imgs = "".join(f'<div class="m"><img src="cut_{j}.jpg"><span>{tracks[j]["points"][0]["t"]:.0f}s</span></div>'
                       for j in cl)
        verdict = ('<b class="go">将生成</b>' if ok else f'<b class="skip">跳过·{why}</b>')
        rows.append(f'''<div class="row"><div class="head">#{ci} <b>{rep["category"]}</b>
          · {len(cl)}段轨迹 · {spans} · {verdict}</div><div class="strip">{imgs}</div></div>''')

    html = f'''<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>聚类预审 · {key}</title><style>
body{{font-family:-apple-system,"PingFang SC";background:#f5f5f7;margin:0;padding:16px}}
.row{{background:#fff;border-radius:12px;margin-bottom:10px;padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}}
.head{{font-size:13px;color:#333;margin-bottom:8px}}
.go{{color:#1a7f37}} .skip{{color:#b45309}}
.strip{{display:flex;gap:8px;overflow-x:auto}}
.m{{text-align:center}} .m img{{height:110px;border-radius:8px;display:block}}
.m span{{font-size:11px;color:#888}}
h1{{font-size:16px}}</style></head><body>
<h1>聚类预审 · {len(clusters)} 个物体(每行=判定为同一物体的全部片段;发现"一行里有两种东西"或"两行其实是同一件"就告诉我编号)</h1>
{"".join(rows)}</body></html>'''
    with open(os.path.join(out_dir, "index.html"), "w") as f:
        f.write(html)
    n_go = sum('将生成' in r for r in rows)
    print(f"[3/3] {len(clusters)} 簇(将生成 {n_go},跳过 {len(clusters)-n_go})")
    print(f"预审页: {settings.PUBLIC_BASE_URL}/storage/review_clusters/{key}/index.html")


if __name__ == "__main__":
    asyncio.run(main())
