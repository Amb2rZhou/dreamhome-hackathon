# DreamHome AI 推荐搭配助手交接（协调版）

更新时间：2026-08-09 03:58（Asia/Shanghai）

## 1. 仓库、分支与联调规则

- 仓库：`/Users/serina/Documents/Codex/2026-08-05/new-chat/dreamhome-edit2`
- 当前功能分支：`agent/pr14-safe-copy-20260806`
- 当前 HEAD：`7ab6ee26b220ad819c1f269e5b9380b924c4c94f`
- 联调基线：`integration/aug11`，基线提交 `ebbe18e`
- 禁止 `pull`、`merge`、`rebase`，禁止修改 `integration/aug11` 或 `main`。
- 只允许在现有功能分支整理本任务文件、提交并推送；不得合并。
- 工作区混有多个任务的未提交改动。不得使用 `git reset --hard`、`git clean`、整目录 checkout/restore。

## 2. 当前最高优先级目标

在“我的家”编辑态跑通 AI 推荐搭配助手最小闭环：

1. 包工球入口与冷启动提示。
2. 两个固定入口：`空间推荐`、`单品换搭`。
3. 空间推荐可基于当前空间/已选家具返回统一推荐卡。
4. 单品换搭要求先点选家具，再返回同类替换候选。
5. 所有推荐卡只保留两个动作：`收藏`、`试摆`。
6. `试摆`是临时态；用户确认留下时自动补齐收藏，取消时恢复原场景。
7. 主动推荐与用户主动提问复用同一推荐卡和对话面板。
8. 完成最小静态检查和浏览器交互验证。

## 3. 设计约束

- P2 是冷启动/主面板视觉母版。
- P1 的两个小入口要原样替换 P2 原入口。
- P3 是完整流程参考：冷启动、未点选空间推荐、已点选补搭、单品换搭、主动空间推荐、主动单品换搭。
- 界面简洁统一，不增加多余按钮。
- 包工球与 Feed 基准一致：入口容器 `80px × 80px`，素材 `object-fit: contain`。

## 4. 当前代码状态

主要实现文件：

- `web/prototype/pages/my-home/index.html`

当前相对 HEAD 约有 `329` 行新增、`10` 行删除，已经包含：

- 80×80 包工球入口、冷启动/主动/被动气泡。
- AI 推荐面板和 `空间推荐` / `单品换搭` 两个入口。
- 基于当前房间、收藏偏好、已选家具的本地推荐与解释。
- 统一横向推荐卡；最新补丁已出现 `收藏`、`试摆` 两个按钮。
- 自然语言输入框和简单意图解析。
- 推荐详情及 3D 预览的既有实现。

助手 3 的 UI 子任务先后完成了多次 `my-home/index.html` 文件补丁，但两次执行均被中断，没有交付测试结果。助手 3 主任务仍未生成自己的交接文档，因此以本文档和当前文件为准。

## 5. 助手 4 完成状态（2026-08-09）

- 推荐卡统一只显示 `收藏` / `试摆` 两个动作；列表卡与 3D 详情均接入同一收藏、试摆逻辑。
- 收藏会更新共享收藏集合、卡片状态和装修抽屉；浏览器实测状态由“收藏”变为“已收藏”。
- 试摆新增的 placement 在确认前不会写入本地或后端项目；离页、返回、锁定或开始下一次试摆时会清理临时 placement。
- 试摆后显示 `留下` / `撤销`：撤销会移除临时 placement 并恢复原场景；留下会持久化 placement，并在缺少收藏时自动加入收藏。
- 未选家具时，`单品换搭` 显示“请先点选一件家具”且返回 0 个候选；选中家具后只保留同类候选，不再用其他品类补足 3 张卡。
- `空间推荐` 支持空空间、已摆家具和已选家具上下文；主动提示与固定入口复用同一面板和推荐卡。
- 主动提示最多轮转 3 次；选中家具时的主动提示会进入 `单品换搭`，否则进入 `空间推荐`。
- 助手仅在编辑态展示；保存锁定态和案例只读态保持隐藏。
- 页面初始化会读取 `web/prototype/data/aug11-catalog.json`；支持相对 `/prototype/data/`、仓库根 `/web/prototype/data/` 两种静态服务路径，读取失败时继续使用原有内置资产。
- AUG11 目录 178 项已映射到现有资产形状并合并进同一推荐池；169 项覆盖原共享资产元数据，新增 9 项也复用现有推荐、收藏、试摆与自动收藏状态机。

