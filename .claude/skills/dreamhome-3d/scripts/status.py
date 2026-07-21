#!/usr/bin/env python3
"""DreamHome 服务体检:调用 3D 生成能力前先跑这个,谁没就绪报谁。

用法: python3 .claude/skills/dreamhome-3d/scripts/status.py
退出码: 0=全部就绪; 1=有依赖未就绪(看输出提示)
"""
import os
import socket
import sys
import urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
ENV_PATH = os.path.join(REPO, "backend", ".env")


def load_env(path: str) -> dict:
    env = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def http_ok(url: str, timeout: float = 4) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def port_open(host: str, port: int, timeout: float = 2) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def main() -> int:
    env = load_env(ENV_PATH)
    ok = True

    if http_ok("http://127.0.0.1:8000/api/health"):
        print("✓ 后端 API (:8000) 正常")
    else:
        ok = False
        print("✗ 后端 API (:8000) 未启动 → cd backend && ./.venv/bin/uvicorn app.main:app --port 8000")

    if port_open("127.0.0.1", 8002):
        print("✓ 补全服务 segment_api (:8002) 正常")
    else:
        ok = False
        print("✗ 补全服务 (:8002) 未启动 → cd backend && ./.venv/bin/uvicorn segment_api:app --port 8002")

    gpu = env.get("REMOTE_GPU_URL", "")
    if gpu and http_ok(f"{gpu}/health", timeout=5):
        print(f"✓ GPU 服务器 ({gpu}) 正常 (TRELLIS 3D 生成可用)")
    else:
        ok = False
        print("✗ GPU 服务器未开机 —— 这是**按量计费**的云 GPU 实例,为控制成本平时默认关机。")
        print("  需要 3D 生成时请联系部署方(Boss)开机;开机后公网 IP 可能变化,")
        print("  需同步更新 backend/.env 里的 REMOTE_GPU_URL / DETECT 相关地址。")
        print("  (没有 GPU 时:标注/审核/场景编辑等功能不受影响,只有 3D 生成和视频检测不可用)")

    if env.get("DASHSCOPE_API_KEY"):
        print("✓ DASHSCOPE_API_KEY 已配置 (打标签/质检闸可用)")
    else:
        ok = False
        print("✗ backend/.env 缺 DASHSCOPE_API_KEY (打标签与质量闸需要,向部署方索取)")

    print("\n体检结果:", "全部就绪 ✓" if ok else "有依赖未就绪,见上方 ✗ 项")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
