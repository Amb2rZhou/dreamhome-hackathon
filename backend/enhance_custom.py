"""补全模块适配器:pipeline 卡槽 → 队友的 segment_api /api/inpaint(wan2.7-image-pro)。

她的服务单独跑在 8002 端口(uvicorn segment_api:app --port 8002),
本适配器把残缺抠图 POST 过去,拿回"去背景+补全+中性光"的透明 PNG。
启用: .env 里 ENHANCE_PROVIDER=module
"""
import os

import httpx

SEGMENT_API = os.environ.get("SEGMENT_API_URL", "http://localhost:8002")


def enhance(in_path: str, out_path: str, category: str = "") -> None:
    with open(in_path, "rb") as f:
        files = {"file": (os.path.basename(in_path), f, "image/jpeg")}
        data = {"category": category} if category else {}
        r = httpx.post(f"{SEGMENT_API}/api/inpaint", files=files, data=data,
                       timeout=150, trust_env=False)
    r.raise_for_status()
    if not r.headers.get("content-type", "").startswith("image/"):
        raise RuntimeError(f"inpaint 返回非图片: {r.text[:200]}")
    with open(out_path, "wb") as f:
        f.write(r.content)
