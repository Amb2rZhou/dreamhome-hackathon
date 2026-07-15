#!/bin/bash
# AutoDL/RunPod GPU 机初始化。AutoDL 镜像自带 conda+torch 时 torch 行可跳过。
set -e

PIP="pip install -i https://pypi.tuna.tsinghua.edu.cn/simple"

python -c "import torch" 2>/dev/null || $PIP torch --index-url https://download.pytorch.org/whl/cu121
$PIP fastapi "uvicorn[standard]" pillow transformers accelerate timm

# 预下载模型权重(AutoDL 建议先 source /etc/network_turbo 开学术加速)
python - <<'EOF'
from transformers import pipeline, CLIPModel, CLIPProcessor
pipeline("zero-shot-object-detection", model="IDEA-Research/grounding-dino-base")
CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
print("models cached")
EOF

echo "done. 启动: python server.py  (端口 9000, AutoDL 用自定义服务映射出来)"
