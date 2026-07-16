"""抖音视频下载(免登录):分享短链 → share 页 _ROUTER_DATA → play_addr → mp4。

yt-dlp 的 Douyin 提取器需要新鲜 cookies 不稳定;share 页是移动端兜底路径,匿名可用。
playwm(带水印)→ play 替换尝试去水印,失败回退带水印版(用于抽帧影响很小)。

单独用: ./.venv/bin/python tools/douyin_dl.py "https://v.douyin.com/xxxx/" out.mp4
"""
import json
import os
import re
import ssl
import sys
import urllib.request

import certifi

UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
# 本机 python 无系统 CA(CLAUDE.md 已知坑),显式用 certifi
_SSL = ssl.create_default_context(cafile=certifi.where())


def _opener():
    # 国内站点直连,绕开系统代理
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=_SSL))


def _get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.douyin.com/"})
    with _opener().open(req, timeout=timeout) as r:
        return r.read()


def resolve_video_id(share_url: str) -> str:
    """短链 302 → /video/{id} 或 /share/video/{id}。"""
    req = urllib.request.Request(share_url, headers={"User-Agent": UA}, method="HEAD")
    with _opener().open(req, timeout=30) as r:
        final = r.geturl()
    m = re.search(r"/(?:share/)?video/(\d+)", final)
    if not m:
        raise RuntimeError(f"无法从跳转地址解析视频ID: {final}")
    return m.group(1)


def get_play_info(video_id: str) -> dict:
    """share 页 _ROUTER_DATA 里拿 play_addr 与标题。"""
    html = _get(f"https://www.iesdouyin.com/share/video/{video_id}/").decode("utf-8", "ignore")
    m = re.search(r"_ROUTER_DATA\s*=\s*(\{.*?\})\s*</script>", html, re.S)
    if not m:
        raise RuntimeError("share 页无 _ROUTER_DATA(视频可能被删/设为私密)")
    data = json.loads(m.group(1))
    loader = data.get("loaderData", {})
    item = None
    for v in loader.values():
        if isinstance(v, dict) and v.get("videoInfoRes", {}).get("item_list"):
            item = v["videoInfoRes"]["item_list"][0]
            break
    if not item:
        raise RuntimeError("share 页结构变化,未找到 item_list")
    urls = item["video"]["play_addr"]["url_list"]
    title = (item.get("desc") or "").strip()
    return {"play_url": urls[0], "title": title}


def download(share_url: str, out_path: str) -> dict:
    vid = resolve_video_id(share_url)
    info = get_play_info(vid)
    url = info["play_url"]
    data = b""
    # 先试去水印(playwm→play),403/失败回退带水印
    for candidate in ([url.replace("/playwm/", "/play/")] if "/playwm/" in url else []) + [url]:
        try:
            data = _get(candidate, timeout=120)
            if len(data) > 100 * 1024:
                break
        except Exception:
            continue
    if len(data) <= 100 * 1024:
        raise RuntimeError("视频下载失败(两种地址都不可用)")
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(data)
    return {"path": out_path, "title": info["title"], "video_id": vid,
            "size_mb": round(len(data) / 1024 / 1024, 1)}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    print(download(sys.argv[1], sys.argv[2]))
