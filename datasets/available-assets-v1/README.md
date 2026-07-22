# Available Assets v1

这是从后端资产库导出的严格完整数据集。只包含同时满足以下条件的资产：

- 状态为 `ready`，且人工审核为 `pass`
- 有真实尺寸（米）
- 有视频 ID，以及至少一个非零的开始—结束出现区间
- 有识别上下文、原始裁切、补全后的 3D 输入图和本地 GLB
- GLB 已解析出包围盒、顶点/三角形数、碰撞盒和放置锚点
- 所有媒体都有 SHA-256，可用 `checksums.sha256` 校验

## 使用

- `manifest.json`：数据集入口和完整性标准
- `assets/<asset_id>/asset.json`：单件资产的全部结构化字段
- `assets/<asset_id>/context.jpg`：资产在原视频中的识别上下文
- `assets/<asset_id>/source_crop.jpg`：补全前的原始裁切
- `assets/<asset_id>/completed_input.*`：实际送入 3D 的完整输入图
- `assets/<asset_id>/model.glb`：3D 模型
- `videos/<video_id>/source.mp4`：对应源视频；通过 `appearances` 跳到出现区间

`appearances` 支持同一资产对应多个时间段。数据集不暴露检测轨迹 ID。

当前仓库没有单独的数据授权文件；对外分发前请由仓库所有者补充许可说明。
