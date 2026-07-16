"""抖音视频 → 资产库 批量生产入口(SOP 的自动化段)。

用法:
  # 混合输入:链接列表文件(一行一条,支持 # 注释)/ 单个链接 / 本地视频 / 视频目录
  ./.venv/bin/python tools/batch_produce.py links.txt
  ./.venv/bin/python tools/batch_produce.py "https://v.douyin.com/xxxx/"
  ./.venv/bin/python tools/batch_produce.py ~/Downloads/douyin_videos/

行为:
  1. 链接用 yt-dlp 下载(720p+,失败自动跳过并记录,不中断批次)
  2. 每个视频跑离线 pipeline(抽帧→检测→追踪→抠图→3D生成→打标→入库)
  3. 串行处理(GPU 生成本来就是队列),Ctrl-C 后重跑自动跳过已完成的
  4. 结束输出汇总表 + 失败清单;产物直接进 /review 待审核

provider 由 .env 决定;真跑需要 DETECT_PROVIDER=remote + GEN3D_PROVIDER=selfhost + REMOTE_GPU_URL。
"""
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from pipeline.run import process  # noqa: E402

DOWNLOAD_DIR = os.path.join(os.path.abspath(settings.STORAGE_DIR), "downloads")
STATE_FILE = os.path.join(os.path.abspath(settings.STORAGE_DIR), "batch_state.json")
YTDLP = os.path.join(os.path.dirname(sys.executable), "yt-dlp")


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"done": {}, "failed": {}}


def save_state(state: dict) -> None:
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)


def collect_inputs(arg: str) -> list[dict]:
    """展开输入为 [{key, url?, path?}]。key 用于断点续跑去重。"""
    items = []
    if arg.startswith("http"):
        items.append({"key": hashlib.md5(arg.encode()).hexdigest()[:12], "url": arg})
    elif os.path.isdir(arg):
        for name in sorted(os.listdir(arg)):
            if name.lower().endswith((".mp4", ".mov", ".webm")):
                p = os.path.join(arg, name)
                items.append({"key": hashlib.md5(p.encode()).hexdigest()[:12], "path": p})
    elif os.path.isfile(arg) and arg.lower().endswith((".mp4", ".mov", ".webm")):
        items.append({"key": hashlib.md5(arg.encode()).hexdigest()[:12], "path": arg})
    elif os.path.isfile(arg):  # 链接列表文件
        with open(arg) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    items.append({"key": hashlib.md5(line.encode()).hexdigest()[:12], "url": line})
    else:
        raise SystemExit(f"无法识别的输入: {arg}")
    return items


def download(url: str, key: str) -> str:
    """yt-dlp 下载,返回本地路径。抖音分享链接(v.douyin.com 短链)可直接喂。"""
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    out = os.path.join(DOWNLOAD_DIR, f"{key}.mp4")
    if os.path.exists(out):
        return out
    cmd = [YTDLP, "-f", "bv*[height>=720]+ba/b", "--merge-output-format", "mp4",
           "--no-playlist", "-o", out, url]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0 or not os.path.exists(out):
        raise RuntimeError(f"下载失败: {(r.stderr or '')[-300:]}")
    return out


async def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    items = []
    for arg in sys.argv[1:]:
        items.extend(collect_inputs(arg))
    state = load_state()
    todo = [it for it in items if it["key"] not in state["done"]]
    print(f"共 {len(items)} 条输入,待处理 {len(todo)}(已完成 {len(items) - len(todo)} 跳过)")
    print(f"providers: detect={settings.effective_detect_provider} "
          f"gen3d={settings.effective_provider} labels={settings.effective_labels_provider}\n")

    for i, it in enumerate(todo):
        label = it.get("url") or it.get("path")
        print(f"===== [{i+1}/{len(todo)}] {label}")
        t0 = time.time()
        try:
            path = it.get("path") or download(it["url"], it["key"])
            video_id = await process(path, title=os.path.basename(label)[:40],
                                     source_url=it.get("url", ""))
            state["done"][it["key"]] = {"video_id": video_id, "src": label,
                                        "seconds": round(time.time() - t0)}
            state["failed"].pop(it["key"], None)
            print(f"===== 完成 {video_id}({time.time()-t0:.0f}s)\n")
        except Exception as e:  # noqa: BLE001 单条失败不中断批次
            state["failed"][it["key"]] = {"src": label, "error": str(e)[-300:]}
            print(f"===== ❌ 失败: {e}\n")
        save_state(state)

    print("\n========== 批次汇总 ==========")
    print(f"成功 {len(state['done'])} | 失败 {len(state['failed'])}")
    for v in state["failed"].values():
        print(f"  ❌ {v['src']}: {v['error'][:120]}")
    print(f"\n审核入口: {settings.PUBLIC_BASE_URL}/review")


if __name__ == "__main__":
    asyncio.run(main())