浏览器验证证据：

1. 未选家具进入单品换搭：标题为“请先点选一件家具”，卡片数为 0。
2. 空间推荐：返回 3 张卡，每张仅含“收藏/已收藏”和“试摆”。
3. 收藏：点击卡片收藏后卡片即时显示“已收藏”。
4. 试摆撤销：摆放后出现“留下/撤销”；点击撤销后两按钮消失，提示“已撤销试摆，原来的家没有改变”。
5. 试摆留下：未收藏的边柜试摆后点击留下，提示“已留下，并自动加入收藏”。
6. 已选餐桌进入单品换搭：返回“圆形双层木质藤编茶几 / 床头桌 / 圆桌”，均为桌子同类，卡片动作仍为收藏/试摆。

当前已知限制：静态 `python3 -m http.server --directory web` 预览下，窗外贴图和个别真实模型资源返回 404。家具模型失败时会恢复基础 3D 占位并记录 warning，不再留下不可见组件或产生助手脚本 error；窗外贴图 error 是既有页面行为。

## 6. 后端/模型技术结论

- 3D 场景内点选家具不需要视觉模型：点击对象时已有 placement/asset ID，可直接读取类别、位置、尺寸和当前房间。
- 首版推荐应由结构化场景上下文 + 商品检索完成；不要让大模型凭空生成 SKU。
- 固定入口可直接调用推荐逻辑，不必调用大模型。
- 自由文本、多轮追问与解释层可后续接轻量对话模型；模型只识别意图/约束并调用推荐工具。
- 真实空间摆放、碰撞和位置合法性由 3D 几何规则处理，不交给对话模型。

建议最小请求上下文：`roomId`、已有 `assetIds`、`selectedPlacementId`、`selectedAssetId`、类别/风格/颜色/尺寸、收藏偏好。建议返回：说明文字、真实商品卡、`favorite`、`trialPlace` 动作。

## 7. 助手 2 数据接入状态

详细交接见 `HANDOFF_AUG11_FEED_LIBRARY.md`。

- AUG11 Feed 构建包已部分接回，页面和主 bundle 曾返回 HTTP 200。
- `web/prototype/data/aug11-catalog.json` 的 178 项商品目录已接入 AI 推荐；Feed 收藏状态、视频素材等其他数据仍未完整接回。
- 核心依赖：`availableAssets.generated.ts`、`feedState.ts`、Feed manifest、supplemental assets、灵感库、`public/videos`、`public/video-posters`。
- 助手 2 必须在本 UI 闭环和测试完成、`my-home` 不再写入后再继续。
- 助手 2 绝不能修改 `web/prototype/pages/my-home/index.html`。

## 8. 其他工作区改动与保护边界

当前还存在以下非助手 4 独占内容：

- `package.json`
- `web/prototype/pages/discover/**`
- `HANDOFF_AUG11_FEED_LIBRARY.md`
- `floorplan-lab-server.mjs`、`ops/`、`web/prototype/pages/floorplan-lab/`
- `web/prototype/assets/social/`（小火人任务，当前应暂停）

助手 4 只能修改 `web/prototype/pages/my-home/index.html` 和本交接文档；除非用户另行授权，不得修改上述其他路径。

## 9. 助手 4 测试结果

- 模块脚本语法检查：通过。
- `git diff --check -- web/prototype/pages/my-home/index.html`：通过。
- 5182 静态预览：页面可打开，模板之家可生成并进入编辑态。
- 针对性浏览器闭环：空间推荐、未选阻断、已选同类换搭、卡片收藏、试摆撤销、试摆留下自动收藏均通过。
- 页面控制台：无助手脚本异常；仅记录上述既有静态贴图/模型 404。
- AUG11 目录浏览器验证：页面根节点报告 `aug11CatalogCount=178`、`aug11SourceCommit=ebbe18e`。
- 查询“推荐办公椅”：`ast_00e00df1bfeb` 出现在推荐首位，可取消收藏并重新收藏；试摆模型 404 时仍出现“留下/撤销”，仅记录安全降级 warning。
- 新增目录项验证：原 169 项共享库之外的 `ast_6410374831cb`（小收纳柜）进入推荐结果，并成功写入原收藏链路。

