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
from .services.selection_production import production_readiness
from .routers import video, photo, sketch, voice, jobs, assets, videos, library, tracks_fix, annotations, agent, scenes, review_qc, frame_assets, libraries, home_projects

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
# 资产库(docs/asset-library-plan.md)
app.include_router(assets.router)
app.include_router(videos.router)
app.include_router(library.router)
# 轨迹手动矫正(配套 /review/fix.html 工作台)
app.include_router(tracks_fix.router)
app.include_router(review_qc.router)
# 视频对照标注(配套 /review/rebuild.html,圈缺失物品)
app.include_router(annotations.router)
# 反馈→后台 Claude Code 会话(配套 /review/rebuild.html 视频旁工作流面板)
app.include_router(agent.router)
# 场景资产(每视频一份重建布局,rebuild.html ?v= 加载/保存)
app.include_router(scenes.router)
# 帧级资产识别+圈选对比(T1/T2,配套 rebuild.html 绿框叠加层)
app.include_router(frame_assets.router)
# 专项资产库(窗户/吊顶/地板/光线/窗外景观,T6)
app.include_router(libraries.router)
app.include_router(home_projects.router)


@app.get("/api/health", tags=["health"])
async def health():
    return {
        "status": "ok",
        "provider": settings.effective_provider,
        "capabilities": {"feed_selection_production": production_readiness()},
    }


# 静态托管上传/中间产物/结果，路径与 config.STORAGE_DIR 对应
_storage = os.path.abspath(settings.STORAGE_DIR)
os.makedirs(_storage, exist_ok=True)
app.mount("/storage", StaticFiles(directory=_storage), name="storage")

# 资产审核页(T7):浏览器开 /review
_review = os.path.join(os.path.dirname(__file__), "..", "review")
app.mount("/review", StaticFiles(directory=os.path.abspath(_review), html=True), name="review")

# 内置占位 GLB(mock/种子数据用)。评委在国内,一切静态资源必须本机/国内源出,
# 不能指向 raw.githubusercontent 等境外地址。
_samples = os.path.join(os.path.dirname(__file__), "..", "samples")
os.makedirs(os.path.abspath(_samples), exist_ok=True)
app.mount("/samples", StaticFiles(directory=os.path.abspath(_samples)), name="samples")
