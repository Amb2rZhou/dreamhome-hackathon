#!/bin/bash
# GPU 云服务器初始化(阿里云 A10 / 4090 等,选型见 docs/cost-evaluation.md)。
#
# TRELLIS 环境不要手工编译(spconv/flash-attn/kaolin 版本地狱),推荐两条路:
#   路线1(推荐): 用社区 Docker 镜像跑 TRELLIS,本服务(检测/embedding)裸机跑
#     docker pull cassidybridges/trellis-box           # Streamlit UI 版
#     或 https://github.com/UNES97/TRELLIS-3D-API      # FastAPI 版,接口改 server.py 里的调用即可
#     权重 ~5GB 挂数据盘: -v /data/hf_cache:/root/.cache/huggingface
#   路线2: 在 TRELLIS 官方镜像/环境内直接跑本 server.py(import trellis 可用时 /gen3d 生效)
set -e

PIP="pip install -i https://pypi.tuna.tsinghua.edu.cn/simple"

# 国内机必须走 HF 镜像,否则权重下载卡死(比赛/评委都在境内,GPU 机选国内区)
export HF_ENDPOINT=https://hf-mirror.com
grep -q HF_ENDPOINT ~/.bashrc || echo 'export HF_ENDPOINT=https://hf-mirror.com' >> ~/.bashrc

python -c "import torch" 2>/dev/null || $PIP torch --index-url https://download.pytorch.org/whl/cu121
$PIP fastapi "uvicorn[standard]" pillow transformers accelerate timm

# 预下载检测/embedding 模型权重
python - <<'EOF'
from transformers import pipeline, CLIPModel, CLIPProcessor
pipeline("zero-shot-object-detection", model="IDEA-Research/grounding-dino-base")
CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
print("models cached")
EOF

echo "done. 启动: python server.py  (0.0.0.0:9000,安全组放行;上机先按量试 1 小时实测 TRELLIS 耗时)"