## 10. 交付清单

最终必须报告：

- GitHub 分支名、最新 commit SHA。
- 当前任务和完成功能。
- 未完成内容。
- 主要修改文件。
- 是否改 API、数据库、共享组件或数据结构。
- 依赖其他队友的部分。
- 测试/构建命令与结果。
- 若未提交：`git status --short`、`git diff --stat`、当前分支与 HEAD、未提交修改是否全部属于本任务。

## 11. Git fallback（2026-08-09 02:29）

- 分支：`agent/pr14-safe-copy-20260806`
- HEAD：`7ab6ee26b220ad819c1f269e5b9380b924c4c94f`
- 暂存区仅含：`AI_RECOMMENDER_HANDOFF_COORDINATOR.md`、`web/prototype/pages/my-home/index.html`。
- 提交未生成，推送未执行。
- 原因：该仓库为 partial clone，`git commit` 需要从 promisor remote 补取缺失对象 `7bd6090225a73c61910c1cad570e6c18d670e887`；沙箱内 DNS 不可用，获准联网后命令 27 秒仍无输出，已按 30 秒规则终止。再次使用 `--no-status` 提交仍立即触发同一缺失对象请求。
- 当前暂存内容可安全区分，其他任务的修改和未跟踪文件均未暂存；下一位执行者在网络正常时可直接复核暂存区后提交、推送该功能分支。

## 12. AUG11 目录接线补充（2026-08-09 03:58）

- 本轮只修改 `web/prototype/pages/my-home/index.html` 和本文档。
- `web/prototype/data/aug11-catalog.json` 由助手 2 生成，本轮只读取和验证，未修改、未暂存。
- 未新增 API、数据库或共享组件改动；目录适配仅存在于 `my-home` 页面，使用现有本地收藏键和 placement 数据结构。
- 按用户要求，本轮不提交、不推送；完成检查后仅重新暂存上述两份既有任务文件。

## 13. 最终交付状态（以本节为准）

- 当前分支：`agent/pr14-safe-copy-20260806`。
- 当前 HEAD：`7ab6ee26b220ad819c1f269e5b9380b924c4c94f`；未产生新提交。
- 最终已精确暂存 11 个本任务文件：本文档、助手 2 交接、Feed manifest 读取/构建/校验文件、178 项静态目录、Feed 状态文件，以及 `my-home/index.html`。
- 暂存统计：17,047 行新增、19 行删除；`git diff --cached --check` 通过。
- 普通提交和本地 `git write-tree` 都因 partial clone 缺少 promisor 对象 `7bd6090225a73c61910c1cad570e6c18d670e887` 被阻断。已在获准联网环境重试，但 GitHub 443 连接 75 秒超时，因此无法生成新 commit，也无法推送。
- 未暂存的 `package.json`、Discover 页面，以及小火人/户型实验等文件属于其他并行任务，未混入本任务暂存区。
- `web/prototype/data/aug11-catalog.json` 实际由协调任务从助手 2 导入的两份 manifest 机械生成；第 12 节所称“助手 2 生成、未暂存”是助手 4 当时的工作快照，现已被本节更新。

## 14. UI 重构与数据验收补充（2026-08-09，本节为最新状态）

