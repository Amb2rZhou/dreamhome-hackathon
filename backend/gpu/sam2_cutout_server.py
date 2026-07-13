"""
SAM2 抠图服务 —— 交互式选区(box / point)→ 干净白底/透明底,直接喂给 TRELLIS。

用 ultralytics 封装的 SAM2:安装最省事(无需编译 CUDA 扩展)、权重自动下载。
跑法见同目录 README.md。

接口:
  GET  /health
  POST /segment   多部分表单:
       file   图片(必填)
       box    "x1,y1,x2,y2" 像素框(强烈建议:最准)
       points "x,y;x,y"     点提示(box 二选一)
       labels "1,0"         点的前景(1)/背景(0),默认全 1
       bg     white|transparent  默认 white(TRELLIS 喜欢干净纯底)
       pad    裁剪四周留白比例,默认 0.06
       max_size 输出最长边,默认 1024
  返回 JSON: { cutout: "data:image/png;base64,...", bbox:[x1,y1,x2,y2], size:[w,h], bg }
       cutout 是 data URI,直接作为 TRELLIS 的 image_url。
"""
import io
import base64
from typing import Optional

import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from ultralytics import SAM

# 权重:base+ 平衡档;更准用 sam2.1_l.pt,更快用 sam2.1_t.pt。首次运行自动下载。
MODEL_NAME = "sam2.1_b.pt"
sam = SAM(MODEL_NAME)

app = FastAPI(title="DreamHome SAM2 Cutout")


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME}


def _to_data_uri(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buf.getvalue()).decode()


@app.post("/segment")
async def segment(
    file: UploadFile = File(...),
    box: Optional[str] = Form(None),
    points: Optional[str] = Form(None),
    labels: Optional[str] = Form(None),
    bg: str = Form("white"),
    pad: float = Form(0.06),
    max_size: int = Form(1024),
):
    raw = await file.read()
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(400, "无法解码图片")
    W, H = img.size
    arr = np.array(img)

    # 组装提示
    kwargs = {}
    if box:
        try:
            x1, y1, x2, y2 = [float(v) for v in box.split(",")]
            kwargs["bboxes"] = [[x1, y1, x2, y2]]
        except Exception:
            raise HTTPException(400, "box 格式应为 x1,y1,x2,y2")
    elif points:
        try:
            pts = [[float(a) for a in p.split(",")] for p in points.split(";")]
        except Exception:
            raise HTTPException(400, "points 格式应为 x,y;x,y")
        kwargs["points"] = pts
        kwargs["labels"] = [int(v) for v in labels.split(",")] if labels else [1] * len(pts)
    else:
        # 没给提示:用画面中心点兜底(前端尽量传 box,更准)
        kwargs["points"] = [[W / 2.0, H / 2.0]]
        kwargs["labels"] = [1]

    results = sam(img, verbose=False, **kwargs)
    if not results or results[0].masks is None or len(results[0].masks.data) == 0:
        raise HTTPException(422, "未分割出物体,换个 box/point 再试")

    mask = results[0].masks.data[0].cpu().numpy().astype(bool)  # HxW
    if mask.shape != (H, W):  # 兜底:掩码若被缩放过,拉回原图尺寸
        mask = np.array(Image.fromarray((mask.astype(np.uint8) * 255)).resize((W, H))) > 127

    ys, xs = np.where(mask)
    if xs.size == 0:
        raise HTTPException(422, "空掩码")
    x1, x2, y1, y2 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())

    # 按 mask 包围盒裁剪 + 四周留白(TRELLIS 喜欢主体居中充满)
    bw, bh = x2 - x1, y2 - y1
    px, py = int(bw * pad), int(bh * pad)
    cx1, cy1 = max(0, x1 - px), max(0, y1 - py)
    cx2, cy2 = min(W, x2 + px + 1), min(H, y2 + py + 1)

    rgba = np.dstack([arr, (mask * 255).astype(np.uint8)])
    cut = Image.fromarray(rgba, "RGBA").crop((cx1, cy1, cx2, cy2))

    if bg == "transparent":
        out, fmt = cut, "PNG"
    else:  # white
        canvas = Image.new("RGBA", cut.size, (255, 255, 255, 255))
        canvas.alpha_composite(cut)
        out, fmt = canvas.convert("RGB"), "PNG"

    if max(out.size) > max_size:
        s = max_size / max(out.size)
        out = out.resize((max(1, int(out.width * s)), max(1, int(out.height * s))))

    return JSONResponse({
        "cutout": _to_data_uri(out, fmt),
        "bbox": [x1, y1, x2, y2],
        "size": [out.width, out.height],
        "bg": bg,
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
