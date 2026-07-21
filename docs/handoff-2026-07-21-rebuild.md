# 交接文档 ②:户型重建 demo session(2026-07-21)

> 目标:做出「真实户型 + 摆上视频里生成的 3D 组件」的 demo——用视频产出的 GLB 资产重现整套房子。
> 不需要 GPU、不依赖质检 session,纯前端+数据活,可并行。Boss 习惯:先列选项再执行;先做一间房试产给 Boss 看,拍板了再铺全屋。

## 1. 目标拆解(Boss 原话意译)

1. 首选素材:**第一个视频 vid_58a7a1504281**(162s,37 件资产全部有 GLB,Boss 认可其质量),重现它对应房子的建模
2. 之后可复制到其他 5 条视频(资产见质检 session 交接文档 handoff-2026-07-21-qc.md 第 1 节)
3. 路线已和 Boss 讨论过,**倾向半自动**:按轨迹出现时间把资产分到房间(镜头段落≈房间),自动铺粗布局,再手动微调位置/朝向/缩放——比纯手摆省一半时间,比全自动 SLAM 靠谱

## 2. 可用数据

- DB `backend/storage/dreamhome.db`:
  - assets:glb_url(本地 /storage/models/*.glb,均已修过材质发黑问题)、thumb_url、name、labels_json(含 sub/tags)、source_json(video_id/track_id/t_best)
  - tracks:frames_json=[{t,bbox归一化}],可推每件家具在视频里出现的时间段和画面位置(bbox 大小≈距离远近的弱信号)
  - 37 件清单:3张床/4沙发/3餐桌/茶几边几/电视+电视柜/洗衣机×2/灯具若干/床头柜/衣柜边柜等——够摆出客厅+卧室×2+餐厨+阳台
- 视频文件 `backend/storage/videos/vid_58a7a1504281.mp4`(对着摆的参照)
- 后端 :8000 已挂 /storage 静态服务,GLB 可直接 `<model-viewer>` 或 three.js GLTFLoader 加载
- 参考页面风格:`backend/review/audit.html`(深色系)、`prototype/` 目录是队友的 Vite 原型(D风+吉祥物包公球),demo 若要融入产品原型可参考其风格,但**别改 prototype 里队友的组件**

## 3. 建议架构(供参考,可自行判断)

- 单页 `backend/review/rebuild.html`(或 backend/review/scene.html):three.js + GLTFLoader + OrbitControls
- 户型底座:先用简化方案——平面矩形房间组(客厅/餐厨/卧室A/卧室B/卫生间阳台),墙体用挤出的白色盒体,地板浅木色;户型尺寸对着视频估
- 半自动初摆:脚本读 DB,按 track 时间段聚类分房间(镜头段落切分),每房间内按品类给默认位置(床靠墙、餐桌居中、灯吸顶),输出 layout.json
- 编辑器:点击选中→拖平移/旋转/缩放(TransformControls)→保存回 layout.json(localStorage 或 POST 存文件)
- Demo 呈现:一个「漫游/俯视」切换 + 点击家具高亮显示名字与来源时间点(呼应"从视频生成"的故事线)

## 4. 试产建议(先给 Boss 看再铺开)

第一步只做:客厅一间 + 5 件家具(三人沙发 ast_40ae0466aba8、茶几 ast_5e5eabafb19a、电视柜 ast_279a3b8e3809、电视 ast_2e0f65b42cfc、吸顶灯任一)自动初摆+可拖拽,截图/录屏发 Boss 拍板,再做全屋和其他视频。

## 5. 环境要点

- 本地后端: `cd backend && ./.venv/bin/uvicorn app.main:app --port 8000`(可能已在跑,先 `curl http://127.0.0.1:8000/api/videos` 探活;无 --reload,改 python 要重启,改 html 不用)
- 新页面直接放 backend/review/ 即自动被 /review 静态挂载
- 不需要 GPU 服务器(它现在是关的,别为这事开)
- git:本地分支被占用,严禁 checkout;要提交走 `git worktree add /tmp/dh-main origin/main` + rsync + `push origin HEAD:main`;仓库 public,别提交任何 IP/key
- 队友模块别动:backend/segment_api.py、prototype/ 内组件
- 值得留痕的结论追加 `~/.clawd/work/wiki/log.md`
