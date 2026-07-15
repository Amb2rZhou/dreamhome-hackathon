"""全局配置：读 .env / 环境变量，缺 key 时自动退化到 mock。"""
import os


def _load_dotenv() -> None:
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


class Settings:
    # 3D 生成 provider：fal | tripo | meshy | mock（缺 key 时强制 mock）
    GEN3D_PROVIDER: str = _env("GEN3D_PROVIDER", "mock").lower()

    FAL_KEY: str = _env("FAL_KEY")
    FAL_TRELLIS_ENDPOINT: str = _env("FAL_TRELLIS_ENDPOINT", "fal-ai/trellis")

    TRIPO_API_KEY: str = _env("TRIPO_API_KEY")
    TRIPO_BASE_URL: str = _env("TRIPO_BASE_URL", "https://api.tripo3d.ai/v2/openapi")

    MESHY_API_KEY: str = _env("MESHY_API_KEY")
    MESHY_BASE_URL: str = _env("MESHY_BASE_URL", "https://api.meshy.ai/openapi/v1")

    # 语音编辑意图解析用的 LLM（缺 key 退化到关键词规则）
    ANTHROPIC_API_KEY: str = _env("ANTHROPIC_API_KEY")
    ANTHROPIC_MODEL: str = _env("ANTHROPIC_MODEL", "claude-opus-4-8")

    # ---- 资产库(asset-library-plan.md) ----
    # SQLite 库文件；默认放 storage 同级
    DB_PATH: str = _env("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "storage", "dreamhome.db"))
    # 实时单帧检测 provider: mock | remote(自部署 GPU 推理服务)
    DETECT_PROVIDER: str = _env("DETECT_PROVIDER", "mock").lower()
    # AutoDL/RunPod 上 gpu/server.py 的地址，如 http://x.x.x.x:9000
    REMOTE_GPU_URL: str = _env("REMOTE_GPU_URL", "")
    # 打标签 provider: mock | anthropic | dashscope
    LABELS_PROVIDER: str = _env("LABELS_PROVIDER", "mock").lower()
    DASHSCOPE_API_KEY: str = _env("DASHSCOPE_API_KEY")
    DASHSCOPE_VL_MODEL: str = _env("DASHSCOPE_VL_MODEL", "qwen-vl-max")

    # 上传文件落地目录（demo 用本地磁盘；生产换对象存储）
    STORAGE_DIR: str = _env("STORAGE_DIR", os.path.join(os.path.dirname(__file__), "..", "storage"))
    # 对外可访问的基址，用于拼 model_url（部署到 Vercel/服务器时改成公网域名）
    PUBLIC_BASE_URL: str = _env("PUBLIC_BASE_URL", "http://localhost:8000")

    @property
    def effective_detect_provider(self) -> str:
        """有远端 GPU 地址才走 remote，否则 mock。"""
        if self.DETECT_PROVIDER == "remote" and self.REMOTE_GPU_URL:
            return "remote"
        return "mock"

    @property
    def effective_labels_provider(self) -> str:
        if self.LABELS_PROVIDER == "anthropic" and self.ANTHROPIC_API_KEY:
            return "anthropic"
        if self.LABELS_PROVIDER == "dashscope" and self.DASHSCOPE_API_KEY:
            return "dashscope"
        return "mock"

    @property
    def effective_provider(self) -> str:
        """有 key 才用真 provider，否则一律 mock，避免线上 500。"""
        if self.GEN3D_PROVIDER == "fal" and self.FAL_KEY:
            return "fal"
        if self.GEN3D_PROVIDER == "tripo" and self.TRIPO_API_KEY:
            return "tripo"
        if self.GEN3D_PROVIDER == "meshy" and self.MESHY_API_KEY:
            return "meshy"
        return "mock"


settings = Settings()
