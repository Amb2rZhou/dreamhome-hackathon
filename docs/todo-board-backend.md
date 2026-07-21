# 后端 To Do 板(多 Agent 共享)— 2026-07-21

> 协议:每个 Agent 开工先通读本板;每完成一步用 `cat >>` 追加一行
> `- [x] [A# HH:MM] 做了什么`;发现跨界问题写到「协调区」。
> 硬规则:
> - 用 `backend/.venv/bin/python`;改了 Python **不要重启 :8000 服务**,在协调区标 `needs-restart`,主会话统一重启
> - 禁改:`backend/segment_api.py`、`prototype/`、`gpu/`
> - `backend/review/rebuild.html` 只有 A2 可改;`backend/app/routers/assets.py` 只有 A3 可改;
>   `backend/app/main.py` 谁都不改(新 router 在协调区标「待注册」,主会话统一加)
> - 不 git commit/push(A6 只做分析)
> - DB: `backend/storage/dreamhome.db`(sqlite,直接读写)

## 目标一:视频圈选与 3D 资产生成

### T1+T2 [A1] 帧级资产识别 + 圈选对比 API
新文件 `backend/app/routers/frame_assets.py`:
- `GET /api/videos/{vid}/assets_at?t=` → `{items:[{asset_id,name,bbox:[x,y,w,h]归一化,source:"track|annotation",status,glb_url,thumb_url}]}`
  数据源:tracks.frames_json 按 t 插值 bbox(取该资产绑定 track 中 |t-frame.t|<=0.75 最近点)+ storage/annotations/<vid>.json 里 status=generated 的手动标注(bbox 固定)
- `POST /api/videos/{vid}/match_annotation` body `{t,bbox}` → `{matched:{asset...}|null, iou}`;IoU>0.35 即命中,取同刻已有资产逐个算
- curl 自测两条视频:vid_40734d7f2e6c(有手动标注)、vid_5f32a0ac954a

### T3 [A2] rebuild.html 视频叠加层 + 圈选分流
- 视频 timeupdate/seeked 时调 T1 接口(节流 500ms,缓存按整半秒),在 annCanvas 上画**绿色**框(已生成资产,标名字);现有红框(缺失标注)不变
- 圈选保存(commitAnn)前先调 T2:命中 → toast「画面里这件已生成:<名>」+ 在标注列表插入一条 status=generated、asset_id 关联的只读行(不触发生成);未命中 → 走现状 pending 流程
- API 契约见 T1(若 A1 未就绪,先按契约写、mock 数据自测)

### T4 [A3] 资产↔视频回链(首页资产卡跳视频)
- `backend/review/index.html` 资产卡若有 source.video_id:加「来源 @{t_best}s」链接 → `/review/video.html?v=<vid>&t=<t_best>`(video.html 支持 ?t= 秒级 seek,不精确到帧即可;若 video.html 无 ?t= 支持则顺手加上,该文件归 A3)
- assets API 出参已含 source(确认即可,不够再补)

## 目标二:场景装配规则与专项库

### T5 [A4] 资产级 mount 挂载属性
- 品类→挂载映射:灯具(吊灯/吸顶灯/吊扇)→ceiling;挂画/挂钟/壁饰/空调挂机→wall;地毯/门垫→floor;摆件/装饰(小型)→surface;家具默认 floor
- 写进 `app/services/labels.py` 的产出(labels_json 增加 "mount" 键,extract_labels 后处理规则映射即可,不必改提示词)
- 新工具 `backend/tools/backfill_mount.py`:按映射回填存量资产 labels_json.mount,跑一遍并打印统计
- rebuild.html 侧接入不归你:在协调区写清「资产 labels.mount 已就绪」即可

### T6 [A5] 专项库服务端化(窗户/吊顶/地板/光线/窗外景观)
- 统一 manifest:`backend/storage/libraries/{windows,ceilings,floors,lights,views}.json`
- 新 router `backend/app/routers/libraries.py`:`GET /api/libraries/{kind}` 返回对应 manifest(kind 白名单)
- 迁移现状:views ← storage/textures/views/manifest.json(保留原文件,libraries 版为准);floors ← textures/floor/wood.png(+程序化占位说明);lights ← rebuild.html 里 LIGHTS 四预设(抄成 JSON,字段同名);windows ← 页面窗样式(grid/plain)+类型(window/bay/floor)参数化描述;ceilings → 2-3 个参数化预设(双级线脚/单级/无吊顶,字段:rings:[{depth,h}])
- 专项库资产标记:各 manifest 条目带 "special": true 约定,供 T7 过滤参照;页面接入契约写协调区,不改 rebuild.html

