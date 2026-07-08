"""DreamHome 后端入口。

三个原子能力 + 语音编辑 + 任务查询，全部挂在这里。
storage 目录静态托管，供前端直接取中间产物/结果。
本地运行：  uvicorn app.main:app --reload --port 8000
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routers import video, photo, sketch, voice, jobs

app = FastAPI(
    title="DreamHome API",
    description="家的灵感摘抄本：视频/拍照/画画 → 3D 家居组件",
    version="0.1.0",
)

# demo 阶段放开跨域；上线按域名收紧
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(video.router)
app.include_router(photo.router)
app.include_router(sketch.router)
app.include_router(voice.router)
app.include_router(jobs.router)


@app.get("/api/health", tags=["health"])
async def health():
    return {"status": "ok", "provider": settings.effective_provider}


# 静态托管上传/中间产物/结果，路径与 config.STORAGE_DIR 对应
_storage = os.path.abspath(settings.STORAGE_DIR)
os.makedirs(_storage, exist_ok=True)
app.mount("/storage", StaticFiles(directory=_storage), name="storage")
