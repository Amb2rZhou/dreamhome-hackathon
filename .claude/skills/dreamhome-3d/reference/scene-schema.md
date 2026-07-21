# 场景资产 JSON 契约(storage/scenes/<video_id>.json)

场景 = 布局清单,只**引用**资产库里的 GLB,与资产解耦(资产可跨场景复用)。
rebuild.html 按 `?v=<video_id>` 加载;页面「保存场景资产」按钮把精调结果写回
`PUT /api/scenes/{video_id}`,同时把每件资产的真实尺寸写回资产库 `size_prior`。

```jsonc
{
  "video_id": "vid_xxx",
  "title": "卧室(单间公寓)",
  "room": { "w": 4.2, "d": 5.2, "h": 2.8 },      // 米;x 左右,z 前后(-d/2 尽头,+d/2 入口开口)
  "balcony": { "x0": -0.1, "x1": 2.1, "depth": 0.95 },  // 可选,null=无阳台凹间
  "extras": [                                     // 附属壳体(简单盒体,如空调占位)
    { "dims": [0.28,0.3,0.9], "pos": [-1.9,2.25,0.1], "color": "f7f7f5", "note": "空调挂机" }
  ],
  "cfg": {
    "light": "dusk|day|night|overcast",           // 光线库预设(GET /api/libraries/lights)
    "view": "dusk_city",                          // 窗外景观(GET /api/libraries/views)
    "windows": [                                  // 窗户库实例
      { "id": "bay1", "wall": "left|right|back|balcony",
        "type": "window|bay|floor",               // 普通窗/飘窗(带坐垫凹龛)/落地窗(带纱帘)
        "style": "grid|plain",                    // 黑框格栅/细框简约
        "center": -1.15, "width": 1.7, "height": 1.95, "sill": 0.45 }
    ]
  },
  "items": [                                      // 家具,引用资产库
    { "id": "ast_xxx", "name": "双人床", "glb": "/storage/models/xxx.glb",
      "tags": ["床","白色"], "t_best": 11.0, "track": "trk_xxx",   // 回链视频时间点
      "targetW": 2.1,                             // 无 size_prior 时的归一化宽(米)
      "pos": [-1.0, 0, -0.55], "rotYDeg": 90,
      "scale": [1.02, 0.98, 1.02],                // 可选,保存过的精调三轴缩放
      "mount": "floor|wall|ceiling|surface" }     // 拖拽锚定面;缺省 floor;资产库 labels.mount 同义
  ]
}
```

## mount 挂载语义(决定编辑器里怎么拖)

| mount | 行为 | 例 |
|---|---|---|
| floor(默认) | 贴地水平拖动 | 床/沙发/桌椅/地毯 |
| wall | 射线吸附任意墙面,沿墙垂直平移,自动面朝房内;加载时自动"立正"(平躺模型立起) | 挂画/挂钟/空调挂机 |
| ceiling | 顶部对齐吊天花板下沿,水平拖动 | 吊灯/吸顶灯/吊扇/吊饰 |
| surface | 吸附指针下方家具顶面(只认朝上的面) | 音乐盒/台灯/小摆件 |

## 视频→场景的推断要领(给执行本 skill 的 Agent)

1. 关键帧在 `backend/storage/pipeline/<vid>/kf_*.jpg`(每 0.5s 一张),通读 3-5 张摸清:
   房间长宽比例、窗户位置与类型(飘窗有坐垫、落地窗到地)、家具靠哪面墙、吊顶样式。
2. 房间尺寸对着家具估(床 2m、门 0.9m 作标尺);写 room/balcony/cfg.windows。
3. items 从 `GET /api/assets?q=` 或 sqlite 按 video_id 取 ready 资产;同一实物多版资产
   (重复检测)只取一件;mount 直接用资产 labels.mount;初摆按常识(床靠墙/桌靠窗)。
4. 打开 `http://localhost:8000/review/rebuild.html?v=<vid>` 对照原视频核查;
   漏检物品让用户在页面圈选 → `tools/gen_from_annotations.py --prep` → 页面审核通过 →
   不带 --prep 正式生成(需 GPU)→ 新资产补进场景 JSON。
