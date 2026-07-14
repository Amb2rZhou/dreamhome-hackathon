# DreamHome Frontend Prototype

静态交互原型，默认入口：

- [灵感库（产品入口）](./pages/inspiration-library/index.html)
- [我的家](./pages/my-home/index.html)

GitHub Pages 发布地址：`https://amb2rzhou.github.io/dreamhome-hackathon/prototype/`

## 本地预览

从仓库根目录执行：

```bash
python3 -m http.server 5178 --directory web
```

在浏览器打开 `http://127.0.0.1:5178/prototype/`。请通过 HTTP 服务器预览，不要直接打开 HTML 文件，以便模块、缓存和相对资源路径与 Pages 环境一致。

## 目录约定

- `pages/inspiration-library/`：平台级组件目录与用户收藏。
- `pages/shared/`：共享导航、平台组件目录和收藏状态工具。
- `pages/draw/`、`pages/capture/`、`pages/discover/`：三个生成入口原型。
- `pages/my-home/`：3D 场景、资产摆放和 `HomePlacement` mock 交互。

各页面目前均为静态原型；页面间应使用相对链接，不能使用 `/pages/...` 这类根路径，以支持 GitHub Pages 的 `/dreamhome-hackathon/` 发布前缀。

## Mock 与 API 对接

“我的家”默认以 mock 任务服务演示 `queued`、`processing`、`ready`、`failed` 状态及本地 placement 恢复。GitHub Pages 只承载静态文件，不能直接代理 FastAPI 的 `/api`；接入后端时应使用明确配置的绝对 API base URL，不应把密钥或内部地址提交到前端代码。

## 团队协作

1. 从 `main` 创建功能分支，修改 `web/prototype/` 中与功能相关的页面和资源。
2. 本地运行静态服务器，检查交互、浏览器 Console 与 Network。
3. 提交 PR，说明影响的页面、交互变化与截图或录屏。
4. 合并到 `main` 后，现有 GitHub Pages workflow 会自动重新部署 `web/`。

GitHub Pages 是共享的稳定演示链接，不是实时协同编辑器。需要即时共同修改时，使用 GitHub Codespaces 或 VS Code Live Share，并由一人运行上述本地预览命令。
