# Available Assets v1

这是从后端资产库导出的前端可用数据集，包含视频生产资产和线下拍照生成资产。

所有资产都满足：

- 状态为 `ready`
- 真实尺寸已知时保存米制长宽高；未知时明确标为 `size_status: missing`
- 有识别上下文、原始裁切、补全后的 3D 输入图和本地 GLB
- GLB 已解析出包围盒、顶点/三角形数、碰撞盒和放置锚点
- 所有媒体都有 SHA-256，可用 `checksums.sha256` 校验

来源规则：

- 视频资产保留视频 ID 和至少一个非零出现区间，且人工审核为 `pass`
- 线下拍照资产带有 `source.type: offline_photo` 和 `source.label: 线下拍照生成`
- 线下拍照资产没有原视频，因此 `source.url`、`video_id` 为 `null`，`appearances` 为空
- C 端线下拍照生成不等待人工审核，`review.verdict` 为 `not_required`

## 使用

- `manifest.json`：数据集入口和完整性标准
- `assets/<asset_id>/asset.json`：单件资产的全部结构化字段
- `assets/<asset_id>/context.jpg`：资产在原视频中的识别上下文；旧资产没有红框图时使用代表帧
- `assets/<asset_id>/source_crop.jpg`：补全前的原始裁切
- `assets/<asset_id>/completed_input.*`：实际送入 3D 的完整输入图
- `assets/<asset_id>/model.glb`：3D 模型
- `videos/<video_id>/source.mp4`：仅视频资产有对应源视频；通过 `appearances` 跳到出现区间

视频资产的 `appearances` 支持同一资产对应多个时间段。数据集不暴露检测轨迹 ID。

当前仓库没有单独的数据授权文件；对外分发前请由仓库所有者补充许可说明。
