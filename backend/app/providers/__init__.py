"""按配置选出当前 provider。缺 key 自动 mock，前端无感知。"""
from functools import lru_cache
from .base import Gen3DProvider, Gen3DResult
from .mock import MockProvider
from ..config import settings


@lru_cache(maxsize=1)
def get_provider() -> Gen3DProvider:
    p = settings.effective_provider
    if p == "selfhost":
        from .selfhost import SelfhostTrellisProvider
        return SelfhostTrellisProvider()
    if p == "fal":
        from .fal import FalTrellisProvider
        return FalTrellisProvider()
    if p == "tripo":
        from .tripo import TripoProvider
        return TripoProvider()
    if p == "meshy":
        from .meshy import MeshyProvider
        return MeshyProvider()
    return MockProvider()


__all__ = ["Gen3DProvider", "Gen3DResult", "get_provider"]