- `my-home` 的包工球冷启动面板已按 Concept A / P2 调整为暖色大底板：放大包工球形象与标题、双大卡入口（黄色空间推荐 / 绿色单品换搭）、底部自然语言输入。
- 进入推荐结果后隐藏冷启动双入口，直接展示空间理解、统一推荐卡和输入框；不会再出现“看起来仍停在入口页”的混合状态。
- 主动推荐气泡补充明确的“查看推荐”行动提示，点击仍复用同一面板、同一推荐卡、同一收藏与试摆状态。
- 单品换搭已改为原位临时替换：隐藏原 placement，候选继承原位置、旋转、缩放和房间；撤销删除临时候选并恢复原物，留下才删除原物并持久化候选，同时自动收藏。
- 点选已有家具会调度主动单品换搭提示；未点选进入单品换搭仍安全提示先选家具，不生成伪结果。
- 推荐卡和收藏抽屉始终先渲染类型轮廓，再尝试真实缩略图；图片加载失败会移除图片并保留轮廓，不再显示浏览器破图图标。
- AUG11 178 项目录仍通过同一资产映射、推荐、收藏和试摆状态机接入；没有新增第二套推荐逻辑。

本轮实际浏览器验证：

1. 冷启动视觉已显示新的暖色大面板、放大包工球、两张入口卡和底部输入框。
2. 点击空间推荐后，入口卡隐藏，结果区返回 3 张统一卡，每张仅有收藏/已收藏和试摆。
3. 输入“办公椅”后，AUG11 `ast_00e00df1bfeb` 位于首张结果；收藏可从“已收藏”切到“收藏”并恢复为“已收藏”。
4. `ast_00e00df1bfeb` 图片缺失时无破图，使用类型轮廓；试摆进入临时态并显示“留下/撤销”，撤销后提示“已撤销试摆，原来的家没有改变”。
5. 模块脚本语法检查与 `git diff --check -- web/prototype/pages/my-home/index.html` 均通过。

素材依赖与未完成验证：

- 当前工作树没有 `web/prototype/assets/renders/`、`models/`、`frames/`、`library/` 下的 AUG11 实体素材；目录中的 URL 因而会 404。`origin/integration/aug11` 的树记录包含对应路径，但该 partial clone 缺少 blob。
- 已严格按“不 pull/merge/rebase”要求，只尝试精确恢复 1 张验收缩略图；GitHub 443 连接超时，命令终止，未产生素材文件或分支改动。
- 在继续验证“画面点选家具 → 原位换搭”时，浏览器会话拒绝继续控制当前 localhost，未绕过限制。代码状态机和此前同类浏览器验证已覆盖该路径，但本轮最终视觉复验停在此处。
- 本轮不提交、不推送；只重新暂存本文档和 `web/prototype/pages/my-home/index.html`，不额外暂存 catalog 或其他任务文件。

## 15. 真实商品库恢复后的状态（2026-08-09，覆盖第 14 节素材限制）

- 第 14 节所述“工作树没有 AUG11 实体素材”已解决：178 项目录需要的商品缩略图和模型现已回到工作树。
- `my-home` 推荐卡加载真实 `/prototype/assets/renders/<id>.png`；轮廓只保留为网络/文件异常时的不可见底层容错，不再作为正常商品图展示。
- 169 个标准商品使用原商品库 GLB，9 个补充商品使用原 demo-backend GLB；商品媒体与 `origin/integration/aug11` 的 708 个文件 hash 全部一致。
- 灵感库共享资产层现为 178 个唯一商品，因此推荐、灵感库、收藏与我的家使用同一批 AUG11 商品 ID 和真实媒体。
- Feed 视频、原版 poster、原版包工球动画和 `/asset-cdn` 兼容资源也已接回；此前临时错配 poster 与非原版兼容动画均已撤回。

## 16. AI 搭配助手、转发与推荐 API 最新交接（2026-08-10，以本节为准）

### 分支与基线

- 当前功能分支：`agent/pr14-safe-copy-20260806`。
- 当前提交前 HEAD：`7ab6ee26b220ad819c1f269e5b9380b924c4c94f`。
- 联调负责人提供的新基线：`integration/aug11` @ `392dae3382da5f2506af7c117fa67d60a06ba0c8`。
- 本任务未执行 pull、merge、rebase，未修改 `integration/aug11` 或 `main`，也未把旧功能分支整体合入联调分支。

### 已完成功能

