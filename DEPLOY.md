# DreamHome 本地部署说明

本项目分**前端**和**后端**两部分，需要分别启动。下面按顺序操作。

## 环境要求

- Node.js 18+（前端）
- Python 3.10+（后端）
- macOS / Linux / Windows 均可

## 一、前端启动

```bash
cd dreamhome-feed
npm install        # 装前端依赖（React、Vite、Three.js 等）
npm run dev        # 启动开发服务器
```

启动后访问 `http://localhost:5173`。

## 二、后端启动

```bash
cd dreamhome-feed/backend

# 1. 创建 Python 虚拟环境
python3 -m venv .venv

# 2. 激活虚拟环境
# macOS / Linux:
source .venv/bin/activate
# Windows:
.venv\Scripts\activate

# 3. 装后端依赖（FastAPI、rembg、Pillow 等）
pip install -r requirements.txt

# 4. 配置百炼 API Key（用于 AI 补全，必填，否则补全走 mock）
export DASHSCOPE_API_KEY="你的key"
# Windows PowerShell:
# $env:DASHSCOPE_API_KEY="你的key"

# 5. 启动后端
uvicorn segment_api:app --host 127.0.0.1 --port 8001
```

启动后访问 `http://127.0.0.1:8001/health`，返回 `{"status":"ok"}` 即正常。

## 三、关于 DASHSCOPE_API_KEY

这是阿里云百炼（通义万相 wan2.7）的 API Key，**不在 zip 包里**，需要单独配置。

- 没有这个 key：后端 `/api/inpaint` 会走 mock，原样返回输入图，不做 AI 补全。
- 有这个 key：圈选家具后，调用 wan2.7 模型做去背景+去遮挡+补全。
- key 需要在百炼控制台申请，账户要有余额。

获取地址：https://bailian.console.aliyun.com/

## 四、AI 补全的 system prompt

后端代码 `backend/segment_api.py` 里有 `INPAINT_SYSTEM_PROMPT`（当前 V8 版本），是给 wan2.7 模型的系统指令。

**当前 prompt 设计意图**（V8）：
- 输入：带场景的 bbox 截图 + 极淡灰色 path 高亮
- 要求模型：去背景 + 去遮挡物 + 基于物理结构补全缺失部分 + 中性漫射光输出 + 颜色保真（供 3D 贴图用）
- 关键约束：忽略 path 标记线、颜色材质纹理和原图一致、输出透明背景

**调 prompt 的位置**：`backend/segment_api.py` 第 199 行 `INPAINT_SYSTEM_PROMPT`。改完重启后端生效。

**已知限制**（wan2.7 能力边界）：
- 结构补全（如椅子腿位置）不精确，模型靠训练数据统计猜测，可能错位
- 光影一致性难保证，所以 V8 改成中性光输出，把光影交给 3D 阶段
- 偶尔会脑补原图没有的物体（生成式模型通病）

## 五、其他配置（前端 .env）

项目根目录有 `.env` 文件，控制抠图 provider：

```
VITE_SEGMENT_PROVIDER=removebg
VITE_REMOVEBG_API_KEY=你的_remove.bg_key
```

- `VITE_SEGMENT_PROVIDER`：抠图服务，可选 `removebg` 或 `local`（本地 rembg）。
- `VITE_REMOVEBG_API_KEY`：remove.bg 的 key（走代理，免费额度有限）。

## 六、验证流程

1. 后端先起来（`/health` 返回 ok）
2. 前端 `npm run dev` 起来
3. 浏览器打开 `http://localhost:5173`
4. 视频自动播放，点击画面进入圈选模式
5. 圈选一件家具，等 10-20 秒
6. 点右上角"留痕"按钮，查看 bbox 原图、补全产物、最终产物

## 七、常见问题

**Q: 后端报 400 / CORS 错误？**
A: 通常是 `DASHSCOPE_API_KEY` 没配或账户欠费。检查后端日志。

**Q: 补全产物和原图一样，没变化？**
A: 后端走 mock 了，说明 key 没配或百炼账户没钱。

**Q: rembg 首次运行很慢？**
A: rembg 首次会下载 u2net 模型（~176MB）到 `~/.u2net/`，下完后就快了。

**Q: 留痕记录丢了？**
A: 留痕存在后端文件系统 `backend/traces/`，不会丢。浏览器 localStorage 只存当前 session。
