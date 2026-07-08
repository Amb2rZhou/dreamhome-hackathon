# DreamHome 手机端（Expo）

一套代码跑 iOS / Android / Web。Web 版就是那个"分享链接邀好友来访"的落地形态。

## 四个页面

- **摘抄本** `index` — 已生成的 3D 组件素材库(空态引导去摘抄)
- **视频** `video` — 选装修/探家视频 → 抽帧抠图 → 3D
- **拍照** `photo` — 拍/选家具照 → 去背景 → 3D
- **画画** `sketch` — 手绘线稿 → 3D，下方带语音编辑

三个能力都调后端异步接口：提交 → 轮询进度 → 出 GLB → 存进摘抄本。GLB 用
`<model-viewer>` 渲染，手机上直接有 AR「摆进真实房间」。

## 跑起来

```bash
cd mobile
npm install            # 或 npx expo install 对齐 SDK 版本
# 指向你的后端(手机和电脑同一局域网时用电脑 IP，如 192.168.x.x:8000)
export EXPO_PUBLIC_API_BASE=http://<后端地址>:8000
npx expo start         # 扫码在手机 Expo Go 里跑；按 w 开网页版
```

## 配置

- `EXPO_PUBLIC_API_BASE`：后端地址。不设默认 `http://localhost:8000`(仅网页版本机可用)。
- 后端 `GEN3D_PROVIDER=mock` 时无需任何 3D API key，整条链路可跑通、可录 demo。

## 说明 / 待接

- **语音**：Web 端用浏览器 SpeechRecognition 直接听写；原生端 demo 用文字输入模拟 ASR，
  接真机语音需 `@react-native-voice/voice` + dev build。
- **圈选**：视频/拍照的 bbox 圈选交互未接入(接口已留 `bbox` 参数)，MVP 先整图/整帧。
- **组装编辑器**：把摘抄本里的组件拖进户型摆放，是下一阶段(基于 blueprint3d 类)。
