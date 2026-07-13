# GPU 自建服务(SAM2 抠图 + 视频追踪)

在阿里云 **gn7i(A10 24G)** 机上跑。ASR 已外包给云 API(讯飞/阿里 NLS),不在此。
TRELLIS 图生3D 待补(见文末)。

前提:购买实例时勾了「安装 GPU 驱动」,`nvidia-smi` 能看到 A10 + CUDA 12.x。

---

## 一、SAM2 抠图服务(step 4,先跑这个)

抠图:交互框选家具 → 干净白底图 → 直接喂 TRELLIS。

### 1. 装环境(在网页 Workbench 终端里逐条粘)
```bash
apt update && apt install -y python3-pip python3-venv git libgl1
pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/   # 阿里内网源,飞快
python3 -m venv ~/venv && source ~/venv/bin/activate

# 拉本仓库(或 git pull 更新)
git clone https://github.com/Amb2rZhou/dreamhome-hackathon.git
cd dreamhome-hackathon/backend/gpu

pip install -r requirements.txt
python -c "import torch; print('CUDA 可用:', torch.cuda.is_available())"   # 必须 True
```
> ❗ 如果上面打印 `False`(torch 被装成 CPU 版):
> ```bash
> pip uninstall -y torch torchvision
> pip install torch torchvision --index-url https://mirrors.aliyun.com/pytorch-wheels/cu121
> ```

### 2. 起服务(首次自动下载 SAM2 权重 ~150MB)
```bash
python -m uvicorn sam2_cutout_server:app --host 0.0.0.0 --port 8000
```
看到 `Uvicorn running on http://0.0.0.0:8000` 即成功。
> 权重从 GitHub 下,若大陆太慢:开 `source /etc/network_turbo`(若有)或手动下 `sam2.1_b.pt` 放到
> ultralytics 缓存目录;实在不行换 ModelScope 的 SAM2 镜像。

### 3. 测(从你笔记本 / 另一个终端)
```bash
curl http://<公网IP>:8000/health
# {"ok":true,"model":"sam2.1_b.pt"}

# 框选抠图:box=左上x,左上y,右下x,右下y(像素)
curl -F "file=@test.jpg" -F "box=120,80,520,600" http://<公网IP>:8000/segment
# 返回 { "cutout":"data:image/png;base64,...", "bbox":[...], "size":[w,h], "bg":"white" }
```
调不通先查:阿里云**安全组放行了 8000** 吗?

### 4. 接进管线
返回的 `cutout` 是 data URI,直接作为 TRELLIS 的 `image_url` → 出 3D。
前端框选坐标传 `box` 即可;不传则用画面中心点兜底(没那么准)。

---

## 二、视频追踪 → tracklet(step 6,闪烁锚点数据链)

见 `track_video.py`。它产出前端「暂停时画跳动圆环」用的 JSON。

⚠️ 它用**官方 sam2**(视频传播抗遮挡),和抠图服务的 ultralytics 版**分开装**,建议单独 venv:
```bash
python3 -m venv ~/venv-sam2 && source ~/venv-sam2/bin/activate
pip install "git+https://github.com/facebookresearch/sam2.git" opencv-python-headless numpy
# 下权重 sam2.1_hiera_base_plus.pt + 配置 yaml(ModelScope/官方)

python track_video.py --video demo.mp4 \
    --boxes "120,80,520,600,sofa; 640,300,760,520,lamp" \
    --out demo.tracklets.json --fps-sample 6
```
demo 阶段**手动播种框**即可;之后接 GroundingDINO/YOLO-World 自动检测(脚本末 TODO)。

tracklet JSON schema、字段含义、前端怎么消费,见 `track_video.py` 顶部注释。

---

## 三、还没做

- **TRELLIS 图生3D 服务**(step 5):`trellis_server.py` 待补——异步 job(提交→轮询),
  权重走 ModelScope,`{image_url: <抠图 dataURI>}` → 出 `.glb`。回填/现场都用它。
- **ASR**:走云 API,前端直连,不在本目录。

---

## 省钱提醒
用完在阿里云控制台**停机 → 选「节省停机模式」**;学习/回填用**抢占式**,路演当天用**按量**。
详见 `docs/backend-infra-plan.md`。