### T7 [A3] 首页常规资产库过滤专项资产
- routers/assets.py 列表接口加参数 `exclude_special=true`(默认 true):过滤 labels.category ∈ {窗户,吊顶,地板,光线,窗外景观} 或 labels.special==true 的资产
- 现库里若无此类资产,写好过滤逻辑+单测 curl 即可

### T8 [A3] size_prior PATCH 500 修复
- 病根:`AssetOut.size_prior` 响应模型是 list 类型,dict 写入序列化失败(DB 写入已成功)
- 改 schema 兼容 dict|list(Optional[Union[dict,list]]),curl 回归:PATCH {"size_prior":{"w":0.8,"h":2.3,"d":0.55}} → 200 且回读一致

## 工程

### T9 [A6] 本地 vs GitHub 对账(只分析,不提交)
- origin=https://github.com/Amb2rZhou/dreamhome-hackathon.git,当前分支 feat/mascot-ip-upgrade 领先 origin/main 19 commits,工作区 50 个脏/未跟踪文件
- 产出:分组清单(该提交/不该提交:logs/、.env、密钥、临时文件),按 handoff 规则(严禁 checkout,提交走 `git worktree add /tmp/dh-main origin/main` + rsync + `push origin HEAD:main`)写出可执行的提交方案,列在本板末尾,等 Boss 拍板后才执行
- 检查远端 main 最新 commit 与本地 19 个的关系(有无别人新推的要先并)

## 协调区

- (主会话) 现网 :8000 进程是旧代码(不含 review_qc/size_prior 修复),全部 Agent 完工后统一重启
- (主会话) 待注册 router:frame_assets(A1)、libraries(A5) → 完工后我在 main.py 统一加
- (A4) 资产 labels.mount 已就绪(全量 159 件已回填:ceiling 15 / wall 15 / surface 18 / floor 111),前端可用 asset.labels.mount 初始化挂载(目前 rebuild.html 的 item.mount 手写,后续可改读这个)。规则单一事实源:`app/services/labels.py` 的 `assign_mount(labels)`;新资产走 extract_labels 自动带 mount。labels.py 有改动,标 needs-restart(:8000 重启后生效)

- (A2→A1) T3 前端接入说明:
  - GET /api/videos/{vid}/assets_at?t=<半秒桶值> — 页面按 Math.round(t*2)/2 取桶,同桶只请求一次并缓存;期望 200 + {items:[{asset_id,name,bbox:[x,y,w,h]归一化,...}]};非 200/异常前端静默(该桶缓存空)。缓存不过期:同一 vid 会话内资产集若中途新增,需刷新页面才能看到新绿框(hackathon 可接受)
  - POST /api/videos/{vid}/match_annotation body {t,bbox} — 期望 {matched:{asset_id,name,...}|null,iou};前端只读 matched.asset_id/name,命中即存 status=generated+asset_id 的标注(照常 PUT /api/annotations 持久化),请确保补全/生成流水线跳过 status=generated 的条目
  - 调试:rebuild.html?v=<vid>&mockassets=1 走内置 mock(两个绿框,其一随时间横移;在 mock 床框 [0.18,0.55,0.34,0.30] 上圈选可测命中分流),接口注册后去掉参数即走真实 API

## 进度流水

- [x] [主 16:xx] 板子建立,6 个 Agent 启动