- `my-home` 编辑场景内提供包工球 AI 搭配助手：冷启动双入口、空间推荐、点选家具后的同类换搭、自由文本问答、主动推荐、统一商品卡、收藏和试摆。
- 冷启动双入口直接使用已确认的参考图片视觉，左右按钮继续复用现有 `空间推荐` / `单品换搭` 状态机。
- 推荐卡统一保留 `收藏` / `试摆`；详情使用居中弹层。试摆支持临时态、撤销恢复、确认留下；留下时自动写入共享收藏集合。
- 页面初始化读取 `web/prototype/data/aug11-catalog.json`，失败时保留内置资产 fallback；推荐、收藏和试摆使用同一批 AUG11 ID。
- 前端入口与自由文本已接到 `POST /api/recommendations`；接口返回 `clarificationRequired` 时在对话中显示追问，正常结果复用原推荐卡，`换一换` 携带 `nextSeenItemIds`。
- 新增本地推荐服务：支持 `proactive / space / replacement`、178 项目录召回、已看去重、同类过滤、规则排序和 `trialAvailable`。
- DeepSeek Chat Completions 代码已接入：只从 `.env` 读取 `DEEPSEEK_API_KEY`，模型由 `DEEPSEEK_MODEL` 配置，开关为 `RECOMMENDER_LLM_ENABLED=true`；调用失败自动回退规则推荐。
- 锁定态新增 `编辑` 与 `转发` 两个按钮。转发按钮打开好友选择面板，可选择封面和好友，并写入现有聊天分享消息结构。

### 主要修改文件

- `web/prototype/pages/my-home/index.html`
- `web/prototype/pages/my-home/assistant-entry-reference.png`
- `backend/app/recommendations.mjs`
- `backend/app/recommendations.test.mjs`
- `serve-nocache.mjs`
- `.env.example`
- `AI_RECOMMENDER_HANDOFF_COORDINATOR.md`

### API、数据库、共享组件与数据结构影响

- API：新增 `POST /api/recommendations`。请求字段包括 `mode/query/room/selectedItemId/targetCategory/styles/colors/seenItemIds/limit`；响应包括 `clarificationRequired/clarificationQuestion/intent/recommendationSetId/items/nextSeenItemIds/strategyVersion/catalogSize`。
- 数据库：未新增或修改数据库表；推荐目录读取现有静态 JSON。
- 共享组件：未修改 React/Feed 共享组件；收藏仍复用 `asset-library-data.js` 暴露的共享收藏集合。
- 数据结构：前端助手状态增加远端推荐结果、已曝光 ID、澄清问题和加载状态；项目 placement 主结构未改变。

### 测试结果

- `node --check backend/app/recommendations.mjs`：通过。
- `node --test backend/app/recommendations.test.mjs`：4/4 通过。
- `my-home/index.html` 模块脚本 `node --check`：通过。
- 本地规则推荐 HTTP 曾返回 200，并验证 `catalogSize=178`、replacement 同类过滤和 `trialAvailable`。
- DeepSeek 真实调用尚未完成：当前工作区没有真实 `.env`，因此运行时会标记 `intent.source=rules` 并安全回退；不得把聊天中出现过的密钥写入仓库，演示前应轮换密钥并在本地 `.env` 注入后重启 `serve-nocache.mjs`。

### 未完成内容与依赖

- 需要演示环境负责人创建本地 `.env`、注入有效 DeepSeek 密钥并确认实际可用模型名称，然后重启 5182 服务做一次真实 LLM 请求验证。
- 分享面板的“分享封面”模块此前被要求删除，但随后被最高优先级 LLM/API 接线任务中止，本轮未删除。
- 分享好友消息依赖现有聊天页读取同一消息存储；联调负责人迁移时需与聊天任务一起验证。
- 当前仓库是 mixed worktree，Feed manifest、Discover、小火人、户型实验、商品媒体等大量暂存或未跟踪文件属于其他任务，不得随本功能分支整体提交。

### Git 发布说明

- 只允许提交本节列出的本任务文件；不得使用 `git add -A`。
- 当前 GitHub CLI 登录令牌无效，且本机访问 GitHub 曾出现 DNS 失败；若推送失败，应保留本地提交并由联调负责人重新认证后推送该功能分支。
