# 结构化资产与前后端联调 TODO

## 已完成

- [x] 资产完整聚合接口：基本信息、审核、视频区间、媒体版本、几何数据
- [x] 输入图与 GLB 版本化存储结构
- [x] 现有本地媒体 SHA-256、字节数、图片宽高回填
- [x] GLB 包围盒、模型尺寸、中心点、顶点/三角形数、碰撞盒、放置锚点回填
- [x] “我的家”项目、摆件实例和修订历史后端接口
- [x] 本地资产读取与“我的家”保存/读取往返测试

## 生成队列

- [ ] GPU 开机后先生成已审核通过的边柜 `ast_d2001a827712`
- [ ] 灯具 `ast_9dc8d4e8a44f` 先高清补全、复审、再生成
- [ ] 柜子 `ast_cfaa5917ba1e` 先高清补全、复审、再生成
- [ ] 桌子 `ast_0e38333f7509` 按“没补全”返工并复审
- [ ] 桌子 `ast_b40e09ce49b3` 按“没补全”返工并复审
- [ ] 其余 52 件无 GLB 的不通过/重复/窗帘资产保持不生成

## 数据补全

- [x] 建立独立 `asset_video_segments`，前端只读取视频开始/结束/代表秒数
- [ ] 把人工补录的零长度区间在复验时扩成准确开始/结束秒数
- [ ] 为 284 件缺真实尺寸的资产补充 `{w,h,d,source,confidence}`（单位米）
- [ ] 为非本地 `/samples` 媒体补齐哈希和几何信息，或明确标记 demo-only
- [ ] 给补全历史文件补建 `source_crop/context/completed_input` 的完整版本链

## 前端联调

- [x] 正式 `/api/assets` 默认只返回 ready 且人工审核通过的资产
- [ ] 资产详情改用 `GET /api/assets/{asset_id}/full`
- [ ] 视频跳转使用 `appearances[].t_start/t_end/best_frame_t`
- [ ] “我的家”资产抽屉改用真实 `/api/assets`，移除硬编码 mock ID
- [ ] “我的家”加载项目接入 `GET /api/home-projects/{project_id}`
- [ ] 保存接入 `PUT /api/home-projects/{project_id}`，显示保存失败/重试状态
- [ ] 使用 `geometry.collision` 做碰撞，使用 `geometry.anchor` 做落地/贴墙/吸顶
- [ ] 增加登录用户 ID，停止固定使用 `demo`

## 部署与 GitHub

- [ ] 合并结构化后端 Draft PR
- [ ] 部署后运行媒体和几何回填脚本
- [ ] 真实视频、图片、GLB 放对象存储；GitHub 只保存代码、迁移和小型 fixture
- [ ] PostgreSQL 生产迁移时补外键、软删除、权限、乐观锁和幂等键