- [x] [A1 20:22] T1+T2 完成:新建 backend/app/routers/frame_assets.py(assets_at + match_annotation),TestClient 自测两条视频全过(vid_40734d7f2e6c t=2.6 出飘窗沙发/annotation 源;vid_5f32a0ac954a t=5.5 出三人沙发等 6 件/track 源;IoU 命中/未命中/400/404 边界均过),needs-restart 不涉及(未改已加载模块)
- [x] [A1 20:22] (协调区)待注册 router:frame_assets(from .routers import frame_assets; app.include_router(frame_assets.router)),prefix=/api/videos,不与 videos.py 路由冲突
- [x] [A1 20:22] (协调区→A2)接口契约样例:
  GET /api/videos/{vid}/assets_at?t=2.6 → {"items":[{"asset_id":"ast_cf21f0f0a02c","name":"飘窗上放的小沙发…","bbox":[0.2905,0.4288,0.3954,0.1322],"source":"annotation","status":"ready","glb_url":"http://localhost:8000/storage/models/0ce5….glb","thumb_url":"http://localhost:8000/storage/thumbs/vid_40734d7f2e6c_m1.png"}, …]}(bbox 归一化 [x,y,w,h];source="track|annotation";同 asset 多路命中去重取时间最近;按 |dt| 升序;只出 status=ready)
  POST /api/videos/{vid}/match_annotation body {"t":2.6,"bbox":[0.31,0.44,0.40,0.13]} → {"matched":{…同上单个条目…},"iou":0.7819};未命中(IoU<=0.35)→ {"matched":null,"iou":0.0};时间窗 ±0.75s
- [x] [A5 20:23] T6 完成:storage/libraries/ 五个 manifest(windows/ceilings/floors/lights/views)+ 新 router app/routers/libraries.py(GET /api/libraries/{kind},白名单五种,其余 404);TestClient 自测 5 kind 全 200、非法 kind 404 全过
- [x] [A3 17:05] T8 验证:schemas_lib.py AssetOut.size_prior 已是 Optional[Union[List[float],dict]](代码已修,现网 500 因 :8000 跑旧代码)。TestClient 回归 PATCH ast_665e55cee687 {"w":0.8,"h":2.3,"d":0.55} → 200,GET 回读一致。无需再改,重启即生效。
- [x] [A3 17:06] T7 完成:assets.py 列表接口加 exclude_special: bool = True,过滤 labels.category ∈ {窗户,吊顶,地板,光线,窗外景观} 或 labels.special 真值。sqlite3 验证现库 150 条无专项品类/special 标记,默认过滤对 rebuild/audit 零影响(默认 150 == off 150)。needs-restart
- [x] [A3 17:08] T4 完成:index.html 资产卡回链改为契约格式 /review/video.html?v=<vid>&t=<t_best>(保留 asset_id 参数供自动开面板),文案「▶ 来源 @ {t_best}s」;video.html 已有 ?t= seek(loadedmetadata 后 currentTime+pause),补了 ?v= 参数识别(video_id 兼容保留)。TestClient 确认两页 200、149/150 资产带 source.video_id。
- [x] [A5 20:25] (协调区)libraries router 待注册:from .routers import libraries; app.include_router(libraries.router),prefix=/api/libraries,与现有路由无冲突
- [x] [A5 20:25] (协调区→前端/A2)专项库接入契约(GET /api/libraries/{kind},统一返回 {"kind","items":[...]},条目均带 special:true,不进首页常规库):
  - lights:条目 {name,label,bg,amb:[color,intensity],sun:[color,intensity,[x,y,z]],fill:[color,intensity],pt:[color,intensity],view} — 字段与 rebuild.html 里 LIGHTS 同名同结构,唯一差异:颜色是十六进制字符串 "0xfff2e2",前端 parseInt(c,16) 即可还原;4 预设 dusk/day/night/overcast。后续 rebuild.html 可把硬编码 const LIGHTS 换成拉这个接口
  - windows:条目 {name,label,style:grid|plain,type:window|bay|floor,defaults:{width,height,sill}} — 6 条(2 样式×3 类型);defaults 参考自 btnAddWin 默认(window 1.2/1.4/0.9)与现网场景(bay 1.7/1.95/0.45、floor 2.0/2.5/0);「新增窗户」下拉可改成拉这个列表,选中后用 defaults 生成 cfg.windows 条目
  - ceilings:条目 {name,label,rings:[{depth,h},...]} — double(双级线脚 [0.32/0.15, 0.40/0.07])、single(单级 [0.30/0.12])、none(rings:[] 无吊顶);对应 rebuild.html moldRing(depth,h) 逐圈调用
  - floors:条目 {name,label,url,bump?} — oak_video(url=/storage/textures/floor/wood.png,bump:true 需配凹凸)、procedural(url:null 表示走页面程序化木纹降级)
  - views:条目 {name,label,url,raw_url,enhanced} — 与 storage/textures/views/manifest.json 字段一致(原文件保留,libraries 版为准);loadViews() 可直接改拉 /api/libraries/views 后读 .items

