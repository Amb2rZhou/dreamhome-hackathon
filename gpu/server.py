"""GPU 推理服务:部署在 GPU 云服务器,backend 通过 REMOTE_GPU_URL 调用。

⚠️ 本文件在 GPU 机上运行,本仓库开发机上不装重依赖、未实测,上机时按 README 联调。

能力:
  POST /detect        单帧开集检测(Grounding DINO)→ 在线暂停识别 + 离线 pipeline 检测
  POST /embed         抠图 → CLIP 向量             → 排序辅助(可选)
  POST /gen3d         图生 3D(自部署 TRELLIS),异步任务队列 → 返回 job_id
  GET  /gen3d/{id}    查询任务;完成后 /files/{id}.glb 下载产物
  GET  /health        连通性检查(demo 前预热用)

TRELLIS 环境难装(spconv/flash-attn/kaolin),建议直接用社区 Docker 镜像跑,
本服务在镜像里以 TRELLIS_CODE_DIR 指向仓库路径。fal 实测 $0.1+/张,自部署回本点很低。
SAM2 视频级追踪(离线精确轨迹)后续加 /track,当前 pipeline 用 CPU IoU 关联已可出活。

启动:
  bash setup.sh          # 装依赖(国内机走清华源)
  python server.py       # 默认 0.0.0.0:9000
"""
import base64
import io
import os
import queue
import threading
import time
import uuid

import torch
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# 家具开集词表:英文给 DINO,映射回中文品类(与 backend 标签体系一致)
VOCAB = {
    "sofa": "沙发", "armchair": "单椅", "chair": "单椅", "stool": "单椅",
    "bed": "床", "cabinet": "柜子", "wardrobe": "柜子", "shelf": "柜子",
    "table": "桌子", "desk": "桌子", "lamp": "灯具", "chandelier": "灯具",
    "rug": "地毯", "carpet": "地毯", "potted plant": "绿植",
    "curtain": "窗帘", "mirror": "装饰", "painting": "装饰",
}
DETECT_THRESHOLD = 0.35

app = FastAPI(title="DreamHome GPU inference")

_detector = None
_clip = None


def get_detector():
    global _detector
    if _detector is None:
        from transformers import pipeline
        _detector = pipeline("zero-shot-object-detection",
                             model="IDEA-Research/grounding-dino-base", device=DEVICE)
    return _detector


def get_clip():
    global _clip
    if _clip is None:
        from transformers import CLIPModel, CLIPProcessor
        model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(DEVICE)
        proc = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
        _clip = (model, proc)
    return _clip


def _decode(data_uri: str) -> Image.Image:
    raw = base64.b64decode(data_uri.split(",", 1)[1])
    return Image.open(io.BytesIO(raw)).convert("RGB")


class DetectIn(BaseModel):
    video_id: str = ""
    t: float = 0
    frame_data_uri: str


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE}


@app.post("/detect")
def detect(req: DetectIn):
    """返回与 backend services/detect.py 相同的结构:归一化 bbox + 中文品类。"""
    img = _decode(req.frame_data_uri)
    W, H = img.size
    results = get_detector()(img, candidate_labels=list(VOCAB.keys()),
                             threshold=DETECT_THRESHOLD)
    boxes = []
    for r in results:
        b = r["box"]
        boxes.append({
            "bbox": [round(b["xmin"] / W, 3), round(b["ymin"] / H, 3),
                     round((b["xmax"] - b["xmin"]) / W, 3), round((b["ymax"] - b["ymin"]) / H, 3)],
            "category": VOCAB.get(r["label"], "其他"),
            "score": round(float(r["score"]), 3),
        })
    return {"boxes": boxes}


class EmbedIn(BaseModel):
    image_data_uri: str


@app.post("/embed")
def embed(req: EmbedIn):
    model, proc = get_clip()
    inputs = proc(images=_decode(req.image_data_uri), return_tensors="pt").to(DEVICE)
    with torch.no_grad():
        feat = model.get_image_features(**inputs)[0]
    feat = feat / feat.norm()
    return {"embedding": feat.cpu().tolist()}


# ---- 自部署 TRELLIS:单 GPU 串行队列,submit/poll 语义与 backend provider 对齐 ----

FILES_DIR = os.path.abspath(os.environ.get("GEN3D_FILES_DIR", "./files"))
os.makedirs(FILES_DIR, exist_ok=True)
app.mount("/files", StaticFiles(directory=FILES_DIR), name="files")

_gen_jobs: dict[str, dict] = {}          # job_id -> {status, error, created}
_gen_queue: "queue.Queue[tuple[str, Image.Image]]" = queue.Queue()
_trellis = None
_worker_started = False


def get_trellis():
    """TRELLIS pipeline 懒加载(首次 ~1-2 分钟,之后常驻显存)。"""
    global _trellis
    if _trellis is None:
        from trellis.pipelines import TrellisImageTo3DPipeline
        _trellis = TrellisImageTo3DPipeline.from_pretrained(
            os.environ.get("TRELLIS_MODEL", "microsoft/TRELLIS-image-large"))
        _trellis.cuda()
    return _trellis


def _gen_worker():
    while True:
        job_id, img = _gen_queue.get()
        job = _gen_jobs[job_id]
        try:
            job["status"] = "running"
            pipe = get_trellis()
            outputs = pipe.run(img, seed=1)
            from trellis.utils import postprocessing_utils
            glb = postprocessing_utils.to_glb(
                outputs["gaussian"][0], outputs["mesh"][0],
                simplify=0.95, texture_size=1024)
            glb.export(os.path.join(FILES_DIR, f"{job_id}.glb"))
            job["status"] = "succeeded"
        except Exception as e:  # noqa: BLE001 生成失败不能带崩 worker
            job["status"] = "failed"
            job["error"] = f"{type(e).__name__}: {e}"


def _ensure_worker():
    global _worker_started
    if not _worker_started:
        threading.Thread(target=_gen_worker, daemon=True).start()
        _worker_started = True


class Gen3DIn(BaseModel):
    image_data_uri: str


@app.post("/gen3d")
def gen3d_submit(req: Gen3DIn):
    _ensure_worker()
    job_id = uuid.uuid4().hex
    _gen_jobs[job_id] = {"status": "queued", "error": None, "created": time.time()}
    _gen_queue.put((job_id, _decode(req.image_data_uri)))
    return {"job_id": job_id}


@app.get("/gen3d/{job_id}")
def gen3d_status(job_id: str):
    job = _gen_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    out = {"status": job["status"], "error": job["error"],
           "queue_ahead": _gen_queue.qsize()}
    if job["status"] == "succeeded":
        out["glb_path"] = f"/files/{job_id}.glb"
    return out


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)
