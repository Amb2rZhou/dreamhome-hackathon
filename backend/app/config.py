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
    # TRELLIS often bakes scene shadows into the base-color texture.  Keep the
    # correction explicit and versionable so generated assets are not silently
    # delivered with the raw, overly-dark material.
    TRELLIS_ALBEDO_GAMMA: float = float(_env("TRELLIS_ALBEDO_GAMMA", "0.7"))

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
    # TRELLIS may run behind the general GPU API or as a dedicated local
    # worker. Keeping its URL separate avoids sending large completed images
    # through the detection proxy on the all-in-one ECS deployment.
    GEN3D_REMOTE_URL: str = _env("GEN3D_REMOTE_URL", "") or REMOTE_GPU_URL
    # 打标签 provider: mock | anthropic | dashscope
    LABELS_PROVIDER: str = _env("LABELS_PROVIDER", "mock").lower()
    DASHSCOPE_API_KEY: str = _env("DASHSCOPE_API_KEY")
    DASHSCOPE_VL_MODEL: str = _env("DASHSCOPE_VL_MODEL", "qwen-vl-max")
    # 抠图补全(队友模块,契约见 docs/enhance-integration.md): off | module | cmd
    ENHANCE_PROVIDER: str = _env("ENHANCE_PROVIDER", "off").lower()
    ENHANCE_CMD: str = _env("ENHANCE_CMD", "")

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
        if self.GEN3D_PROVIDER == "selfhost" and self.GEN3D_REMOTE_URL:
            return "selfhost"
        if self.GEN3D_PROVIDER == "fal" and self.FAL_KEY:
            return "fal"
        if self.GEN3D_PROVIDER == "tripo" and self.TRIPO_API_KEY:
            return "tripo"
        if self.GEN3D_PROVIDER == "meshy" and self.MESHY_API_KEY:
            return "meshy"
        return "mock"

    def consumer_capabilities(self) -> dict:
        """Return secret-free configured readiness for the consumer pipeline."""
        detect_provider = self.effective_detect_provider
        labels_provider = self.effective_labels_provider
        gen3d_provider = self.effective_provider
        completion_ready = self.ENHANCE_PROVIDER in {"module", "cmd"}
        consistency_ready = bool(self.DASHSCOPE_API_KEY)
        trellis_ready = gen3d_provider in {"fal", "selfhost"}
        capabilities = {
            "detect": {"provider": detect_provider, "ready": detect_provider != "mock"},
            "completion": {
                "provider": self.ENHANCE_PROVIDER,
                "ready": completion_ready,
            },
            "labels": {"provider": labels_provider, "ready": labels_provider != "mock"},
            "single_object_check": {
                "provider": "dashscope" if consistency_ready else "off",
                "ready": consistency_ready,
            },
            "identity_check": {
                "provider": "dashscope" if consistency_ready else "off",
                "ready": consistency_ready,
            },
            "gen3d": {
                "provider": gen3d_provider,
                "model_family": "trellis" if trellis_ready else "unsupported",
                "ready": trellis_ready,
            },
            "material_postprocess": {
                "ready": 0 < self.TRELLIS_ALBEDO_GAMMA <= 1,
                "albedo_gamma": self.TRELLIS_ALBEDO_GAMMA,
            },
            "identity": {"mode": "local_demo", "authenticated": False},
        }
        capabilities["consumer_pipeline_ready"] = all(
            state.get("ready", True)
            for name, state in capabilities.items()
            if name != "identity"
        )
        return capabilities


settings = Settings()
