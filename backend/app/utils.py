"""上传落盘小工具。demo 用本地磁盘；生产换对象存储(OSS/S3)。"""
import os
import uuid
from fastapi import UploadFile
from .config import settings


def _ensure_dir() -> str:
    d = os.path.abspath(settings.STORAGE_DIR)
    os.makedirs(d, exist_ok=True)
    return d


async def save_upload(file: UploadFile, prefix: str) -> str:
    """把上传文件存到 storage，返回本地绝对路径。"""
    d = _ensure_dir()
    ext = os.path.splitext(file.filename or "")[1] or ".bin"
    path = os.path.join(d, f"{prefix}-{uuid.uuid4().hex}{ext}")
    with open(path, "wb") as out:
        while chunk := await file.read(1 << 20):  # 1MB 分块
            out.write(chunk)
    return path


def workpath(prefix: str, ext: str = ".png") -> str:
    """给中间产物(抽帧/抠图/洗草图)分配一个落地路径。"""
    d = _ensure_dir()
    return os.path.join(d, f"{prefix}-{uuid.uuid4().hex}{ext}")
