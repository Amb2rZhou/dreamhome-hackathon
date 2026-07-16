"""3D 生成 provider 抽象。三个原子能力(视频/拍照/画画)都经这层，换供应商只改这里。"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Gen3DResult:
    status: str                          # queued | running | succeeded | failed
    progress: int = 0                    # 0-100
    model_url: Optional[str] = None      # GLB
    thumbnail_url: Optional[str] = None
    error: Optional[str] = None
    raw: dict = field(default_factory=dict)


class Gen3DProvider(ABC):
    """单张图片 → 带贴图 GLB。异步：submit 拿 job_id，poll 查进度。"""
    name: str = "base"

    @abstractmethod
    async def submit(self, image_path: str, *, texture: bool = True, prompt: str = "",
                     extra_image_paths: list[str] | None = None) -> str:
        # extra_image_paths: 同一物体的其他角度图(可选);只有 selfhost(TRELLIS多视角)支持,其余忽略
        """提交一张本地图片，返回 provider 侧任务 id。"""
        raise NotImplementedError

    @abstractmethod
    async def poll(self, provider_job_id: str) -> Gen3DResult:
        """查询任务状态。"""
        raise NotImplementedError
