# DreamHome Web — 能力演示壳

纯静态单页应用：vanilla JS、无构建工具、PWA（可加主屏）。浏览器直连 fal.ai，无后端。
这个壳只为让四个 AI 能力原语「可演示」；正式 App 界面由队友负责。

## 运行

```bash
# 1) 一次性物料：自托管前端依赖 + 生成 PWA 图标（不入 git，可重生成）
node web/tools/setup-assets.mjs

# 2) 起一个「no-store」静态服务器（坑10：Chrome 对无头服务器的启发式缓存会让你调试旧代码）
#    任意能发 Cache-Control:no-store 的静态服务都行，例如：
npx --yes http-server web -c-1 -p 8123      # 或自写 no-store 服务器
```

打开 `http://localhost:8123`。

## 注入 fal key

key 不进代码。首次用 URL 片段注入，随后自动从地址栏抹掉并存 localStorage：

```
http://localhost:8123/#key=你的falkey
```

- 顶栏出现「fal 已连接」即成功。
- `?reset=1` 清演示数据（保留 key）；`?reset=all` 全清（含 key + GLB 缓存）。

## 五个 tab

| tab | 状态 | 说明 |
|---|---|---|
| 🖼️ 图生3D | ✅ | 选文件/拖拽/粘贴 → TRELLIS → 组件库 |
| 📷 拍照 | ✅ | `<input capture>` 相机 → 缩到 1024px → 同管线 |
| ✏️ 画画 | ⏳ 第二阶段 | 线稿 → flux 双发平面设计图 → 语音修改 → 3D |
| 📦 组件库 | ✅ | localStorage 存组件，点开全屏 model-viewer 预览带 AR |
| 🛋️ 3D空间 | ⏳ 第三阶段 | three.js 房间编辑器 + 语音指挥 + 手绘户型建墙 |

## 目录

```
web/
  index.html            壳：5tab + importmap（坑1：在首个 module 之前）
  manifest.webmanifest  PWA
  sw.js                 Service Worker（网络优先 + 缓存回退，离线可演）
  css/app.css           暖纸主题
  js/
    app.js              入口：key/reset、预热、tab 路由、SW 注册
    config.js           key 注入抹除、reset、品类先验
    fal.js              fal 队列客户端（超时+重试+预热+findMeshUrl）
    pipeline.js         图/照片 → 3D 共享管线
    progress.js         四步过程动画 + 计时器
    library.js          组件库（localStorage）
    glbcache.js         GLB 走 Cache API（坑4）
    imgutil.js          缩图 / 缩略图
    toast.js            轻量 toast
    tabs/*.js           五个 tab
  vendor/               自托管依赖（脚本生成，gitignore）
  icons/               PWA 图标（脚本生成，gitignore）
  tools/setup-assets.mjs  物料生成脚本
```

## fal 配方（实测）

- **图/照片 → 3D**：`fal-ai/trellis`，body `{image_url:"<dataURI>"}`，结果在 `model_mesh.url`（.glb）。
  热 16–25s，冷启动 ~54s → 启动时静默预热。
- 所有 fetch 带超时 + 重试（提交 20s×3、轮询 10s×4，AbortController），防弱网卡死占满连接池。

## 部署

`web/` 是纯静态目录，跑完 `setup-assets.mjs` 后可直接部署到 Vercel / Netlify / 腾讯云 COS。
中国大陆现场建议 COS（`*.myqcloud.com` 直连、免 ICP 备案）。

> 注：本仓库的云端会话 git 为只读，二进制物料未推入远端——克隆后请先跑 `setup-assets.mjs`。
