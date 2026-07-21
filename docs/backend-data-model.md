# DreamHome 后端数据模型

## 资产聚合

前端读取单件资产统一使用 `GET /api/assets/{asset_id}/full`。返回内容包括：

- `asset_id`、`name`、`space`、`status`、`created_by`
- `labels.category/sub/colors/materials/styles/features/mount`
- `size_prior`: 真实世界尺寸，单位米，推荐 `{w,h,d,source,confidence}`
- `appearances[]`: `video_id/track_id/t_start/t_end/best_frame_t/category`
- `media[]`: 原始裁切、补全输入、缩略图、3D、预览及其历史版本
- `review`: 人工审核结论、原因和更新时间

### 媒体类型

`asset_media.kind` 使用：

- `context`: 视频红框上下文
- `source_crop`: 原始识别裁切
- `completed_input`: 补全后、实际用于 3D 的输入
- `thumbnail`: 前端缩略图
- `model_3d`: GLB/其他 3D 文件
- `preview`: 3D 渲染预览

每类媒体独立递增 `version`，`is_current=1` 表示前端默认版本。保留旧版本用于审核、回滚和比较。URL 指向对象存储；表内同时保存 MIME、像素尺寸、字节数、SHA-256 和生成参数元数据。

## 视频时间关系

`tracks` 是“资产在原视频何时出现”的唯一事实来源。一件资产可以绑定多个视频、多个不连续时间段。不要只使用资产上的 `source.t_best` 代替时间范围；`t_best` 仅用于跳转代表帧。

## 用户的家

- `home_projects`: 项目、户型来源、房间、墙、窗位和全屋饰面
- `home_placements`: 某个资产在项目中的实例；保存房间、位置、旋转、缩放、自定义尺寸和显隐
- `home_project_versions`: 每次保存的完整快照及递增修订号

接口：

- `GET /api/home-projects?user_id=...`
- `GET /api/home-projects/{project_id}`
- `PUT /api/home-projects/{project_id}?user_id=...`
- `DELETE /api/home-projects/{project_id}`

## 建议补充字段

后续生产化建议补充：租户/用户权限、软删除与恢复、创建/修改人、单位与坐标系、尺寸置信度、模型格式及多分辨率 LOD、碰撞盒、放置锚点、材质贴图、版权来源、生成模型/参数/成本、审核人、失败原因、幂等键、同步状态和乐观锁版本号。
