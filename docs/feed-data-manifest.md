# DreamHome Feed 数据真源与校验

Feed Manifest 是现有 DreamHome 数据的只读汇聚物，不是新的业务数据库。

## 真源与边界

- canonical asset：运行时 `backend/storage/dreamhome.db` 的 `assets` 优先；数据库不存在或尚未导入的比赛 checkout 才用已发布 `library-assets.generated.js` 补齐。`ready` 仍表示通过生产质量门的 canonical asset。
- video appearance：优先复用 `tracks` 的 `frames_json`、时间段和 `asset_id`。`src/availableAssets.generated.ts` 中已有的窗口仅作为兼容投影；同一视频/资产已有 track 时不会重复输出。
- scene：保持为 `backend/storage/scenes/*.json`，不并入素材库或 home placement。
- 同款小家：只引用 `default-homes.generated.js` 中的模板和 canonical `assetId`，不复制资产。
- raw GLB、ready canonical asset、`user_library` 引用和 `home_placements` 仍是四个独立层次；Manifest 不把 raw job 结果提升为 canonical asset，也不写用户数据。

质量元数据直接扩展既有 `tracks`：轨迹本身使用 `confidence/review_status/version/source`，`track -> asset` 映射使用对应的 `binding_*` 字段。迁移是可重复执行的 `ALTER TABLE ADD COLUMN`，不会创建 `video_component_timeline` 或平行映射表。

## 当前比赛 Demo 盘点

本次 checked-in 数据快照的对应关系如下：

| 数据 | 数量 | 对应关系 |
| --- | ---: | --- |
| Feed videos | 9 | `home-1` + 8 条 Amber 视频 |
| published canonical assets | 169 | 后端 catalog 兼容来源，全部标记 ready |
| `availableAssets.generated.ts` | 149 | 149 个 ID 均存在于 catalog；catalog 另有 20 个线下照片资产 |
| appearances | 195 | 来自上述 149 个前端资产的现有时间窗口；当前 checkout 无 runtime track 可覆盖 |
| backend scenes | 2 / 19 items | `vid_40734…` 10 件、`vid_5f32…` 9 件 |
| 同款小家模板 | 2 / 27 placements | `vid_91fe…` 17 件、`vid_40734…` 10 件 |

场景和模板共出现 11 次缺失 canonical 引用，涉及 8 个唯一 ID：`ast_665e55cee687`、`ast_cf21f0f0a02c`、`ast_6410374831cb`、`ast_87dc36b29526`、`ast_339dc6e870de`、`ast_c0274a819f34`、`ast_f7189ad0a9a2`、`ast_ec05acc016d9`。这些 ID 虽有 demo GLB 或 supplemental frontend 定义，但在 canonical catalog 中不存在，因此 Manifest 不会擅自把它们提升为 ready asset。

另外，场景中有 16 个 track 引用因本 worktree 没有被 Git 忽略的 runtime SQLite 而无法核验；`vid_91fe552c5f7d` 有同款小家模板但没有 `backend/storage/scenes` 场景文档。这些项目留给人工确认数据归属或补充正式 canonical/scene 记录。

## 生成与校验

在仓库根目录运行：

```bash
python3 backend/tools/build_feed_manifest.py --dry-run
python3 backend/tools/build_feed_manifest.py
python3 backend/tools/validate_feed_manifest.py --dry-run
python3 backend/tools/validate_feed_manifest.py
```

默认产物：

- `backend/storage/feed/feed-manifest.v1.json`
- `backend/storage/qc/feed-manifest-validation.json`

两个工具都只读源数据。`--dry-run` 连 Manifest/报告文件也不写；校验器不会自动修复任何问题。CI 可加 `--strict`，在报告包含 error 时返回非零。

校验覆盖缺失资产、孤立映射、重复映射、时间越界、非法归一化 bbox、非 ready 资产、未经批准的跨视频 track 绑定和缺失场景。比赛 checkout 若没有被 Git 忽略的 SQLite，报告会保留静态 Feed appearance，同时明确给出无法对照 runtime tracks 的 warning。
