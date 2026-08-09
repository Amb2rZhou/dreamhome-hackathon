# Feed 暂停圈选 → 正式 3D 资产 API

这组接口给 Feed 前端使用：用户暂停视频、圈选家具后，先识别并匹配素材库；
没有可复用同款时，再启动与批量生产一致的自动补全、质量检查、TRELLIS 生成和入库链路。

## 0. 能力检查

```http
GET /api/health
```

读取 `capabilities.feed_selection_production`：

- `ready=true` 才能提交 `quality_mode=production`。
- `gen3d_provider` 必须是 `fal` 或 `selfhost`，两者都走 TRELLIS。
- `blockers` 只返回缺少哪类配置，不返回 key 或内部地址。

Provider 凭据只配置在后端，Feed 客户端不要持有或直连模型服务。

## 1. 准备 video_id

已进入 DreamHome 索引的视频直接复用其 `video_id`。外部 Feed 首次接入时先登记：

```http
POST /api/videos
Content-Type: application/json

{
  "title": "Feed item title",
  "source_url": "https://source.example/video/123",
  "play_url": "https://cdn.example/video/123.mp4",
  "duration": 26.4
}
```

保存响应里的 `video_id`，后续暂停和圈选都使用它。

## 2. 暂停并提交圈选

```http
POST /api/videos/{video_id}/select
Content-Type: application/json

{
  "t": 12.4,
  "bbox": [0.12, 0.20, 0.42, 0.50],
  "frame_data_uri": "data:image/jpeg;base64,...",
  "category_hint": "沙发",
  "track_id": null
}
```

- `bbox` 是相对整帧的归一化 `[x, y, width, height]`，原点在左上角。
- `frame_data_uri` 支持 JPEG/PNG/WebP。正式生产模式必须传真实暂停帧。
- 如果圈选来自 `/detect` 返回的框，把 `track_id` 原样传回，避免重复建轨迹。

响应包含 `select_id`、结构化 `labels` 和素材库内的疑似同款 `candidates`。

## 3A. 复用同款

用户确认候选就是同一件时，不重新花费 3D 生成：

```http
POST /api/videos/{video_id}/select/confirm
Content-Type: application/json

{
  "select_id": "...",
  "use_asset_id": "ast_...",
  "generate_new": false
}
```

响应的 `quality_mode` 为 `reuse`。

## 3B. 启动完整生产链

没有同款或用户明确要生成新资产时：

```http
POST /api/videos/{video_id}/select/confirm
Content-Type: application/json

{
  "select_id": "...",
  "use_asset_id": null,
  "generate_new": true,
  "quality_mode": "production",
  "user_id": "user_123"
}
```

服务立即返回：

```json
{
  "asset_id": "ast_...",
  "job_id": "...",
  "track_id": "trk_...",
  "quality_mode": "production",
  "library_attached": false
}
```

生产任务依次执行：输入质量门 → 强制补全 → 单物体检查（失败自动强化重试一次）→
身份一致性检查 → TRELLIS → canonical asset 入库。任一自动质量门失败都会终止，
不会把失败资产标成可用，也不需要人工审核。

## 4. 轮询结果

```http
GET /api/jobs/{job_id}
```

前端按 `status` 处理：

- `queued` / `running`：展示 `stage` 和 `progress`。
- `succeeded`：读取 `model_url`、`thumbnail_url` 和 `asset_id`；
  `library_attached=true` 表示已自动加入 `user_id` 的素材库。
- `failed`：展示 `stage` 和 `error`，不要继续轮询。

成功后也可以读取：

```http
GET /api/assets/{asset_id}
GET /api/library?user_id=user_123
```

## 快速模式的兼容性

历史调用不传 `quality_mode` 时仍默认 `fast`：它只把圈选裁图直接送入 3D provider，
不包含补全和正式质量门。新 Feed 的真实用户资产应显式使用 `production`。

## 常见失败

- `422 production mode requires a valid frame_data_uri`：`/select` 没有收到可解码的暂停帧。
- `503 production pipeline is not ready`：查看响应里的 `capability.blockers`，由后端负责人补齐配置。
- job `failed` 且 `stage=input_qc/single_object_qc/identity_qc`：自动质量门拒绝了当前圈选；
  前端应提示用户换一个更完整、更清晰的视角重新圈选。
