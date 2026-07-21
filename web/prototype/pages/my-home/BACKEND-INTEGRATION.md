# 「我的家」模块 · 前后端联调交接文档

> 面向：负责「我的家（my-home）」后端的同学 & 她的 AI。
> 目的：读完即可理解本模块前端架构，并知道**在哪几个明确的接缝上接入后端数据库/API**。
> 代码位置：`web/prototype/pages/my-home/index.html`（单文件，含全部逻辑）
> 依赖数据层：`web/prototype/pages/shared/asset-library-data.js`（全站共享的资产库）

---

## 0. TL;DR（最重要的三句话）

1. 本模块**已经预留好后端接缝**：所有数据访问都走一个 `homeSceneService` 抽象对象，现在指向 `MockHomeSceneService`（localStorage 假数据），只要把开关 `USE_MOCK_HOME_SERVICE` 改成 `false`，就切到 `HttpHomeSceneService`（已写好的 REST 调用骨架）。**你的核心工作 = 让后端实现这几个 REST 接口，并让返回体符合下文的数据契约。**
2. 3D 家具模型的接入点是资产对象上的 **`modelUrl` 字段**——前端用 `GLTFLoader` 加载它。你后端 `AssetOut.glb_url` 直接喂给这个字段即可，前端会自动用真实 GLB 替换占位几何体。
3. 资产库（家具/地板/墙纸/户型）来自 `asset-library-data.js`，目前是**静态数组 + localStorage 收藏**。这一层也要由后端 `/api/assets` 接管，字段映射见 §6。

---

## 1. 模块定位与技术栈

- **定位**：用户在这里把「灵感库里收藏的组件」摆进一套 3D 户型，生成/编辑属于自己的家。
- **技术栈**：原生 ES Module + Three.js（0.165，CDN importmap 引入），无构建、无框架。直接静态托管即可运行。
- **它消费谁的产物**：
  - 户型模板（内置 `TEMPLATES`，3 套：一室一厅/两室一厅/三室两厅）
  - 灵感库资产（`asset-library-data.js` 的家具/地板/墙纸/户型 + 用户在「画一笔/拍一张」生成的资产）
  - 用户收藏（`getFavorites()`）——**只有被收藏的组件才会出现在「我的家」的抽屉里**

---

## 2. 运行时架构：一个相位状态机

页面就是一个 `state.phase` 状态机（`updatePhases()` 按相位切换三块 DOM）：

```
setup ──(选模板/传图纸,点生成)──▶ submitting ──▶ polling ──(job ready)──▶ editor
  ▲                                     │                    │
  └──────────(取消/失败返回)─────────────┴──── error ◀────────┘（job failed）
```

- **setup**：选内置户型模板 或 上传平面图（PNG/JPG/WEBP）；也展示「继续编辑」的已保存住宅列表。
- **submitting / polling**：提交生成任务 → 轮询任务状态（进度条 + 包公球装修动画）。
- **editor**：Three.js 3D 编辑器。摆放/移动/旋转/缩放/删除家具，切换地板墙纸饰面，白天/黑夜，房间聚焦，分享。改动经 `saveSoon()`（360ms 防抖）持久化。

关键函数：`startGeneration()` → `pollJob()` → `initEditor()` → `createScene()`。

---

## 3. ★ 核心接缝：`homeSceneService`（后端主要工作在这）

代码见 `index.html` 约 235–257 行。**两套实现，一个开关。**

```js
const USE_MOCK_HOME_SERVICE = true;   // ← 联调时改成 false
const homeSceneService = USE_MOCK_HOME_SERVICE ? MockHomeSceneService : HttpHomeSceneService;
```

`HttpHomeSceneService` 已经写好了 fetch 骨架，你只要让后端实现这些接口 + 返回契约数据：

| 方法 | 现有 HTTP 调用 | 用途 | 你要提供的后端接口 |
|---|---|---|---|
| `submitHomeGeneration({templateId, drawingFile})` | `POST /api/home-generation`（multipart：`template_id` + `file`） | 提交「按模板或按图纸生成 3D 户型」任务 | 返回 `{ id, ... }`（任务句柄，至少含 `id`） |
| `getJob(job)` | `GET /api/jobs/{job.id}` | 轮询任务进度 | 返回 `{ status, progress, error?, result? }`，见 §4 |
| `listAssets()` | `GET /api/assets` | 拉取可摆放资产 | 见 §6（可对齐你现有 `/api/assets`） |
| `loadHomes()` / `saveProject()` / `deleteHome()` | 目前 HTTP 版是空实现 | 已保存住宅的增删查 | 见 §5，需要你补 REST |

> 注意：后端已有 `/api/jobs`（`jobs.router`，prefix `/api/jobs`）和 `/api/assets`（`assets.router`），可以复用/对齐。`/api/home-generation` 和「住宅 CRUD」是本模块新增诉求，需要你新建。

---

## 4. 数据契约：生成任务（Job）

`getJob()` 轮询返回，前端按 `status` 驱动 UI（见 `pollJob()`、`updateGeneration()`）：

