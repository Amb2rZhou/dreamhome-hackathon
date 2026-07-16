"""TRELLIS 生成服务 —— 跑在 trellis-box 容器内(有 trellis 环境),只管 /gen3d。

宿主机的 server.py(检测/embedding)把 /gen3d 请求代理进来,产物 GLB 写到
/data/gen3d-files(宿主机挂载目录),由宿主机 server.py 的 /files 静态托管下发。

fp16 配方来自镜像自带的 webui/initialize_pipeline.py(flow/decoder 半精度 +
norm 层保 fp32),A10 实测 38s/件;不加配方会报 Half/Float dtype mismatch。

启动(容器内): cd /gpu && PYTHONPATH=/app python3 server_gen3d.py   # 0.0.0.0:9001
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
from PIL import Image
from pydantic import BaseModel

FILES_DIR = os.environ.get("GEN3D_FILES_DIR", "/data/gen3d-files")
os.makedirs(FILES_DIR, exist_ok=True)

app = FastAPI(title="TRELLIS gen3d worker")

_jobs: dict[str, dict] = {}
_queue: "queue.Queue[tuple[str, Image.Image]]" = queue.Queue()
_pipe = None
_worker_started = False


def get_pipe():
    global _pipe
    if _pipe is None:
        from trellis.pipelines import TrellisImageTo3DPipeline
        from trellis.modules.norm import LayerNorm32, GroupNorm32, ChannelLayerNorm32
        from trellis.modules.sparse.norm import SparseGroupNorm32, SparseLayerNorm32
        from trellis.modules.attention.modules import MultiHeadRMSNorm
        from trellis.modules.sparse.attention.modules import SparseMultiHeadRMSNorm

        pipe = TrellisImageTo3DPipeline.from_pretrained(
            os.environ.get("TRELLIS_MODEL", "microsoft/TRELLIS-image-large"))
        pipe.cuda()
        for name, model in pipe.models.items():
            if hasattr(model, "eval"):
                model.eval()
            if "flow" in name or "decoder" in name:
                model.half()
                for m in model.modules():
                    if isinstance(m, (LayerNorm32, GroupNorm32, ChannelLayerNorm32,
                                      SparseGroupNorm32, SparseLayerNorm32,
                                      MultiHeadRMSNorm, SparseMultiHeadRMSNorm)):
                        m.float()
        torch.backends.cudnn.benchmark = True
        torch.backends.cuda.matmul.allow_tf32 = True
        _pipe = pipe
    return _pipe


def _worker():
    from trellis.utils import postprocessing_utils
    while True:
        job_id, img = _queue.get()
        job = _jobs[job_id]
        try:
            job["status"] = "running"
            pipe = get_pipe()
            with torch.cuda.amp.autocast(enabled=True):
                processed = pipe.preprocess_image(img)
            with torch.inference_mode():
                out = pipe.run(processed, seed=1, formats=["gaussian", "mesh"],
                               preprocess_image=False)
            glb = postprocessing_utils.to_glb(out["gaussian"][0], out["mesh"][0],
                                              simplify=0.95, texture_size=1024)
            glb.export(os.path.join(FILES_DIR, f"{job_id}.glb"))
            job["status"] = "succeeded"
            torch.cuda.empty_cache()
        except Exception as e:  # noqa: BLE001 单次失败不带崩队列
            job["status"] = "failed"
            job["error"] = f"{type(e).__name__}: {e}"
            torch.cuda.empty_cache()


def _ensure_worker():
    global _worker_started
    if not _worker_started:
        threading.Thread(target=_worker, daemon=True).start()
        _worker_started = True


class Gen3DIn(BaseModel):
    image_data_uri: str


@app.get("/health")
def health():
    return {"status": "ok", "loaded": _pipe is not None, "queue": _queue.qsize()}


@app.post("/gen3d")
def submit(req: Gen3DIn):
    _ensure_worker()
    raw = base64.b64decode(req.image_data_uri.split(",", 1)[1])
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    job_id = uuid.uuid4().hex
    _jobs[job_id] = {"status": "queued", "error": None, "created": time.time()}
    _queue.put((job_id, img))
    return {"job_id": job_id}


@app.get("/gen3d/{job_id}")
def status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    out = {"status": job["status"], "error": job["error"], "queue_ahead": _queue.qsize()}
    if job["status"] == "succeeded":
        out["glb_path"] = f"/files/{job_id}.glb"
    return out


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9001)
