"""认领一个还在服务器上跑的 SAM2 任务:等它完成,把结果写进本地内容缓存。

用途:客户端轮询中断/超时后,服务器任务并没有死 —— 不重跑,接住它。
用法: ./.venv/bin/python tools/adopt_track_job.py <video_path> <job_id>
之后重跑 pipeline,sam2track 缓存命中,秒过 SAM2 直达聚类。
"""
import hashlib
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402

from app.config import settings  # noqa: E402
from app.services import cache  # noqa: E402
from pipeline.run import extract_keyframes, link_tracks  # noqa: E402


def main():
    video_path, job_id = sys.argv[1], sys.argv[2]
    # 重放确定性前缀(抽帧+检测缓存+关联+排序)以重建与原请求逐字节一致的 seeds
    work = tempfile.mkdtemp(prefix="adopt_frames_")
    frames, _ = extract_keyframes(video_path, work)
    detections = []
    for f in frames:
        ck = cache.content_key(f["path"], extra=f"detect|{settings.effective_detect_provider}")
        hit = cache.get("detect", ck)
        for b in (hit["boxes"] if hit else []):
            detections.append({"t": f["t"], "bbox": b["bbox"],
                               "category": b["category"], "frame": f["path"]})
    tracks = link_tracks(detections)
    tracks.sort(key=lambda tr: -(len(tr["points"]) *
                                 sum(p["bbox"][2] * p["bbox"][3] for p in tr["points"]) / len(tr["points"])))
    sharp = {f["path"]: f["sharpness"] for f in frames}
    seeds = []
    for i, tr in enumerate(tracks):
        b = max(tr["points"], key=lambda p: sharp.get(p["frame"], 0) * p["bbox"][2] * p["bbox"][3])
        seeds.append({"obj_id": i, "t": b["t"], "bbox": b["bbox"]})
    seed_sig = hashlib.md5(json.dumps(seeds, sort_keys=True).encode()).hexdigest()[:12]
    key = cache.content_key(video_path, extra=f"sam2track|{seed_sig}")
    print(f"seeds={len(seeds)} cache_key={key[:12]}...")

    while True:
        r = httpx.get(f"{settings.REMOTE_GPU_URL}/track/{job_id}", timeout=30, trust_env=False)
        r.raise_for_status()
        data = r.json()
        if data["status"] == "succeeded":
            cache.put("sam2track", key, {"result": data["result"]})
            print(f"ADOPTED: {len(data['result']['objects'])} objects → 缓存已写入")
            return 0
        if data["status"] == "failed":
            print(f"JOB FAILED: {data.get('error','')[:200]}")
            return 1
        print(f"  {data.get('progress','')} ...")
        time.sleep(20)


if __name__ == "__main__":
    sys.exit(main())
