# 用户端 FAL.AI 3D 接口

这套 `web/api` 文件用于网页或 App 的用户在线生成，不使用阿里云自部署模型。
它在服务端调用 FAL.AI，默认模型固定为 `fal-ai/trellis`，浏览器和 App 不持有 `FAL_KEY`。

## 部署

1. 在 Vercel 中把项目 Root Directory 设为 `web`。
2. 在 Vercel 项目环境变量中配置 `FAL_KEY`。
3. 可选配置 `FAL_TRELLIS_ENDPOINT`；不配置时就是 `fal-ai/trellis`。
4. 部署后，网页与 API 同域，不需要把密钥写进前端代码。

## Feed 圈选输入

用户暂停视频并圈选后，前端用 Canvas 把圈选区域裁成 JPEG/PNG/WebP Data URL，最长边建议压到 1024px，
然后提交：

```http
POST /api/photo-to-3d
Content-Type: application/json

{
  "image_data_url": "data:image/jpeg;base64,...",
  "prompt": "米色布艺单人沙发"
}
```

返回：

```json
{
  "job_id": "...",
  "status": "queued",
  "provider": "fal"
}
```

每两秒轮询：

```http
GET /api/jobs/{job_id}
```

成功响应包含 `status: "succeeded"`、`provider: "fal"`、`model_url` 和可选的 `thumbnail_url`。
前端现成调用代码在 `web/app.js` 的 `tryBackendGeneration()` 与 `imageSourceToDataUrl()`。

## 能力边界

这是用户端的快速 FAL.AI 图生 3D 通道。输入应当已经是圈选并裁好的单体图片；它不运行内部批量生产用的
视频检测、遮挡补全、自动 QC 或资产库数据库写入。需要完整生产质量链时，使用 FastAPI 的
`/api/videos/{video_id}/select` 与 `/select/confirm`，并将该后端部署实例配置为 `GEN3D_PROVIDER=fal`。
