# DreamHome 后端能力与 API Key 清单

这份文档给后端同学对齐用。当前假设：前端传进来的就是主体明确的家具图片，不需要抠图。

## 最少需要

### 1. fal.ai

用途：核心图生 3D，推荐走 `fal-ai/trellis`，输入一张家具图，输出带贴图 GLB。

需要提供：

```env
GEN3D_PROVIDER=fal
FAL_KEY=你的_fal_key
FAL_TRELLIS_ENDPOINT=fal-ai/trellis
```

后端调用方式：

```http
POST https://queue.fal.run/fal-ai/trellis
Authorization: Key <FAL_KEY>
Content-Type: application/json

{
  "image_url": "data:image/jpeg;base64,..."
}
```

返回里保存 `status_url` 和 `response_url`，轮询到 `COMPLETED` 后 GET `response_url`，从结果里取 GLB URL。

## 强烈建议但不是第一天必须

### 2. 对象存储/CDN

用途：把 fal 返回的 GLB 拉回自己的存储，再给前端稳定下载。国内现场网络下，直接让手机拉 fal CDN 容易不稳。

二选一即可：

```env
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=
S3_REGION=
S3_PUBLIC_BASE_URL=
```

或：

```env
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
TENCENT_COS_BUCKET=
TENCENT_COS_REGION=
TENCENT_COS_PUBLIC_BASE_URL=
```

### 3. 一个 LLM key

用途：把用户中文修改词、语音文本解析成结构化编辑命令。没有也能用关键词兜底。

仓库里当前预留的是：

```env
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-4-8
```

如果你们实际用 OpenAI/豆包/通义/智谱也可以，前端只需要统一后的 `/api/voice-edit` 结果。

## 备选 3D Provider

仓库已有 Tripo 和 Meshy provider 骨架，可以作为 fal 不稳定时的备选。

```env
GEN3D_PROVIDER=tripo
TRIPO_API_KEY=
```

```env
GEN3D_PROVIDER=meshy
MESHY_API_KEY=
```

## 中国现场网络可选

如果评委现场不开 VPN，建议后端多准备一层：

- COS/CDN 托管静态页面、缩略图、GLB
- 后端代理 fal 请求，不让浏览器直连 fal
- 预生成 5-6 个家具 GLB，断网也能演示
- 讯飞开放平台 ASR：如果浏览器 `webkitSpeechRecognition` 在现场不可用，再接讯飞语音听写

讯飞可选配置：

```env
XFYUN_APP_ID=
XFYUN_API_KEY=
XFYUN_API_SECRET=
```

## 前后端接口约定

### 提交照片生成

```http
POST /api/photo-to-3d
Content-Type: multipart/form-data

file=<主体明确的家具图片>
texture=true
meta={"category":"布艺沙发","style":"暖绿色","estimated_size_m":[2.1,0.9,0.8]}
```

返回：

```json
{
  "job_id": "xxx",
  "status": "queued"
}
```

### 查询任务

```http
GET /api/jobs/{job_id}
```

返回：

```json
{
  "job_id": "xxx",
  "kind": "photo",
  "status": "succeeded",
  "progress": 100,
  "model_url": "https://.../model.glb",
  "thumbnail_url": "https://.../preview.jpg",
  "category": "布艺沙发",
  "style": "暖绿色",
  "estimated_size_m": [2.1, 0.9, 0.8],
  "provider": "fal"
}
```

### 语音/文字编辑

```http
POST /api/voice-edit
Content-Type: application/json

{
  "transcript": "把沙发挪到窗边再放大一点",
  "catalog": ["sofa", "lamp", "cabinet"]
}
```

返回：

```json
{
  "action": "move",
  "target": "sofa",
  "value": "窗边",
  "params": {"scale": 1.1},
  "transcript": "把沙发挪到窗边再放大一点",
  "confidence": 0.86
}
```
