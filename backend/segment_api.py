"""DreamHome 演示用抠图服务。

只做一件事：收图片 + bbox（圈选框），返回去背景的透明 PNG。
策略：按 bbox 裁剪 → rembg 去背景 → 返回透明 PNG。
rembg 首次运行会自动下载 u2net 模型（~176MB）到 ~/.u2net/。
"""
import io
import os
import ssl
import time
import json
import urllib.request
import urllib.error
from typing import Optional, Tuple
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from PIL import Image
from rembg import remove

app = FastAPI(title="DreamHome Segment")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

REMOVEBG_API_KEY = os.environ.get("REMOVEBG_API_KEY", "")
REMOVEBG_URL = "https://api.remove.bg/v1.0/removebg"

# 成本日志：记录每次 AI 调用（模型、成功/失败、耗时），写入 backend/logs/usage.jsonl
LOGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(LOGS_DIR, exist_ok=True)
USAGE_LOG = os.path.join(LOGS_DIR, "usage.jsonl")

# wan2.7 单价（文档估算，百炼控制台为准）
PRICE = {
    "wan2.7-image-pro": 0.30,
    "wan2.7-image": 0.20,
    "removebg": 0.00,  # removebg 走的是自己的额度，这里不计
}


def log_usage(model: str, ok: bool, duration: float, note: str = ""):
    entry = {
        "ts": time.time(),
        "model": model,
        "ok": ok,
        "duration": round(duration, 2),
        "price": PRICE.get(model, 0.0),
        "note": note,
    }
    try:
        with open(USAGE_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def parse_bbox(bbox: Optional[str]) -> Optional[Tuple[int, int, int, int]]:
    if not bbox:
        return None
    try:
        x, y, w, h = (int(v) for v in bbox.split(","))
        return (x, y, x + w, y + h)
    except Exception:
        return None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/segment")
async def segment(
    file: UploadFile = File(...),
    bbox: Optional[str] = Form(None, description="圈选框 x,y,w,h"),
    path: Optional[str] = Form(None, description="用户轨迹 x1,y1;x2,y2;...（bbox 相对坐标），path 外区域 rembg 前抹透明"),
):
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    try:
        im = Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception as e:
        raise HTTPException(400, f"bad image: {e}")

    box = parse_bbox(bbox)
    if box:
        im = im.crop(box)

    # rembg 先处理完整上下文（所有物体都参与前景/背景分类），模型认的是像素不是 alpha
    out = remove(im)

    # path 介入：rembg 之后，只保留 path 内的区域，path 外抹透明
    # 这样 path 外被误认为前景的物体（如桌子）被物理裁掉
    pts = parse_path(path)
    if pts:
        from PIL import ImageDraw
        mask = Image.new("L", out.size, 0)
        md = ImageDraw.Draw(mask)
        md.polygon([(p[0], p[1]) for p in pts], fill=255)
        out.putalpha(mask)

    buf = io.BytesIO()
    out.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")


@app.post("/api/removebg")
async def removebg_proxy(
    file: UploadFile = File(...),
    bbox: Optional[str] = Form(None, description="圈选框 x,y,w,h（先裁再转发）"),
    path: Optional[str] = Form(None, description="用户轨迹 x1,y1;...（bbox 相对坐标），path 外抹透明后再转发"),
):
    """removebg 代理：绕过浏览器 CORS，可选先按 bbox 裁剪 + path 外抹透明再转发。"""
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")

    payload = data
    try:
        im = Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception as e:
        raise HTTPException(400, f"bad image: {e}")

    box = parse_bbox(bbox)
    if box:
        im = im.crop(box)

    # 先保存完整图片（不抹 path，让 remove.bg 看到完整上下文做前景/背景分割）
    buf0 = io.BytesIO()
    im.save(buf0, format="PNG")
    payload = buf0.getvalue()

    boundary = "----dreamhomeBoundary7ma4m"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="image_file"; filename="frame.png"\r\n'
        "Content-Type: image/png\r\n\r\n"
    ).encode() + payload + (
        f"\r\n--{boundary}\r\n"
        'Content-Disposition: form-data; name="size"\r\n\r\n'
        "auto\r\n"
        f"--{boundary}--\r\n"
    ).encode()

    req = urllib.request.Request(
        REMOVEBG_URL,
        data=body,
        headers={
            "X-Api-Key": REMOVEBG_API_KEY,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
            out_bytes = resp.read()
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        return JSONResponse(
            status_code=e.code,
            content={"error": f"remove.bg HTTP {e.code}", "detail": err_body[:500]},
        )
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})

    # remove.bg 返回后，应用 path mask：只保留 path 内区域
    pts = parse_path(path)
    if pts:
        try:
            out_im = Image.open(io.BytesIO(out_bytes)).convert("RGBA")
            from PIL import ImageDraw
            mask = Image.new("L", out_im.size, 0)
            md = ImageDraw.Draw(mask)
            md.polygon([(p[0], p[1]) for p in pts], fill=255)
            out_im.putalpha(mask)
            buf_out = io.BytesIO()
            out_im.save(buf_out, format="PNG")
            out_bytes = buf_out.getvalue()
        except Exception:
            pass

    return StreamingResponse(io.BytesIO(out_bytes), media_type="image/png")