```jsonc
{
  "status": "queued | processing | ready | failed",  // 前端据此切文案/进度
  "progress": 0,          // 0–100，直接映射进度条宽度
  "error": "文案",        // status=failed 时展示
  "result": { /* 住宅工程对象，见 §5 */ }   // 仅 status=ready 时提供
}
```

- 前端每 **680ms** 轮询一次（`pollTimer`）。
- `status==='ready'` 时，前端取 `result` 作为住宅工程，立即 `saveProject(result)` 落库并进入编辑器。

---

## 5. 数据契约：住宅工程对象（Home Project，`schemaVersion: 2`）

这是整个模块的核心数据结构。生成任务的 `result`、`loadHomes()` 的每一项、`saveProject()` 的入参，都是这个形状。参考 `buildProject()`（272–278 行）：

```jsonc
{
  "schemaVersion": 2,
  "id": "home-xxxx",
  "name": "两室一厅",
  "source": { "type": "template | drawing", "templateId": "two-one", "drawingName": null },

  "envelope": { "width": 12, "depth": 9 },          // 户型外包络（米）

  "walls": [                                         // 墙段（2D 线，前端拉高成 3D 墙）
    { "id": "outer-n", "axis": "x|z", "at": -4.5, "from": -6, "to": 6, "role": "exterior|partition" }
  ],

  "rooms": [                                         // 房间（矩形）
    { "id": "room-1", "name": "主卧", "label": "主卧", "type": "bedroom",
      "zone": "private|public|service", "layoutPreset": "corner-suite",
      "x": -3, "z": -2.25, "width": 6, "depth": 4.5, "wallIds": [] }
  ],

  "windowSlots": [                                   // 窗位（可占用/空）
    { "id": "window-slot-1-north", "roomId": "room-1", "edge": "north|east|south",
      "occupied": true, "position": { "x": 0, "y": 1.65, "z": -4, "rotationY": 0 } }
  ],

  "placements": [                                    // ★ 用户摆放的家具（编辑器产出，最常写库）
    { "id": "placement-xxxx", "homeId": "home-xxxx", "assetId": "chair-walnut",
      "roomId": "room-1",
      "position": { "x": 1.2, "y": 0, "z": -0.5 },
      "rotation": { "x": 0, "y": 0.26, "z": 0 },
      "scale":    { "x": 1, "y": 1, "z": 1 } }
  ],

  "finishes": { "floorAssetId": "floor-oak", "wallpaperAssetId": "wallpaper-linen" }, // 全屋饰面
  "daylight": "day | night",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

**房间 `type` 取值**：`living / dining / bedroom / kitchen / bathroom / balcony-large / balcony-small`（用于配色与窗位规则）。
**坐标系**：以户型中心为原点，单位米，`x` 横向、`z` 纵深、`y` 垂直向上。`walls[].axis` 表示墙沿哪个轴延伸。

> 如果后端户型识别（图纸→户型）暂时产不出这么完整的结构，最省力的做法：后端先只返回 `source.templateId`，前端 `buildProject()` 会用内置 `TEMPLATES` 补齐 walls/rooms/windowSlots。等你的图纸解析成熟了，再直接下发完整 `result`。

---

## 6. 数据契约：资产库（`asset-library-data.js`）与你的 `AssetOut` 映射

前端资产对象（`getAssets(kind, category)` / `getAsset(id)` 返回）字段：

```jsonc
{
  "id": "chair-walnut",
  "kind": "furniture | floor | wallpaper | floorplan",
  "name": "胡桃餐椅",
  "source": "platform | user",
  // furniture 专有：
  "category": "table|seating|sofa|lighting|decor|bed|bedding|cabinet|kitchen|bathroom|storage",
  "primitive": "chair|sofa|lamp|cabinet|table|bed|plant",  // 无 GLB 时的占位几何体类型
  "color": "#7f5b44", "accent": "#c8a682",
  "dimensions": [0.52, 0.95, 0.56],   // [宽, 高, 深] 米，用于碰撞/落位边距
  "modelUrl": "https://.../chair.glb", // ★ 有则加载真实 GLB，见 §7
  "sourceType": "platform|photo|video_selection|draw",
  // floor / wallpaper 专有：
  "finish": { "color": "#cfae7f", "accent": "#ad895b", "pattern": "grain",
              "textureUrl": "https://.../floor.jpg", "roughness": 0.7 },
  // floorplan 专有：
  "templateId": "two-one", "thumbnail": "plan-two", "supported": true
}
```

**你后端 `AssetOut`（`schemas_lib.py`）→ 前端字段映射建议**：

| 后端 `AssetOut` | 前端资产字段 | 说明 |
|---|---|---|
| `asset_id` | `id` | 主键 |
| `name` | `name` | |
| `glb_url` | **`modelUrl`** | ★ 关键：填了它前端就渲染真实 3D，见 §7 |
| `thumb_url` | `thumbnail` | 缩略图 |
| `labels.category` | `category` | 需映射到前端 11 类枚举（沙发→`sofa`、单椅→`seating`、桌→`table`…）；映射不上时前端归入「其他」不报错 |
| `size_prior` `[w,h,d]` | `dimensions` | 米制，用于碰撞盒/落位边距；缺省 `[0.7,0.7,0.7]` |
| `status` | —（前端只认 `ready`） | 建议只下发 `ready` 的资产 |
| — | `kind` | ★ 你需要补：家具类固定 `"furniture"`；地板/墙纸/户型是另外的品类，见下 |

要点：
- 前端 `kind` 目前只有 `furniture` 能直接对上你视频产线的 `AssetOut`。**地板 `floor` / 墙纸 `wallpaper` / 户型 `floorplan`** 是三条独立品类，若你库里也存这些，请在返回时给出 `kind` 与对应专有字段（floor/wallpaper 用 `finish`，floorplan 用 `templateId/supported`）。
- `primitive/color/accent` 是**无 GLB 时的降级占位**参数。你若每件都提供了 `glb_url`，这几个字段可不填，前端仅在 GLB 缺失时用它们兜底画个几何体。

---

## 7. ★ 关键后端挂钩点（把你现有能力接进来）

代码里已埋好这些 hook，填上对应 URL/字段即可生效：

1. **GLB 家具模型** — `loadModelIfAvailable()`（458–459 行）
   `asset.modelUrl` 非空 → `GLTFLoader.load()` 加载，成功后用真实模型替换占位几何体，失败静默降级。
   **你的 TRELLIS 产出的 `glb_url` 直接映射到 `modelUrl` 即可。** 这是「拍照/画图→3D」闭环在「我的家」里落地的点。

2. **地板/墙纸贴图** — `getFinishTexture()`（355 行）
   `asset.finish.textureUrl` 非空 → 加载远程贴图，否则用前端 canvas 程序化生成。你有真实材质图就填 `textureUrl`。

3. **白天/黑夜** — `daylightButton` 事件（486 行，有注释）
   前端只记录并（未来）上报 `daylight` 字段；**整体光线 + 窗外景色图期望由后端按此渲染下发**。当前是前端纯本地效果，联调时约定上报方式。

4. **收藏 / 资产可见性** — `getFavorites()` / `addUserAsset()`（`asset-library-data.js`）
   - 「我的家」抽屉**只展示被收藏的资产**（`getDrawerAssets` / `getFavoriteAssets`）。收藏现存 localStorage，联调时需后端提供「用户收藏」读写（小程序侧按用户维度存）。
   - 用户在「画一笔/拍一张」生成的资产带 `visibility:'public'`，注释约定「小程序侧由后端可见性字段承载」——即用户自生成资产进公共库的可见性由你控制。

---

## 8. 数据持久化现状（localStorage）→ 后端要接管的 key

Mock 态下所有状态存浏览器 localStorage，联调时逐个换成后端存储：

| localStorage key | 内容 | 后端接管为 |
|---|---|---|
| `dreamhome.my-home.homes.v1` | 用户的所有住宅工程 | 住宅 CRUD 接口（§5） |
| `dreamhome.my-home.v1` | 旧版单住宅（有自动迁移逻辑，可忽略） | — |
| `dreamhome.asset-library.v1` | 用户收藏的资产 id 列表 | 用户收藏接口（§7.4） |
| `dreamhome.user-assets.v1` | 用户自生成资产 | 用户资产库（§7.4） |

---

## 9. 联调步骤建议（从假到真，逐步替换）

1. **先通生成链路**：后端实现 `POST /api/home-generation` + `GET /api/jobs/{id}`，`result` 先只回 `{source:{templateId}}`（前端会补全户型）。把 `USE_MOCK_HOME_SERVICE` 改 `false` 验证「选模板→生成→进编辑器」跑通。
2. **接真实资产**：让 `GET /api/assets` 按 §6 映射返回，家具带上 `glb_url`（→`modelUrl`）。验证抽屉里出现真实家具、摆进去是真 GLB。
3. **接住宅存储**：实现 `loadHomes/saveProject/deleteHome` 的 REST（`HttpHomeSceneService` 里现在是空实现，需补），把 localStorage 换成后端。
4. **接收藏/可见性**：把 `asset-library-data.js` 的 `getFavorites/getUserAssets` 由 localStorage 改为后端读写（这一步影响全站，需前端配合）。
5. **图纸解析 & 光照**：成熟后由后端下发完整 `result` 与 `daylight` 渲染产物。

> 环境提示：本地起前端 `python3 -m http.server 5180 --directory web`（仓库根执行），页面 `http://127.0.0.1:5180/prototype/pages/my-home/index.html`。联调时前端 fetch 走相对路径 `/api/*`，需与后端同源或配好代理/CORS。

---

## 10. 前端愿意配合改的地方（不用你独自适配）

以下若对齐困难，直接找前端（我）改，不必强行迁就后端结构：
- `category` 枚举映射（后端标签体系 ↔ 前端 11 类）
- `HttpHomeSceneService` 里住宅 CRUD 的具体 URL/字段（现在是占位）
- `/api/*` 路径命名，可改成对齐你已有的 `assets/library/jobs/videos` 路由前缀
- 请求/响应字段名（下划线 ↔ 驼峰）——前端可在 service 层做一次转换

有任何契约对不齐，以「先让链路能跑通、再逐字段替换真数据」为原则推进即可。
