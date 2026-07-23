# 拍一张（photo→3D）联调交接

> 收件人：Amber（后端上云）/ 前端后续 ｜ 发件人：DreamHome 前端 ｜ 日期：2026-07-23
> 本次推送 = 拍一张补全能力接入 + 前端多项调优。以下标明**已完成**、**上云待配**、**已知未竟**。

---

## 一、本次推送包含什么

**后端（3 个文件，均属"给 realtime photo 端点补上离线管线本就有的补全能力"）**
- `backend/app/services/prepare.py`（**新增**）：`prepare_photo()` —— 单体化(抠图)→补全→单体闸→一致性闸，与离线视频管线 `pipeline/run.py` 同一套 SOP，面向实时单张照片。
- `backend/app/store.py`（改）：`_run()` 里 `kind=='photo'` 分支，在 `provider.submit` 前调 `prepare_photo`。
- `backend/app/providers/fal.py`（改）：TRELLIS 质量参数（`ss/slat_sampling_steps 25`、`mesh_simplify 0.9`、`texture_size 2048`）+ 多图重建 `image_urls` 分支（前端目前仍单图）。

**前端（`web/prototype/`）**
- `pages/capture/index.html`：接后端真接口、进度条平滑、结果页缩略图渲组件本身（**缩略图见"已知未竟"**）。
- `pages/discover/index.html`：源视频（原视频）覆盖层修复 —— 组件弹窗链接 icon → 原视频 → 返回键回到该组件弹窗。
- `pages/inspiration-library/index.html`、`pages/my-favorites/index.html`：户型类真 3D 卡片 + 可拖拽弹窗、`#viewer=` 返回重开、链接跳原视频。
- `pages/shared/template-preview-3d.js`：户型等距/俯拍渲染 + 可拖拽房间 `buildRoom()`。
- `assets/vendor/model-viewer.min.js`（**新增，935KB**）：离屏渲缩略图 + 弹窗 3D 用，fal 的 GLB 无 Draco/KTX2 故离线可用。

**不在本次推送里（务必别误传）**：`datasets/`（638MB 源数据集）、`backend/.env`（含 key，已 gitignore）、`backend/logs/`、`backend/.venv/`、`samples/*.glb`。

---

## 二、补全能力：上云待配（Amber）

补全链默认**关**（`ENHANCE_PROVIDER=off` → 原图直送 TRELLIS，与接入前零变化）。要真激活，云端需：

1. 起补全服务 `backend/segment_api.py`（:8002，wan2.7-image 抠图+补全）——**这是队友既有文件，别乱改**。它 `from rembg import remove`，需先 `pip install rembg onnxruntime`（首次自动下 u2net 176MB）。启动时**内联传 `DASHSCOPE_API_KEY=`**（segment_api 是独立进程，不读 backend/.env）。
2. 主后端 `.env` 配：
   ```
   ENHANCE_PROVIDER=module
   ENHANCE_MODEL=wan2.7-image
   SEGMENT_API_URL=http://localhost:8002     # 云端换成 segment_api 的实际地址
   DASHSCOPE_API_KEY=<百炼 key>              # 两道闸(qwen-vl)用
   ```
   注意 `config._load_dotenv` 用 `os.environ.setdefault`（**首个赋值生效**），`.env` 里若已有空的 `DASHSCOPE_API_KEY=` 要直接改、不能追加。
3. 降级链已内建：无 rembg→抠图直通；无 DASHSCOPE_KEY→两道闸放行；补全失败→退回抠图。任一环失败都不阻断生成。

**成本/耗时**（demo 可接受，量产 Amber 按需回调）：每张补全调 1 次 wan（约 ¥0.2）+ 2 次 qwen 闸（各约 ¥0.008），rembg 抠图同步，单张比纯 TRELLIS 多 ~30–40s。可做"完整可见的照片跳过补全"分流。

**已本地验证**：椅子俯拍图跑完整链，预处理日志 `segmented/enhanced/solo/consistent 全 True`，出的 GLB **四腿齐全**（接入前只有 2 条前腿）。

**别乱改**：`segment_api.py` / `services/enhance.py` / `services/consistency.py` / `pipeline/run.py` 是队友后端域，本次只是**新增** `prepare.py` 并在 `store.py` 挂上，没动它们的管线。

---

## 三、⚠️ 已知未竟：拍一张结果缩略图（client-side 渲染不稳）

**现象**：用户拍照生成的组件，卡片缩略图有时仍是旧的 CSS 图元占位，而不是"组件本身的渲染图"。

**目标**：与平台资产一致 —— 512² 透明底、组件本身的图（平台侧是离线烘焙 `assets/renders/ast_*.png`）。

**现状与本次已做的修复**（`pages/capture/index.html` 的 `renderThumbnail`）：
- 用离屏 `<model-viewer>` 加载 GLB → `toDataURL` → 降采样 384² 存 `asset.thumbnail`。
- 已修**坑A**：元素放 `left:-10000px` 会被 model-viewer 的 IntersectionObserver 判为不可见→真机（硬件合成）跳过渲染→拿到空白。改成留视口内 `opacity:0;pointer-events:none;z-index:-1`。
- 已修**坑B**：渲染 ~1-2s 异步，用户秒点离开本页→pending 被杀→没写进库。加了跳转前 `await state.thumbReady`。
- `load` 后等两帧 rAF 再 `toDataURL`。

**为什么仍标"未竟"**：client-side 离屏 model-viewer 出图这条路**本质脆弱**，受设备 GPU / IntersectionObserver / 时序 / localStorage 配额影响，难保 100% 稳定；且 CDP headless 无法完全复现真机路径，回归验证有盲区。**model-viewer 在抖音小程序端也用不了**（要换 xr-frame），所以这条路对最终目标不是长久解。

**推荐的根治方向（择一，都比 client-side 稳）**：
1. **后端出缩略图（首选，跨端统一）**：photo→3D 成功后，后端顺带用同一 GLB 离屏渲一张 512² 透明 PNG（复用 `tools/render-thumbnails.mjs` 的渲染逻辑），`Job` 增加 `thumbnail_url`，前端直接用，和平台资产走同一套。彻底摆脱端上渲染。
2. **前端改 three.js 直渲**：库里弹窗 3D 已用 three.js+GLTFLoader，缩略图改用同一套显式 `renderer.render()` 后 `canvas.toDataURL()`（我们控渲染循环，无 IntersectionObserver 门），比 model-viewer 离屏稳，且和小程序 xr-frame 思路一致。

> 建议采纳方向 1：与平台资产缩略图同源、天然跨 web/小程序、前端零端上渲染负担。

---

## 四、其它未替换项（指针）

- **灵感库家具类 = 离线烘焙，非直连后端**；Amber 重生成的 30+ 资产（PR #10）还没替换进前端。交付方式与烘焙链路详见同目录 **`frontend-asset-reintegration-request.md`**（需要 Amber 交付真实 GLB 二进制 + `asset.json`）。

---
有疑问在本文件对应处回我即可。