import json
import base64

# V8：单输入方案——提取完整家具，中性光输出，颜色保真供3D贴图用，去除标记线干扰
INPAINT_SYSTEM_PROMPT = (
    "你正在处理一段家居视频中的一帧截图。用户用一条几乎不可见的浅灰色虚线圈出了一件目标家具。"
    "这条灰色虚线是用户的操作提示，不是家具本身的一部分，请完全忽略它，不要把它画到输出图中。"
    ""
    "请按以下要求处理："
    "1. 提取曲线圈出的家具作为主体，去掉所有背景以及其他遮挡该家具的物体。"
    "2. 基于家具的物理结构，补全被遮挡的缺失部分（如底座、腿、扶手等），使家具形态完整。"
    "3. 补全部分的形状、结构、比例必须与可见部分精确衔接，符合该类家具的正常物理形态。"
    "4. 不要改变家具可见部分的外形、比例和颜色，只补全被遮挡的缺失区域。"
    "5. 最终输出统一为中性漫射光（flat lighting）：不要保留任何方向性阴影、环境光反射或高光。"
    "   但颜色、材质、纹理必须和原图可见部分完全一致——这是最重要的约束，因为后续用于3D贴图，颜色偏差会导致3D模型颜色错误。"
    "6. 只输出这件家具本身，不输出任何背景、阴影、其他物体或标记线。"
    "7. 最终输出透明背景。"
)

DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
# 旧域名仍可用，无需 workspace ID；有 workspace ID 时用专属域名更稳
DASHSCOPE_WORKSPACE_ID = os.environ.get("DASHSCOPE_WORKSPACE_ID", "")
if DASHSCOPE_WORKSPACE_ID:
    DASHSCOPE_INPAINT_URL = (
        f"https://{DASHSCOPE_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com"
        "/api/v1/services/aigc/multimodal-generation/generation"
    )
else:
    DASHSCOPE_INPAINT_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"


def parse_path(path_str: Optional[str]) -> Optional[list]:
    """解析前端传来的 path：'x1,y1;x2,y2;...'（bbox 相对坐标）→ [(x,y),...]"""
    if not path_str:
        return None
    try:
        pts = []
        for seg in path_str.split(";"):
            x, y = seg.split(",")
            pts.append((int(x), int(y)))
        return pts if len(pts) > 2 else None
    except Exception:
        return None


def bake_path_onto_image(im: Image.Image, pts: Optional[list]) -> Image.Image:
    """把 path 以极淡灰色虚线叠到原图，降低对模型的视觉干扰。"""
    if not pts:
        return im
    from PIL import ImageDraw
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    poly = [(p[0], p[1]) for p in pts]
    # 极淡灰色虚线，几乎不可见，只作为位置提示
    draw.polygon(poly, fill=None, outline=(128, 128, 128, 30), width=2)
    out = Image.alpha_composite(im.convert("RGBA"), overlay)
    return out



# ---- 融合补丁(pipeline 离线量产接入,by Claude):品类约束 + 无轨迹 prompt 变体 ----
# 离线 pipeline 的抠图没有用户圈选轨迹;原 prompt 提到"浅灰色虚线"会诱发模型把虚线画进输出。
INPAINT_PROMPT_NO_PATH = (
    "你正在处理一段家居视频中的一帧截图,画面主体是一件家具。"
    ""
    "请按以下要求处理:"
    "1. 提取画面中的主体家具,去掉所有背景以及其他遮挡该家具的物体。"
    "2. 基于家具的物理结构,补全被遮挡的缺失部分(如底座、腿、扶手等),使家具形态完整。"
    "3. 补全部分的形状、结构、比例必须与可见部分精确衔接,符合该类家具的正常物理形态。"
    "4. 不要改变家具可见部分的外形、比例和颜色,只补全被遮挡的缺失区域。"
    "5. 最终输出统一为中性漫射光(flat lighting):不要保留任何方向性阴影、环境光反射或高光。"
    "   但颜色、材质、纹理必须和原图可见部分完全一致——这是最重要的约束,因为后续用于3D贴图。"
    "6. 只输出这件家具本身,不输出任何背景、阴影、其他物体、虚线或标记。"
    "   家具台面/表面上的摆件(台灯、餐具、书本、花瓶、装饰品等)不属于家具本身,必须全部去除。"
    "7. 如果画面里根本没有一件完整可辨认的家具主体,不要凭空编造一件——尽量忠实还原可见部分。"
    "8. 最终输出透明背景。"
)


