"""全局配置：读环境变量，缺 key 时自动退化到 mock，保证监管机/无网也能跑通链路。"""
import os


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


class Settings:
    # 3D 生成 provider：tripo | meshy | mock（缺 key 时强制 mock）
    GEN3D_PROVIDER: str = _env("GEN3D_PROVIDER", "mock").lower()

    TRIPO_API_KEY: str = _env("TRIPO_API_KEY")
    TRIPO_BASE_URL: str = _env("TRIPO_BASE_URL", "https://api.tripo3d.ai/v2/openapi")

    MESHY_API_KEY: str = _env("MESHY_API_KEY")
    MESHY_BASE_URL: str = _env("MESHY_BASE_URL", "https://api.meshy.ai/openapi/v1")

    # 语音编辑意图解析用的 LLM（缺 key 退化到关键词规则）
    ANTHROPIC_API_KEY: str = _env("ANTHROPIC_API_KEY")
    ANTHROPIC_MODEL: str = _env("ANTHROPIC_MODEL", "claude-opus-4-8")

    # 上传文件落地目录（demo 用本地磁盘；生产换对象存储）
    STORAGE_DIR: str = _env("STORAGE_DIR", os.path.join(os.path.dirname(__file__), "..", "storage"))
    # 对外可访问的基址，用于拼 model_url（部署到 Vercel/服务器时改成公网域名）
    PUBLIC_BASE_URL: str = _env("PUBLIC_BASE_URL", "http://localhost:8000")

    @property
    def effective_provider(self) -> str:
        """有 key 才用真 provider，否则一律 mock，避免线上 500。"""
        if self.GEN3D_PROVIDER == "tripo" and self.TRIPO_API_KEY:
            return "tripo"
        if self.GEN3D_PROVIDER == "meshy" and self.MESHY_API_KEY:
            return "meshy"
        return "mock"


settings = Settings()
