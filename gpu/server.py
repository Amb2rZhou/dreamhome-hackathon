"""GPU 推理服务:部署在 AutoDL/RunPod,backend 通过 REMOTE_GPU_URL 调用。

⚠️ 本文件在 GPU 机上运行,本仓库开发机上不装重依赖、未实测,上机时按 README 联调。

能力:
  POST /detect  单帧开集检测(Grounding DINO)  → 在线暂停识别 + 离线 pipeline 检测
  POST /embed   抠图 → CLIP 向量               → 排序辅助(可选)
  GET  /health  连通性检查(demo 前预热用)

SAM2 视频级追踪(离线精确轨迹)后续加 /track,当前 pipeline 用 CPU IoU 关联已可出活。

启动:
  bash setup.sh          # 装依赖(国内机走清华源)
  python server.py       # 默认 0.0.0.0:9000
"""
import base64
import io

import torch
from fastapi import FastAPI
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)