@app.post("/api/inpaint")
async def inpaint(
    file: UploadFile = File(..., description="带场景的 bbox 原图截图"),
    bbox: Optional[str] = Form(None, description="圈选外接框 x,y,w,h"),
    path: Optional[str] = Form(None, description="用户轨迹 x1,y1;x2,y2;...（bbox 相对坐标）"),
    category: Optional[str] = Form(None, description="家具品类提示(融合补丁,来自检测,如'床')"),
    model: Optional[str] = Form(None, description="模型覆盖(融合补丁): wan2.7-image-pro(默认)|wan2.7-image"),
):
    """2D 实体家具提取：单输入，从视频帧直接提取完整家具，去背景+去遮挡+补全缺失。"""
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    try:
        im = Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception as e:
        raise HTTPException(400, f"bad image: {e}")

    # 无 key：mock 原样返回，便于前端跑通 pipeline
    if not DASHSCOPE_API_KEY:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        buf.seek(0)
        return StreamingResponse(buf, media_type="image/png")

    pts = parse_path(path)

    # 把 path 高亮叠到原图上，作为视觉提示
    im_with_path = bake_path_onto_image(im, pts)

    # wan2.7 要求最小分辨率 240x240，不够则放大
    if im_with_path.width < 240 or im_with_path.height < 240:
        scale = max(240 / im_with_path.width, 240 / im_with_path.height)
        new_w = max(int(im_with_path.width * scale), 240)
        new_h = max(int(im_with_path.height * scale), 240)
        im_with_path = im_with_path.resize((new_w, new_h), Image.LANCZOS)

    # base64 编码原图（叠了 path 高亮）
    buf = io.BytesIO()
    im_with_path.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    image_data_url = f"data:image/png;base64,{b64}"

    prompt = INPAINT_SYSTEM_PROMPT if pts else INPAINT_PROMPT_NO_PATH
    if category:
        prompt = (f"目标家具的品类是「{category}」,输出必须仍然是一件「{category}」,"
                  f"不得变成其他种类的家具。") + prompt
    content = [{"image": image_data_url}, {"text": prompt}]

    # 不指定精确编辑区域，让模型按 prompt+path 编辑整个传入图
    bbox_list = [[]]

    payload = {
        "model": model or "wan2.7-image-pro",
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": content,
                }
            ]
        },
        "parameters": (
            {"size": "1K", "n": 1, "watermark": False, "bbox_list": bbox_list}
            if (model or "wan2.7-image-pro").startswith("wan")
            else {"n": 1, "watermark": False}
        ),
    }

    _direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(
        DASHSCOPE_INPAINT_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    t0 = time.time()
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        _opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ctx))
        with _opener.open(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        log_usage(model or "wan2.7-image-pro", False, time.time() - t0, f"HTTP {e.code}: {err_body[:200]}")
        return JSONResponse(
            status_code=e.code,
            content={"error": f"dashscope HTTP {e.code}", "detail": err_body[:800]},
        )
    except Exception as e:
        log_usage(model or "wan2.7-image-pro", False, time.time() - t0, str(e)[:200])
        return JSONResponse(status_code=502, content={"error": str(e)})

    # 解析返回：output.choices[0].message.content[0].image 可能是 url 或 base64
    try:
        content = result["output"]["choices"][0]["message"]["content"]
        img_ref = None
        for item in content:
            if "image" in item:
                img_ref = item["image"]
                break
        if not img_ref:
            log_usage(model or "wan2.7-image-pro", False, time.time() - t0, "no image in response")
            return JSONResponse(status_code=502, content={"error": "no image in response", "raw": result})

        if img_ref.startswith("http"):
            # 下载结果图
            with urllib.request.build_opener(
                    urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ctx)
                    ).open(img_ref, timeout=60) as r:
                out_bytes = r.read()
        elif img_ref.startswith("data:"):
            out_bytes = base64.b64decode(img_ref.split(",", 1)[1])
        else:
            log_usage(model or "wan2.7-image-pro", False, time.time() - t0, "unknown image ref")
            return JSONResponse(status_code=502, content={"error": "unknown image ref", "ref": img_ref[:200]})

        log_usage(model or "wan2.7-image-pro", True, time.time() - t0)
        return StreamingResponse(io.BytesIO(out_bytes), media_type="image/png")
    except Exception as e:
        log_usage(model or "wan2.7-image-pro", False, time.time() - t0, f"parse failed: {e}")
        return JSONResponse(status_code=502, content={"error": f"parse failed: {e}", "raw": result})


