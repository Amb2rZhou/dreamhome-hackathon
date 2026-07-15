# GPU 云服务器开通手册(阿里云 A10,按量付费)

> 照着逐步做即可;每一步给出预期结果,不符就停下来排查。
> 交互式陪跑:新开终端 `cd ~/dreamhome-hackathon && claude`,说"按 docs/gpu-setup-guide.md 带我开通"。
> 预期总耗时 40-60 分钟(不含实名审核),当天成本 ~15-30 元。

## 第 1 步:账号与充值(10 min)

1. https://www.aliyun.com 注册/登录,完成**个人实名认证**(支付宝扫脸,秒过)。
2. 费用中心充值 **¥200**(按量付费要求余额 ≥100;后续按实际用量扣)。
3. 顺手看下"新用户专享"页有没有 GPU 券/折扣,gn7i 新用户价能到 ~4.5 折。

## 第 2 步:选购实例(15 min)

入口:控制台 → 云服务器 ECS → 创建实例。

| 配置项 | 选择 |
|---|---|
| 付费模式 | **按量付费** |
| 地域 | 华东1(杭州)/ 华东2(上海)/ 华北2(北京)——哪个有 gn7i 库存且单价低选哪个 |
| 规格 | 筛选"异构计算 GPU" → **ecs.gn7i-c8g1.2xlarge**(A10 24G, 8核30G, ~12.71 元/时) |
| ⚠️ 比价 | 同页搜 **gn8is**(L20 48G):若按量价 ≤ gn7i(社区见过 ~7.7 元/时),**直接选它**,更快更便宜 |
| 镜像 | 公共镜像 **Ubuntu 22.04 64位**,✅ 勾选"**自动安装 GPU 驱动**"(选 CUDA 12.x 驱动组合) |
| 系统盘 | ESSD Entry/PL0,**100G** |
| 数据盘 | 加一块 ESSD PL0 **100G**(放 TRELLIS 权重和 GLB 产物,停机不丢) |
| 公网 IP | ✅ 分配公网 IPv4,计费模式选**按使用流量**,带宽峰值拉到 **100Mbps**(按流量计费时峰值不额外收钱) |
| 安全组 | 新建,放行 **22**(SSH)和 **9000**(推理服务);来源先填 `0.0.0.0/0`,上线前收紧成你和 backend 的 IP |
| 登录凭证 | **密钥对**(新建一个,下载 .pem 保存好)|

下单前确认页应显示 **"¥12-13/时"级别 + 停机可节省** 字样。创建后等 2-3 分钟变"运行中",记下**公网 IP**。

预期结果:控制台看到实例运行中,有公网 IP。

## 第 3 步:连上去验证 GPU(5 min)

本机终端:

```bash
chmod 600 ~/Downloads/你的密钥.pem
ssh -i ~/Downloads/你的密钥.pem root@<公网IP>
nvidia-smi        # 预期:看到 A10 / L20,Driver + CUDA 12.x
```

看不到卡 = 驱动没装好:跑 `ls /opt/` 找阿里云驱动安装日志,或重建实例时确认勾了自动装驱动。

## 第 4 步:装 Docker + NVIDIA 容器支持(10 min)

```bash
curl -fsSL https://get.docker.com | bash
# NVIDIA Container Toolkit
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt update && apt install -y nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker && systemctl restart docker
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi   # 预期:容器里也能看到卡
```

国内拉 Docker Hub 慢/失败:`/etc/docker/daemon.json` 加镜像加速(阿里云控制台"容器镜像服务"里有专属加速地址),`systemctl restart docker`。

## 第 5 步:部署 TRELLIS(15 min + 权重下载时间)

数据盘挂载(第一次):

```bash
mkfs.ext4 /dev/vdb && mkdir -p /data && mount /dev/vdb /data
echo '/dev/vdb /data ext4 defaults 0 0' >> /etc/fstab
```

拉社区镜像(免编译,首选):

```bash
docker pull cassidybridges/trellis-box
docker run -d --gpus all --name trellis -p 8501:8501 \
  -v /data/hf_cache:/root/.cache/huggingface cassidybridges/trellis-box
docker logs -f trellis    # 首跑下载 ~5GB 权重,等它 ready
```

浏览器开 `http://<公网IP>:8501`(安全组要放行 8501),传一张家具图试生成——**记录耗时**,这就是 A10 实测数据。
如果镜像起不来(CUDA 驱动不匹配等),备选 FastAPI 版:https://github.com/UNES97/TRELLIS-3D-API 按其 README 构建。

## 第 6 步:部署我们的推理服务(10 min)

```bash
apt install -y python3-pip git
git clone https://github.com/Amb2rZhou/dreamhome-hackathon.git /root/dreamhome
cd /root/dreamhome/gpu && bash setup.sh     # 装检测/embedding 依赖并缓存权重
python3 server.py                            # 起 0.0.0.0:9000
```

本机验证:`curl http://<公网IP>:9000/health` → `{"status":"ok","device":"cuda"}`。
(`/gen3d` 需要 server.py 跑在 TRELLIS 环境里才生效;第一阶段 检测/embedding 可用就够,
3D 生成走 trellis-box 的 UI/API,联调时我再把两者接起来。)

## 第 7 步:省钱开关(务必做)

- **每次用完**:控制台 → 实例 → **停止** → 弹窗选 **"节省停机模式"**。GPU/CPU 停止计费,只收云盘 ~50 元/月。
- 再用时"启动",约 1-2 分钟开机 + TRELLIS 加载 3-5 分钟。**公网 IP 若非固定 EIP,重启可能变**——变了记得告诉我改 `REMOTE_GPU_URL`(想固定就把 IP 转成 EIP,几块钱/月)。
- 手机装"阿里云 App"可随时看余额/停机,防跑冒滴漏。

## 完成后交付给主 session

回来只需要给我三样:
1. `http://<公网IP>:9000`(填 REMOTE_GPU_URL)
2. TRELLIS 实测单次耗时(第 5 步记录的)
3. 实际下单的机型与单价(更新 cost-evaluation.md)