- [x] [A2 20:24] T3 完成:rebuild.html 已接 assets_at 绿框叠加(半秒桶节流+Map缓存+静默失败)与 match_annotation 圈选分流(命中→status=generated+asset_id 存标注,不进补全;未命中/异常→照旧 pending);node --check 语法通过,?mockassets=1 mock 自测通过,静态页已生效无需重启
- [x] [A4 20:15] T5 映射函数落地:labels.py 新增 assign_mount(labels)→ceiling|wall|surface|floor,extract_labels 所有返回路径(含缓存/mock)自动打 labels["mount"];sub 优先、features/tags 兜底(兜底层收紧:悬挂式家具→wall、摆件描述词需 size_class=小,空调柜机/立式→floor)
- [x] [A4 20:18] T5 回填完成:tools/backfill_mount.py 跑全量 159 件(db 已备份 dreamhome.db.bak-mount),统计 ceiling 15 / wall 15 / surface 18 / floor 111;sqlite3 抽查通过:吊扇/吸顶灯=ceiling,挂画/空调/挂饰=wall,音乐盒=surface,双人床/门垫=floor,无 NULL

- [x] [A6 20:30] T9 对账完成:fetch 后远端 main 又前进(4a85bc5→0767e1f,PR#4 已并);敏感串扫描全部候选文件干净;方案见板末,等 Boss 拍板后执行

---

## T9 提交方案(A6,2026-07-21 — 等 Boss 拍板后执行,A6 本人不执行任何 git 写操作)

### 一、对账结论

**分支关系:本地 feat/mascot-ip-upgrade 领先 19、落后 15(分叉点 8dddf4b)。**

- 落后的 15 个远端 commit = 后端量产链路 v4 系列(2208e59…fdee858/4a85bc5,从别的 worktree 直推 main)+ PR#3/#4(原型页面,PR#4 今天 12:12 刚并)。
- 领先的 19 个本地 commit:`git cherry` 无一在远端有等价 patch,但**内容上后端部分已被远端 v4 覆盖**——证据:工作区 pipeline/run.py、gpu/server*.py、segment_api.py、enhance.py、douyin_dl.py、.env.example、两份 SOP 文档等与 origin/main **字节级一致**(本地"脏"只是 HEAD 太旧)。真正只存在于本地的是 **16 个包公球原型 commit**(六态组件 mascot.js/css、姿态帧引擎、压缩素材)——origin/main 还在用旧 3MB 大图、无共享组件。
- **冲突风险(高)**:PR#3/#4 与本地 mascot commit 改了同一批原型页(my-home/capture/draw/discover/inspiration-library/main-interface/asset-library-data.js/mascot 素材)。直接 push 本地分支会回退 PR#4 的"我的家迭代"。mascot 合入必须人工解冲突,单独走 PR(见第四节),**不并入本次后端文件同步**。
- 远端无未合 PR(4 个全 MERGED);孤儿分支 claude/dreamhome-hackathon-demo-v2ow3v 是 07-13 旧 SAM2 试验,可忽略/删。

### 二、工作区 53 项分类

**A. 无需提交(31 项,内容与 origin/main 完全一致,同步 HEAD 后自然消失):**
.env.example、app/routers/videos.py、app/routers/tracks_fix.py、services/{enhance,cache,consistency,track}.py、pipeline/run.py、segment_api.py、enhance_custom.py、tools/{douyin_dl,adopt_track_job,augment_categories,preview_clusters,rebind_tracks,regen_assets,repair_conflicts,retry_failed,verify_bindings}.py、review/{audit,fix}.html、gpu/{server,server_gen3d,server_track}.py、docs/{asset-library-plan,sop-asset-production,sop-manual-fix,pipeline-explainer,handoff-2026-07-19,handoff-2026-07-21-rebuild}.md

**B. 应提交(今天各 Agent 的真实增量,相对 origin/main):**
- 新 router:frame_assets.py(A1)、libraries.py(A5)、annotations.py、scenes.py、review_qc.py、agent.py
- 改动:services/labels.py(+61 行,mount 映射)、routers/assets.py(+23,exclude_special+size_prior)、schemas_lib.py(+6)、db.py(+3)、main.py(+9,router 注册)
- review 页:rebuild.html(新,66KB)、approve.html(新)、video.html(?v= 支持)、index.html(来源链接)
- tools:backfill_mount.py、gen_from_annotations.py、gen_view_textures.py、gen_floor_texture.py
- docs:handoff-2026-07-21-qc.md(勾账 12 行)
- 小 JSON:storage/libraries/*.json(5 个 manifest)、storage/scenes/*.json(2 个)——**当前被 backend/.gitignore 的 `storage/` 整体屏蔽**,需把该行改为 `storage/*` + `!storage/libraries/` + `!storage/scenes/`(或 git add -f,不推荐)

**C. 不应提交:**
- backend/logs/(uvicorn.log、usage.jsonl、trial log,运行产物)
- package-lock.json(仅 oxlint 1.73→1.74 无关抖动,建议主会话 `git restore package-lock.json` 丢弃)
- backend/.env(已被 ignore,未进 status,确认安全)

**D. 拿不准(请 Boss 定):**
1. review/_qc_glb.html(845B,下划线前缀临时 QC 页)——建议不提交
2. docs/todo-board-backend.md(本协作板,快照有存档价值但持续变动)——建议收尾时一并提交
3. app/routers/agent.py——无密钥,但它是"HTTP 无鉴权触发本机 headless claude"的桥,public 仓库公开代码没问题,**部署时须限内网/加鉴权**,建议提交但在 docs 标注

**敏感扫描:全部 B/D 类文件 + storage JSON grep(sk-/AKID/Bearer/ghp_/JWT/api_key/非本机 IP:端口)零命中**;.env.example 只有 `<GPU公网IP>`、`<向Boss索取>` 占位符。可安全进 public 仓库。

### 三、后端增量提交步骤(worktree 法,严禁 checkout 本地分支)

前置:主会话先在 main.py 注册 frame_assets、libraries(当前 main.py 只注册了 review_qc/annotations/agent/scenes),并等 A1-A5 全部报完工、页面自测过再动手。

```bash
git -C /Users/zhouzhile/dreamhome-hackathon worktree add /tmp/dh-main origin/main --detach
# 从主工作区把 B 类文件按下面 4 个 commit 分批 cp 进 /tmp/dh-main(保持相对路径)
# 每批: cd /tmp/dh-main && git add <该批文件> && git commit
cd /tmp/dh-main && git push origin HEAD:main
git -C /Users/zhouzhile/dreamhome-hackathon worktree remove /tmp/dh-main
```

4 个 commit(中文,风格随近期 log):
1. `feat(api): 帧级资产识别+圈选IoU对比(frame_assets); 标注/场景/审核/agent桥四router注册`
   → app/routers/{frame_assets,annotations,scenes,review_qc,agent}.py、app/main.py、app/db.py
2. `feat(review): rebuild场景重建页+approve人工审核页; 资产卡来源跳转统一?v=&t=`
   → review/{rebuild,approve,video,index}.html、tools/gen_from_annotations.py、backend/.gitignore(storage 例外)、storage/scenes/*.json
3. `feat(assets): 资产mount挂载属性+专项库服务端化(五类manifest)+size_prior兼容dict+首页过滤special`
   → services/labels.py、routers/{assets,libraries}.py、schemas_lib.py、tools/{backfill_mount,gen_view_textures,gen_floor_texture}.py、storage/libraries/*.json
4. `docs: QC handoff勾账+后端协作板归档`
   → docs/handoff-2026-07-21-qc.md(+todo-board-backend.md 若 Boss 同意)

### 四、包公球 mascot 分支(单独议,不随本次)

16 个原型 commit 只在本地,有独立价值(六态组件+素材压缩,远端还是 3MB 大图)。建议:
```bash
git worktree add /tmp/dh-mascot origin/main --detach
cd /tmp/dh-mascot && git checkout -b feat/mascot-rebase && git merge feat/mascot-ip-upgrade
# 冲突集中在 6-7 个原型页:backend/gpu/docs 侧一律取 origin/main(theirs);
# 原型页人工合(保 PR#4 的我的家迭代 + 本地 mascot 接入),完了 push 开 PR 走评审
```
本地 3 个后端 commit(量产v3/GLB修复/链路实测)内容已被远端 v4 覆盖,合并时全取远端即可,无需抢救。

**以上全部:等 Boss 拍板后执行。**
- [x] [主 20:32] 集成完成:frame_assets/libraries 已注册 main.py,:8000 已重启;联测全绿(assets_at/match/5个libraries/size_prior PATCH 200/exclude_special);修复 Labels 响应模型缺 mount/special 字段导致 API 丢键的问题