@app.get("/api/stats")
def stats():
    """成本统计：从 usage.jsonl 汇总调用次数、成功率、预估费用。"""
    if not os.path.exists(USAGE_LOG):
        return {"calls": [], "summary": {"total": 0, "ok": 0, "failed": 0, "cost": 0.0}}
    calls = []
    with open(USAGE_LOG, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    calls.append(json.loads(line))
                except Exception:
                    pass
    total = len(calls)
    ok = sum(1 for c in calls if c.get("ok"))
    failed = total - ok
    cost = sum(c.get("price", 0.0) for c in calls if c.get("ok"))
    return {
        "calls": calls[-50:],  # 最近 50 条
        "summary": {"total": total, "ok": ok, "failed": failed, "cost": round(cost, 2)},
    }


# === Trace 持久化：图片存文件系统，不受 localStorage 5MB 限制 ===
TRACES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "traces")
os.makedirs(TRACES_DIR, exist_ok=True)


@app.post("/api/save_trace")
async def save_trace_endpoint(
    trace_id: str = Form(...),
    label: str = Form("未知"),
    ts: int = Form(0),
    status: str = Form("done"),
    bbox_img: Optional[UploadFile] = File(None),
    inpaint_img: Optional[UploadFile] = File(None),
    final_img: Optional[UploadFile] = File(None),
):
    """保存一条 trace 的图片到文件系统，元数据写 meta.json。"""
    trace_dir = os.path.join(TRACES_DIR, trace_id)
    os.makedirs(trace_dir, exist_ok=True)
    meta = {
        "id": trace_id,
        "label": label,
        "ts": ts,
        "status": status,
        "has_bbox": False,
        "has_inpaint": False,
        "has_final": False,
    }
    if bbox_img:
        data = await bbox_img.read()
        if data:
            with open(os.path.join(trace_dir, "bbox.png"), "wb") as f:
                f.write(data)
            meta["has_bbox"] = True
    if inpaint_img:
        data = await inpaint_img.read()
        if data:
            with open(os.path.join(trace_dir, "inpaint.png"), "wb") as f:
                f.write(data)
            meta["has_inpaint"] = True
    if final_img:
        data = await final_img.read()
        if data:
            with open(os.path.join(trace_dir, "final.png"), "wb") as f:
                f.write(data)
            meta["has_final"] = True
    with open(os.path.join(trace_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    return {"status": "ok", "id": trace_id}


@app.get("/api/traces")
def list_traces():
    """返回所有历史 trace 的元数据列表，按时间倒序。"""
    traces = []
    if not os.path.exists(TRACES_DIR):
        return {"traces": []}
    for tid in os.listdir(TRACES_DIR):
        meta_path = os.path.join(TRACES_DIR, tid, "meta.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    traces.append(json.load(f))
            except Exception:
                pass
    traces.sort(key=lambda t: t.get("ts", 0), reverse=True)
    return {"traces": traces}


@app.get("/api/traces/{trace_id}/image")
def get_trace_image(trace_id: str, type: str = "final"):
    """返回 trace 的指定图片：bbox / inpaint / final。"""
    img_path = os.path.join(TRACES_DIR, trace_id, f"{type}.png")
    if not os.path.exists(img_path):
        raise HTTPException(404, f"{type} image not found")
    with open(img_path, "rb") as f:
        return StreamingResponse(f, media_type="image/png")


@app.delete("/api/traces")
def clear_traces():
    """清空所有 trace。"""
    import shutil
    if os.path.exists(TRACES_DIR):
        shutil.rmtree(TRACES_DIR)
        os.makedirs(TRACES_DIR, exist_ok=True)
    return {"status": "ok"}
