# DreamHome 后端

三个原子能力做成 HTTP 接口，手机端调用。底层三条链路共用同一个 image-to-3D 引擎。

## 能力与接口

| 能力 | 接口 | 输入 | 产出 |
|---|---|---|---|
| 视频 → 3D | `POST /api/video-to-3d` | 视频 + 可选圈选 bbox | job_id |
| 拍照 → 3D | `POST /api/photo-to-3d` | 照片 + 可选 bbox | job_id |
| 画画 → 3D | `POST /api/sketch-to-3d` | 线稿 PNG | job_id |
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
