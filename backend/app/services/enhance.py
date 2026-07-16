"""抠图补全卡槽:视频帧抠图 → 干净完整的产品图 → 再喂图生3D。

补全的具体实现由队友负责(见 docs/enhance-integration.md 对接契约),本文件只做分发:

  ENHANCE_PROVIDER=off      直通(默认,等队友模块接入)
  ENHANCE_PROVIDER=module   调 backend/enhance_custom.py 里的 enhance(in_path, out_path)
  ENHANCE_PROVIDER=cmd      跑外部命令 ENHANCE_CMD,{in}/{out} 会被替换成路径
                            例: ENHANCE_CMD="python3 /path/to/her_script.py {in} {out}"

契约:输入=一张残缺抠图路径;输出=补全后的产品图写到 out_path。
失败/超时一律降级直通(返回原图),不阻塞量产。
"""
import asyncio
import os
import shlex

from ..config import settings


async def enhance_cutout(image_path: str, out_path: str, category: str = "") -> str:
    provider = settings.ENHANCE_PROVIDER
    if provider == "off":
        return image_path
    # 内容哈希缓存:同一张抠图+同品类,任何一轮重跑都不再花钱
    from . import cache
    key = cache.content_key(image_path, extra=f"{provider}|{category}")
    hit = cache.get("enhance", key)
    if hit and "_files" in hit:
        return hit["_files"]["out.png"]
    try:
        if provider == "module":
            import enhance_custom  # 队友的模块,放 backend/ 下
            try:
                result = enhance_custom.enhance(image_path, out_path, category=category)
            except TypeError:  # 模块不接受 category 的旧契约
                result = enhance_custom.enhance(image_path, out_path)
            if asyncio.iscoroutine(result):
                result = await result
            if os.path.exists(out_path):
                cache.put("enhance", key, {}, files={"out.png": out_path})
                return out_path
            return image_path
        if provider == "cmd" and settings.ENHANCE_CMD:
            cmd = settings.ENHANCE_CMD.replace("{in}", shlex.quote(image_path)) \
                                      .replace("{out}", shlex.quote(out_path))
            proc = await asyncio.create_subprocess_shell(
                cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
            try:
                _, err = await asyncio.wait_for(proc.communicate(), timeout=120)
            except asyncio.TimeoutError:
                proc.kill()
                print("      ⚠️ 补全超时(120s),用原抠图")
                return image_path
            if proc.returncode == 0 and os.path.exists(out_path):
                cache.put("enhance", key, {}, files={"out.png": out_path})
                return out_path
            print(f"      ⚠️ 补全命令失败(rc={proc.returncode}): {(err or b'')[-150:]}")
    except Exception as e:  # noqa: BLE001 增强失败不阻塞量产
        print(f"      ⚠️ 补全异常({type(e).__name__}),用原抠图")
    return image_path
