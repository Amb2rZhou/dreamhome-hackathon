# DreamHome 11 项技改盘点（2026-08-07）

> 口径：区分“比赛 Demo 可用”“前端闭环”“真实后端能力”“可发布数据”。本轮改动均未提交、未推送、未部署。

## 当前状态

| # | 项目 | 当前状态 | 本轮收束 | 仍未完成 |
|---|---|---|---|---|
| 1 | 圈选拖动时包工球消失 | 部分完成 | collecting / ready / receiving 全程复用一个动态媒体节点；测试覆盖状态连续切换 | 真机长按、双指、取消手势的端到端回归与故障埋点 |
| 2 | Feed 与下方组件对应 | 比赛首条已修复 | 前端以 videoId + time 绑定，切换 reducer 有防陈旧保护；首条改为已校对的 `vid_40734d7f2e6c`，实测固定显示 10 个组件 | Feed 仍读取前端兼容清单，没有统一消费后端 manifest；缺跨视频组件级集成测试 |
| 3 | 3D 组件与出现时机 | 发布错误已清零，运行时复核待补 | track → asset 改绑会递增 binding_version、记录来源并使旧审核失效；补齐 8 个经复核补充资产与长厅 scene；manifest errors 从 11 降为 0 | 当前本地无运行时 SQLite，因此 tracks=0，保留 20 条 `ORPHAN_MAPPING` 和 1 条兼容时间轴 warning；缺人工复核后台 |
| 4 | 包工球定位与生命周期 | 部分完成 | 单实例、safe-area、clamp、短屏横屏规则已补 | 键盘、旋转、极小屏真机矩阵与消失事件上报 |
| 5 | 同款小家独立空间 | Demo 前端闭环 | 独立只读案例；收藏布局；应用时创建新 project / placement IDs，原案例不变 | 后端公共模板、复制接口、权限、跨设备布局收藏 |
| 6 | 户型和窗户自定义 | 基础版可用 | 修复 north/south/east/west/无窗到真实 3D 墙面的映射及墙宽计算 | 墙体绘制、房间拆分、层高/朝向、碰撞/通行校验；图纸上传仍是 Mock |
| 7 | 家具 Tag / 筛选 / AI 搭配 | 标签筛选可用 | 基于真实 colors / materials / styles 的三条件组合筛选 | 标签合并/停用/批量复核后台、价格品牌、推荐 API 与反馈闭环；当前没有冒充 AI 推荐 |
| 8 | Demo 图片与视频兼容 | 部分完成 | 9 条视频、海报和图片失败兜底已存在；Feed 首条已避开无组件的 `home-1` | 图片 Feed、焦点/安全区元数据、多码率/HLS；审核失败的原始资产仍不可进入 ready 目录 |
| 9 | 整体时延 | P0 加载阻塞已修复 | FCP/LCP/CLS/INP 与 Feed ready/switch 本地观测；JS/CSS/MP4/图片/GLB 性能预算；长厅先用品类几何体渐进呈现，真实 GLB 后台替换；补齐静态包 `BufferGeometryUtils` 和统一 Draco 路径 | OSS 入口 iframe、最大 13.45 MiB 视频、API 分页、模型 LOD、CDN 配置自动化及境内实测 |
| 10 | 分享空间与小火人 | 仅案例 Demo | 案例只读链接可分享 | 个人空间分享 token、visibility、owner auth、访客读取；companion 仍不是后端实体 |
| 11 | 世界模型叙事 | 数据底座阶段 | 现有 user / home / room / placement 可作为底座 | companion、行为、记忆、成长、world events 与状态机均未实现 |

## 本轮并行包

1. 包 A：动态包工球单实例、定位安全区和生命周期回归测试。
2. 包 B：同款布局收藏/独立复制、自定义窗户方向修复。
3. 包 C：性能观测、性能预算和显式发布数据检查。
4. 主线整合：绑定关系版本/审核来源、真实标签组合筛选、统一测试与浏览器验收。

## 下一轮建议并行包

### 数据真源包（最高优先级）

- 部署真实运行时 SQLite 快照后，人工核对 20 个 scene track 与 195 条兼容时间轴。
- 为正式 appearance 补 reviewed relation 与真实时间轴，不用假置信度填绿。
- 前端改为消费统一 Feed manifest，并增加 A → B 快速切换组件集成测试。

### 媒体与境内性能包

- 移除 OSS 入口 iframe；生成 720p 首播版并保留原片。
- 图片 Feed mediaType 契约、图片展示时长和滑动行为。
- OSS/CDN 缓存、Range、CORS、回源规则配置化；备案/充值后再做境内多省测速。

### 模板、分享与权限包

- 后端 template / clone API，区分公共模板和个人副本。
- share token + visibility + owner auth，禁止通过 project ID 直接公开用户空间。
- 访客只读空间与分享卡片。

### 标签推荐与世界模型包

- 标签管理/复核后台、推荐解释和负反馈。
- 数据准确后再增加 companion / world_event schema 和确定性状态机。

## 发布闸

- 普通开发构建可继续运行。
- 发布前执行 `npm run check:release-data`；当前 errors=0，但本地无运行时 SQLite 快照，21 条 warning 仍需在 API 预发环境复核，不可当成已完成全量时间轴审核。
- 发布前执行 `npm run check:performance-budget`、`npm test`、`npm run build:discover`、`npm run check:asset-paths`。
