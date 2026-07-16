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

import torch
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# 家具开集词表:英文给 DINO,映射回中文品类(与 backend 标签体系一致)。
# Grounding DINO 的 prompt 词数过多会互相稀释(18 词时 potted plant 直接检不出),
# 所以拆成 ≤5 词的组,推理时同图多 prompt 一个 batch 跑。
VOCAB = {
    "sofa": "沙发", "armchair": "单椅", "chair": "单椅", "stool": "单椅",
    "bed": "床", "cabinet": "柜子", "shelf": "柜子", "table": "桌子",
    "desk": "桌子", "lamp": "灯具", "rug": "地毯", "potted plant": "绿植",
    "curtain": "窗帘", "mirror": "装饰", "painting": "装饰",
}
_KEYS = list(VOCAB)
VOCAB_CHUNKS = [_KEYS[i:i + 5] for i in range(0, len(_KEYS), 5)]
DETECT_THRESHOLD = 0.35

app = FastAPI(title="DreamHome GPU inference")

_detector = None
_clip = None


def get_detector():
    """直接用 processor+model:HF pipeline 会对每个候选词单独跑前向(18 词 = 18 次推理,
    base 5s / tiny 4s);拼成单条 prompt 一次前向即可全检出。
    效果不够再 DETECT_MODEL=IDEA-Research/grounding-dino-base。"""
    global _detector
    if _detector is None:
        import os
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
        name = os.environ.get("DETECT_MODEL", "IDEA-Research/grounding-dino-tiny")
        processor = AutoProcessor.from_pretrained(name)
        model = AutoModelForZeroShotObjectDetection.from_pretrained(name).to(DEVICE).eval()
        _detector = (processor, model)
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


def _iou(a, b):
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


@app.post("/detect")
def detect(req: DetectIn):
    """返回与 backend services/detect.py 相同的结构:归一化 bbox + 中文品类。"""
    img = _decode(req.frame_data_uri)
    img.thumbnail((800, 800))  # 检测不需要原图分辨率,缩到 800px 提速数倍
    W, H = img.size
    processor, model = get_detector()
    # 同一张图 × 每组词一条 prompt,一个 batch 单次前向(prompt 约定:小写+句点)
    texts = [" ".join(f"{k}." for k in chunk) for chunk in VOCAB_CHUNKS]
    inputs = processor(images=[img] * len(texts), text=texts,
                       return_tensors="pt", padding=True).to(DEVICE)
    with torch.no_grad():
        outputs = model(**inputs)
    results = processor.post_process_grounded_object_detection(
        outputs, inputs.input_ids, threshold=DETECT_THRESHOLD,
        text_threshold=0.25, target_sizes=[(H, W)] * len(texts))
    cands = []
    for res in results:
        phrases = res.get("text_labels") or res.get("labels")
        for score, box, phrase in zip(res["scores"], res["boxes"], phrases):
            x0, y0, x1, y1 = [float(v) for v in box]
            # 命中的 phrase 可能是多词拼接,取词表里能对上的那个(长词优先,armchair≠chair)
            cat = next((VOCAB[k] for k in sorted(VOCAB, key=len, reverse=True)
                        if k in str(phrase)), "其他")
            cands.append({
                "bbox": [round(x0 / W, 3), round(y0 / H, 3),
                         round((x1 - x0) / W, 3), round((y1 - y0) / H, 3)],
                "category": cat,
                "score": round(float(score), 3),
            })
    # 跨标签 NMS:同一区域会被多个词命中,只留分数最高的那个标签
    cands.sort(key=lambda c: -c["score"])
    boxes = []
    for c in cands:
        if all(_iou(c["bbox"], k["bbox"]) < 0.6 for k in boxes):
            boxes.append(c)
    return {"boxes": boxes}


class EmbedIn(BaseModel):
    image_data_uri: str


@app.post("/embed")
def embed(req: EmbedIn):
    model, proc = get_clip()
    inputs = proc(images=_decode(req.image_data_uri), return_tensors="pt").to(DEVICE)
    with torch.no_grad():
        feat = model.get_image_features(**inputs)
    # 部分 transformers 版本返回输出对象而非张量,取 pooled 向量兜底
    if not torch.is_tensor(feat):
        feat = feat.pooler_output
    feat = feat.flatten()
    feat = feat / feat.norm()
    return {"embedding": feat.cpu().tolist()}


# ---- 3D 生成:代理到 trellis-box 容器内的 server_gen3d.py(那边才有 trellis 环境) ----
# 产物 GLB 写在共享目录(宿主挂载给容器),由本服务 /files 静态托管下发。

FILES_DIR = os.path.abspath(os.environ.get("GEN3D_FILES_DIR", "./files"))
os.makedirs(FILES_DIR, exist_ok=True)
app.mount("/files", StaticFiles(directory=FILES_DIR), name="files")

GEN3D_BACKEND = os.environ.get("GEN3D_BACKEND_URL", "http://127.0.0.1:9001")


class Gen3DIn(BaseModel):
    image_data_uri: str = ""            # 单图(兼容)
    image_data_uris: list[str] = []     # 多角度图(2-4张)


@app.post("/gen3d")
def gen3d_submit(req: Gen3DIn):
    import httpx
    uris = req.image_data_uris or ([req.image_data_uri] if req.image_data_uri else [])
    if not uris:
        raise HTTPException(422, "no image provided")
    try:
        r = httpx.post(f"{GEN3D_BACKEND}/gen3d", json={"image_data_uris": uris},
                       timeout=120, trust_env=False)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError as e:
        raise HTTPException(503, f"gen3d worker unreachable: {e}")


@app.get("/gen3d/{job_id}")
def gen3d_status(job_id: str):
    import httpx
    try:
        r = httpx.get(f"{GEN3D_BACKEND}/gen3d/{job_id}", timeout=30, trust_env=False)
        if r.status_code == 404:
            raise HTTPException(404, "job not found")
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError as e:
        raise HTTPException(503, f"gen3d worker unreachable: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)
