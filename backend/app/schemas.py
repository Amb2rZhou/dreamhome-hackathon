"""对外数据结构：三个原子能力和语音编辑共用一套 Job 模型。"""
from enum import Enum
from typing import Optional, List, Literal
from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    queued = "queued"       # 已受理，排队中
    running = "running"     # 生成中
    succeeded = "succeeded"
    failed = "failed"


class Job(BaseModel):
    """一次 3D 生成任务的统一视图，前端只认这个结构。"""
    job_id: str
    kind: Literal["video", "photo", "sketch"]
    status: JobStatus
    progress: int = 0                       # 0-100
    model_url: Optional[str] = None         # 生成的 GLB
    thumbnail_url: Optional[str] = None
    # 摘抄卡片信息（多模态识别产出，用于素材库展示 + 尺度先验）
    category: Optional[str] = None          # 品类，如 "布艺沙发"
    style: Optional[str] = None             # 风格
    material: Optional[str] = None
    estimated_size_m: Optional[List[float]] = None  # [长,宽,高] 估计米
    error: Optional[str] = None
    provider: Optional[str] = None
    provider_job_id: Optional[str] = None
    # 完整资产生产任务的附加状态；原子 photo/video/sketch job 保持兼容。
    asset_id: Optional[str] = None
    track_id: Optional[str] = None
    stage: Optional[str] = None
    quality_mode: Optional[Literal["fast", "production"]] = None
    library_attached: bool = False
    queue_position: int = 0
    queue_depth: int = 0


class SubmitResponse(BaseModel):
    job_id: str
    status: JobStatus


# ---- 语音编辑 ----

class EditCommand(BaseModel):
    """语音/文字解析后的结构化编辑指令，交给前端编辑器执行。"""
    action: Literal["move", "rotate", "scale", "replace", "select", "delete", "unknown"]
    target: Optional[str] = None            # 物体标识，如 "sofa" / "上一个"
    # move: 相对/绝对位置；rotate: 角度；scale: 比例；replace: 新品类
    value: Optional[str] = None
    params: dict = Field(default_factory=dict)
    transcript: str = ""                    # 识别出的原始语音文本
    confidence: float = 0.0
