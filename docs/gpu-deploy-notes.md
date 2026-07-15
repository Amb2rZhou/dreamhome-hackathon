# GPU 服务器部署现场记录(2026-07-16 凌晨)

服务器:阿里云杭州 ecs.gn7i-c8g1.2xlarge(A10 24G),¥9.53/时,公网 IP `<公网IP·见backend/.env>`
(注意:非固定 EIP,**停机重启后 IP 可能变**,变了要同步改 backend 的 REMOTE_GPU_URL 和本文档)

## 已完成并验收 ✅

### 检测服务(端口 9000,systemd 自启)
- `systemctl status dreamhome-gpu`;代码在 `/root/dreamhome-gpu/server.py`(与仓库 gpu/server.py 同步)
- Grounding DINO base,单 batch 多 prompt;**公网端到端 0.8s,6/6 品类全对**
- 权重已缓存(hf-mirror),开机即用,首次调用 ~15s 加载进显存

### TRELLIS 3D 生成(容器 trellis)
- 镜像 `cassidybridges/trellis-box`(18.4GB 已在本地);容器已建,挂载 `/data/hf_cache`
- **A10 实测:加载 36s(一次性)+ 预处理 0.9s + 生成 19.7s + GLB 导出 17.1s ≈ 38s/件**
- 产物质量:见 backend /review 里 "TRELLIS实测·高脚凳"(GLB 1.28MB)
- 批量推算:1000 件 ≈ 11 GPU 时 ≈ ¥105

## 踩过的坑(重要,别再踩)

1. **Docker Hub 大镜像国内拉不动**:免费加速站(daocloud/1ms/xuanyuan)对 GB 级层限流 403/429。
   最终解法:SSH 反向隧道借本机代理(`ssh -R 17897:127.0.0.1:7897`,本机代理端口 7897),
   docker systemd drop-in 配 HTTP_PROXY=127.0.0.1:17897(文件在 /etc/systemd/system/docker.service.d/)。
   **隧道已随本次收工关闭;下次要拉新镜像需重开**(小文件用 hf-mirror/tuna 不需要隧道)。
2. **rembg 的 u2net.onnx**:走 GitHub 极慢。镜像设了 `U2NET_HOME=/app/rembg_cache`,
   文件已放好(md5 60024c5c889b...)。⚠️ 容器重建会丢(在容器层,不在挂载卷),备份在宿主机 /root/u2net.onnx。
3. **TRELLIS fp16**:直接 pipe.run 会报 "Half and Float dtype mismatch"。必须复刻 trellis-box 的
   配方(flow/decoder .half() + norm 层保 fp32 + inference_mode),完整可用代码在容器 /tmp/test_gen.py
   和 /app/webui/initialize_pipeline.py:105-145。
4. **HF pipeline 检测慢 20 倍**:zero-shot-object-detection pipeline 逐词跑前向;必须 processor+model
   手动单次前向。词表 >6 词会互相稀释,分组 ≤5 词/组同图 batch。

## 明天待办(约 30-60 分钟)

1. [ ] 开机(控制台"启动",1-2 分钟;确认 IP 是否变了)
2. [ ] 把 gen3d worker 接进容器:server.py 的 get_trellis() 换成 fp16 配方版(参考 /tmp/test_gen.py),
      整个 server.py(detect+embed+gen3d)搬进容器跑 9000 端口(fastapi/uvicorn 容器里已装好),
      宿主 systemd 单元改为 `docker start trellis` + `docker exec` 方式管理
3. [ ] backend `.env` 填 `GEN3D_PROVIDER=selfhost REMOTE_GPU_URL=http://<IP>:9000 DETECT_PROVIDER=remote`,
      photo-to-3d 全链路验收(拍照→38s→GLB 从自己服务端下发)
4. [ ] 跑通后给美娅联调;开始 T6 素材收集喂离线 pipeline

## 停机 checklist(每次收工)

控制台 → 实例 → 停止 → **勾"节省停机模式"**(GPU 停止计费,只剩云盘 ~¥3-4/天)。
容器和 systemd 服务都配了自启/可重启,开机后 1-2 分钟内服务自动恢复。
