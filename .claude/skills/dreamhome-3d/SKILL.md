---
name: dreamhome-3d
description: DreamHome 核心能力封装——①单张图片生成干净 3D 资产(GLB) ②视频还原房间场景并重新建模(半自动,含圈选补漏/审核闭环)。当用户要"图生3D/图片转3D资产/视频重建场景/视频转3D家/dreamhome"时使用。也用于评委体验产品核心链路。
---

# dreamhome-3d:图片/视频 → 3D 家居资产与场景

本 skill 封装 DreamHome 后端两大能力。所有脚本在**仓库根目录**执行,依赖仓库自带
`backend/.venv`。开始任何生成前**必须**先跑体检:

```bash
python3 .claude/skills/dreamhome-3d/scripts/status.py
```

体检会报清四个依赖(:8000 后端 / :8002 补全服务 / GPU 服务器 / dashscope key)。
**GPU 服务器是按量计费云实例,为控制成本平时默认关机**——体检若报 GPU 未开机,
如实告知用户:需联系部署方开机后才能做 3D 生成(标注/审核/场景编辑不受影响),
不要尝试自行开机。

## 能力一:单张图片 → 3D 资产

```bash
backend/.venv/bin/python .claude/skills/dreamhome-3d/scripts/gen_asset.py <图片> \
    [--name 沙发] [--hint "保留布艺质感"] [--dry]
```

- 内部走完整质量 SOP:补全(单体化/去背景,必过)→ 单体闸 → 一致性闸 → 打标签 → TRELLIS → 落库。
  闸不过会给出打回原因——把原因转述给用户,建议加 `--hint`(会拼进补全指令)重试。
- 预期:约 **1.5~2.5 分钟/张**;干净单体图成功率约 85%,杂乱图约 70%(闸会拦废品,不会产烂模型)。
- 谨慎花钱:用户想先看效果时用 `--dry`(只跑到质检闸,不动 GPU),满意再正式生成。
- 产出:asset_id + GLB 地址 + 资产库预览链接。

## 能力二:视频 → 场景还原重建(半自动)

诚实预期管理(对用户明说):短视频(10-20s)从输入到"可演示的 3D 房间"约
**30-45 分钟**,其中全自动部分 10-20 分钟,剩余是人机协作(圈选漏检物+审核+微调)。
纯自动零干预一次成型率约五成,靠审核闭环拉到可交付。

执行步骤(你=运行本 skill 的 Agent 逐步做):

1. **体检** status.py;能力二必须 GPU 在线。
2. **入库跑管线**(抽帧→检测→轨迹→逐资产 SOP 生成,全自动):
   ```bash
   cd backend && set -a && source .env && set +a && \
   ./.venv/bin/python -m pipeline.run <video.mp4> --title "标题" [--source-url 抖音链接]
   ```
   12s 视频约 10-20 分钟(含逐件 3D 生成)。结束后记下 video_id。
3. **推断房间场景**:按 `reference/scene-schema.md` 的要领,读关键帧、写
   `backend/storage/scenes/<video_id>.json`(房间外壳/窗户/光线/家具初摆,
   家具 mount 用资产库 labels.mount)。
4. **对照微调**:让用户打开 `http://localhost:8000/review/rebuild.html?v=<video_id>`
   ——左 3D 右原视频,拖拽摆位,左下切光线/窗户/窗外景观(数据来自
   `/api/libraries/{lights,windows,views,floors,ceilings}`)。
5. **补漏闭环**:视频画面上绿框=已生成资产;用户圈红框标漏检物 →
   `./.venv/bin/python tools/gen_from_annotations.py <video_id> --prep`(产补全图)→
   用户在页面逐条审核(打回必填原因,原因自动变成重做指令)→ 通过后
   `./.venv/bin/python tools/gen_from_annotations.py <video_id>`(过审的才进 GPU)→
   新资产 id 补进场景 JSON 的 items。
6. **固化**:用户调完点页面「保存场景资产」——布局写回服务器,资产尺寸(含调过的
   长宽比)写回资产库 size_prior,跨场景生效。场景与资产始终解耦,可互相换用。

## 常用 API 速查

- `GET /api/assets?q=&exclude_special=true` 资产库(labels.mount=挂载类型,size_prior=真实尺寸)
- `GET /api/videos/{vid}/assets_at?t=` 某时刻画面里已生成的资产(绿框数据源)
- `POST /api/videos/{vid}/match_annotation` 圈选与已有资产比对(IoU>0.35 命中)
- `GET/PUT /api/scenes/{vid}` 场景资产读写
- `GET /api/libraries/{windows|ceilings|floors|lights|views}` 五类专项库
