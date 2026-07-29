# DreamHome 后端

三个原子能力做成 HTTP 接口，手机端调用。底层三条链路共用同一个 image-to-3D 引擎。

## 能力与接口

| 能力 | 接口 | 输入 | 产出 |
|---|---|---|---|
| 视频 → 3D | `POST /api/video-to-3d` | 视频 + 可选圈选 bbox | job_id |
| 拍照 → 3D | `POST /api/photo-to-3d` | 照片 + 可选 bbox | job_id |
| 画画 → 3D | `POST /api/sketch-to-3d` | 线稿 PNG | job_id |
| Feed 圈选 → 正式 3D 资产 | `POST /api/videos/{id}/select` → `POST .../select/confirm` | 暂停帧 + 归一化 bbox | asset_id + job_id |
| 语音编辑 | `POST /api/voice-edit` | ASR 文本 | 结构化编辑指令 |
| 任务查询 | `GET /api/jobs/{job_id}` | job_id | 进度 + GLB url |

3D 生成 30–120s，统一走**异步 job**：提交拿 `job_id` → 轮询 `/api/jobs/{id}` 直到 `succeeded`，拿 `model_url`(GLB)。

## 跑起来

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # 全空 = mock 模式，直接能跑
uvicorn app.main:app --reload --port 8000
```

打开 http://localhost:8000/docs 交互式测试。

## Provider 切换

`.env` 里 `GEN3D_PROVIDER` 设 `mock` / `tripo` / `meshy`，并填对应 key。
**缺 key 自动退回 mock**，前端零改动 —— 监管机上写代码、云端换真 key 跑，就是这条设计。

## 优雅退化

图像/视频依赖没装也不崩，逐级退化：
- 无 `opencv` → 抽帧退到中间帧；无 `rembg` → 跳过去背景用原图；无 `PIL` → 草图不洗直接送。
先跑通链路，再按需装重依赖提质量。

## 资产库(docs/asset-library-plan.md)

新增一组接口支撑「资产库优先」链路,交互契约见 plan 文档第五节,联调直接看 /docs:

- `GET /api/assets` 浏览搜索 · `GET /api/assets/{id}` 详情含溯源 · `POST /api/assets/merge` 合并重复
- `GET /api/videos/{id}/index` 整包时空索引(暂停本地查表) · `POST .../detect` 实时识别(lazy 写回)
- `POST .../select` 圈选→标签匹配候选 · `POST .../select/confirm` 复用同款或生成新资产
- `GET/POST /api/library*` 我的素材库
- 浏览器开 `/review` = 资产审核页(通过/拒绝/合并重复)

联调数据:`python seed_demo.py`(6 资产 + 1 已索引视频带轨迹 + 1 未索引视频)。
离线批量:`python -m pipeline.run <video.mp4> --source-url <抖音链接>`,mock 可跑,
真检测填 `REMOTE_GPU_URL`(gpu/setup.sh 起的推理服务)、真 3D 填 `FAL_KEY`。

Feed 联调用完整生产链时，在 `/select/confirm` 传
`{"generate_new":true,"quality_mode":"production","user_id":"..."}`；成功资产会自动加入该用户素材库。
完整请求、状态和错误契约见 [`docs/feed-selection-api.md`](../docs/feed-selection-api.md)。

## 结构

```
app/
  config.py         配置 + 缺 key 自动 mock
  schemas.py        Job / EditCommand 统一结构
  store.py          内存 job store + 后台轮询
  providers/        3D 生成抽象：mock / tripo / meshy
  services/         frames(抽帧) / segment(抠图) / sketch(洗线稿) / voice(意图解析)
  routers/          video / photo / sketch / voice / jobs
```
