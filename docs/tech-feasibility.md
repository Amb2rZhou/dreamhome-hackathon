# 技术可行性调研（2026-07）

> 结论：四条链路每一条都有 2026 年现成的 API / 开源方案可以直接拼装，hackathon 周期内可出可演示 demo。
> 架构杠杆点：视频截帧、实拍照片、手绘草图三种输入共用**同一个 image-to-3D 底座**——接一次 3D 生成 API，覆盖三个玩法。

## 链路 A：视频里圈选家居元素并保存（入口，最贴赛道）

流程：暂停视频 → 圈选 → 分割抠图 → 识别理解 → 存入素材库 → 转 3D

- **圈选与分割**：Meta [SAM 3](https://arxiv.org/abs/2511.16719)（ICLR 2026）——支持在视频里用点选/框选/文字概念（如"米色布艺沙发"）分割并**跨帧追踪同一物体**。Hackathon 可用 SAM 2/3 开源权重或 Replicate 托管版，单帧分割秒级。
- **识别与理解**：抠图交给多模态大模型（Claude / GPT-4V / Qwen-VL）输出品类、材质、风格、预估尺寸；顺带实现"圈选后语音追问"，命中赛道题眼。
- **转 3D**：单张抠图喂 image-to-3D API，30–120 秒出带贴图的 GLB。
- **风险**：视频截帧质量参差 → SAM 追踪多帧取最清晰一帧，或先过图像增强/超分。

可行性：★★★★★

## 3D 生成底座（三种输入共用）

| 方案 | 特点 | 适合 |
|---|---|---|
| [Tripo](https://www.3daistudio.com/blog/best-3d-model-generation-apis-2026) API | 快（~30s 级）、有 API、迭代式生成 | **demo 首选** |
| [Meshy](https://www.buildmvpfast.com/articles/best-llms-2026-guide/3d-modeling-ai) API | 文档最好、text/image-to-3D、PBR 贴图 | 稳妥备选 |
| [Hunyuan3D 2.x/3.0](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)（腾讯，开源） | 开源里质量最强，可自部署 | 省 API 费 / 国内网络 |
| [TRELLIS.2](https://trellis2.app/blog/best-image-to-3d-models-huggingface)（微软，MIT） | 生产级 PBR 资产，输出 mesh/高斯/NeRF 多格式 | 自部署进阶 |
| Stable Fast 3D | <1 秒出模，质量较糙 | 需要"实时感"的交互环节 |

家具是 image-to-3D 的最强品类（几何规整、单体、遮挡少），有垂类产品 [FurniMesh](https://furnimesh.com/) 专做家具照片转 3D 可作参照。

⚠️ 通用坑：**生成模型没有真实尺度**。对策：识别环节的品类先验（沙发默认 2.2m）+ 用户语音修正（"这个柜子是一米二的"）。

## 链路 B：扫户型图 → 生成 3D 空间

两条路线，互为兜底：

1. **拍/上传户型图 → 3D 壳**（推荐）：用多模态大模型把户型图解析成结构化 JSON（墙体线段坐标 + 门窗位置），three.js 里 extrude 出墙体。现成产品（[Planner 5D AI](https://planner5d.com/ai)、[floor-plan.ai](https://floor-plan.ai/floor-plan-to-3d)）已验证秒级可行；自己做时走 LLM 解析比训 CV 模型现实得多。
2. **iPhone 直接扫房间**：Apple [RoomPlan API](https://developer.apple.com/augmented-reality/roomplan/)（LiDAR）扫一圈输出带尺寸的参数化 3D 房间（USDZ，含墙/门/窗/既有家具），15m×15m 内 5 分钟搞定。团队有 iOS 同学的话这条"哇点"最高。

可行性：★★★★☆

## 链路 C：扫线下实物家具 → 3D 组件

- **重方案**：手机摄影测量 / 高斯泼溅——[Polycam](https://poly.cam/tools/gaussian-splatting)、[KIRI Engine](https://www.kiriengine.app/)（有 API）、[Scaniverse](https://scaniverse.com/) 均验证家具尺寸物体扫描效果好。注意：高斯泼溅与 mesh 场景混合渲染麻烦，demo 慎选。
- **轻方案（推荐）**：绕物体拍 1–3 张照片 → 直接走链路 A 的 image-to-3D 底座。质量略降但流程统一、开发量为零。

可行性：★★★★★（轻方案）

## 链路 D：边画边生成 3D 家具

Sketch-to-3D 是 image-to-3D 的子场景：画板线稿导出 PNG →（可选）图像模型 + ControlNet 把线稿渲染成上色效果图 → 喂 3D 底座。[Meshy 官方有 sketch-to-3D 流程](https://www.meshy.ai/blog/sketch-to-3d)，对干净的家具线稿支持不错。"草图 → 效果图 → 3D"两段式出模更稳。

可行性：★★★★☆（引导用户画干净的单体线稿）

## 组装层：把所有东西放进房间

- **Web 技术栈**：three.js / react-three-fiber，统一 **GLB** 格式。开源起点：[blueprint3d](https://github.com/furnishup/blueprint3d) / [blueprint-js](https://github.com/aalavandhaann/blueprint-js)（2D 画户型 + 3D 摆放，拖拽/旋转/吸附全有）、[open3dFloorplan](https://github.com/theLodgeBots/open3dFloorplan)（SvelteKit + three.js，较新）。**不要从零写摆放编辑器**——吸附、碰撞、贴墙这些交互细节很吃时间。
- **AR 落地**：`<model-viewer>` 一行代码让 GLB 在手机 AR 摆进真实房间（iOS 转 USDZ 走 Quick Look），演示效果好、成本极低。
- **语音操控**：ASR（豆包/Whisper）→ LLM function calling → 编辑器操作指令（`move("sofa", "window_side")`）。
- **好友来访（元宇宙玩法）**：Web 场景本身就是一个 URL，MVP 阶段"分享链接即来访"；进阶可加多人在线（如 Colyseus/WebSocket 同步视角与位置）。

## Demo 架构

```
抖音视频页(mock) ─暂停圈选→ SAM分割 ─→ 多模态识别卡片(可语音追问)
                                        │ 保存
拍户型图 ─LLM解析→ three.js 生成房间壳  ←┤ 素材库(GLB)
拍实物照片 ──────→ image-to-3D API ─────┤
画草图 ──────────→ (线稿→效果图→3D) ────┘
                房间编辑器(拖拽+语音指令) → AR 预览 / 好友来访链接
```

## 风险清单

| 风险 | 对策 |
|---|---|
| 3D 生成延迟 30–120s | 演示物料预生成 + 缓存 |
| 生成模型无真实尺度 | 品类先验 + 语音修正 |
| 视频截帧质量参差 | 多帧取最清晰 / 图像增强兜底 |
| 高斯泼溅与 mesh 混合渲染难 | demo 统一走 mesh(GLB) 管线 |

## 参考链接

- 3D 生成 API 对比：https://www.3daistudio.com/blog/best-3d-model-generation-apis-2026
- SAM 3 论文：https://arxiv.org/abs/2511.16719
- Hunyuan3D：https://github.com/Tencent-Hunyuan/Hunyuan3D-2
- TRELLIS.2：https://trellis2.app/blog/best-image-to-3d-models-huggingface
- Apple RoomPlan：https://developer.apple.com/augmented-reality/roomplan/
- Polycam 高斯泼溅：https://poly.cam/tools/gaussian-splatting
- KIRI Engine：https://www.kiriengine.app/
- Meshy sketch-to-3D：https://www.meshy.ai/blog/sketch-to-3d
- blueprint3d：https://github.com/furnishup/blueprint3d
- open3dFloorplan：https://github.com/theLodgeBots/open3dFloorplan
