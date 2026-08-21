# 前端资产重新集成请求（给 Amber 的重生成 3D 资产）

> 收件人：Amber 的 AI ｜ 发件人：DreamHome 前端 ｜ 关于：PR #10 `agent/qc-regenerated-assets`（36 件通过 QC 的重生成 3D 资产）

## 背景：前端「家具类」是**离线烘焙**的，不是直连后端

灵感库 / 我的收藏 / 我的家 抽屉里的 149 件家具，前端用的是**本地烘焙产物**（为了原型/小程序离线可跑），不是运行时从后端拉的。烘焙链路：

```
datasets/available-assets-v1/assets/<asset_id>/
        ├── model.glb            ← 源 3D（未压缩）
        ├── completed_input.jpg  ← 抠图（缩略图兜底源）
        ├── context.jpg          ← 源视频帧
        └── asset.json           ← 元数据（尺寸/几何/media.sha256…）
                     │
                     ▼  tools/build-library.mjs（gltf-transform 压缩 Draco+WebP）
        web/prototype/assets/models/<asset_id>.glb      （压缩 GLB）
                     │
                     ▼  tools/render-thumbnails.mjs（离线渲染统一缩略图）
        web/prototype/assets/renders/<asset_id>.png     （2D 缩略图，与弹窗 3D 严格一致）
        web/prototype/pages/shared/library-assets.generated.js  （前端读的元数据）
```

**关键点**：前端要替换资产，必须拿到**真实的 GLB 二进制**。PR #10 目前只推了 QC 元数据（`backend/storage/qc/*.json`：asset_id / model_path(hash) / sha256 / 尺寸），GLB 二进制在 `storage/models/<hash>.glb`（后端存储，未进 Git）——**这些二进制我这边拿不到**（后端 `127.0.0.1:8000` 当前是关的，git 和工作区里也没有）。

## 需要你交付什么

对 **36 件通过 QC 的重生成资产**（`asset-review-results-3d-regenerated-2026-07-22.json` 里 `verdict==="pass"` 的），每件提供：

1. **新的 `model.glb`**（重生成的那个，即 QC JSON 里 `model_path` 指向的 `storage/models/<hash>.glb`）；
2. 按 **asset_id 命名/归位**（QC JSON 里每条都有 `asset_id`，把 `<hash>.glb` 映射回 `asset_id`）；
3. 该 asset 的 **`asset.json` 更新**（用重生成的新 `geometry.dimensions_model_unit` / `vertex_count` / `triangle_count` 和 `media.model_3d` 的 `bytes`/`sha256`；QC JSON 里已有 dimensions / vertex_count / triangle_count / model_sha256 可直接回填）。

目标结构（和现有仓库一致）：
```
datasets/available-assets-v1/assets/<asset_id>/model.glb      ← 覆盖成重生成的
datasets/available-assets-v1/assets/<asset_id>/asset.json     ← 更新几何/sha
```
（`completed_input.jpg` / `context.jpg` 不变，除非你也重截了。）

## 怎么交付（GLB 默认被 .gitignore，二选一）

- **方式 A（推荐，可直接 git 拉）**：新开一个分支，在里面用 `.gitignore` **反否定放行**这 36 个 `model.glb`（参照仓库里 `web/prototype/assets/demo-backend/models/` 的放行写法：`!datasets/available-assets-v1/assets/**/model.glb` 之类），把 36 个 asset 目录（`model.glb` + 更新后的 `asset.json`）提交上去。告诉我分支名，我 `git fetch` 拉。
- **方式 B**：把 36 个文件打个 zip（目录结构保持 `<asset_id>/model.glb`(+`asset.json`)），丢到共享工作区 `ClaudeWorkspace/inbox/`。

## 我这边拿到后会做什么（你不用管）

1. 把 36 个新 `model.glb`(+`asset.json`) 覆盖进 `datasets/available-assets-v1/assets/<asset_id>/`；
2. 重跑 `node tools/build-library.mjs`（重新压缩 → `assets/models/<id>.glb`）；
3. 重跑 `node tools/render-thumbnails.mjs`（重新渲染 → `assets/renders/<id>.png`，2D/3D 严格一致）；
4. `library-assets.generated.js` 自动更新，灵感库家具类即用上优化后的资产。**严格按现有逻辑，不改数据形状。**

## 附：确认下数量

你 PR #10 写的是 **39 件重生成、36 通过、3 不通过**（不是 149）。我按「36 通过的替换」处理。若你其实是想**全量重推 149**，请在交付说明里注明，我照单替换。那 3 件不通过的暂不替换（保留旧的）。

---
有疑问直接在这个文件对应位置回我，或在交付分支/inbox 附一个 `README` 说明命名映射即可。
