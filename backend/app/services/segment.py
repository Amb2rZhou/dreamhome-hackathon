"""把家具从背景里抠出来，得到干净单体图，喂给 3D 生成质量更好。

策略(逐级退化，保证永远能出结果)：
1. 有 bbox → 先按框裁剪(用户圈选)。
2. 有 rembg → 去背景，留透明 PNG(家具单体是它的强项)。
3. 都没有 → 原图直接返回。
真正的视频跨帧追踪(SAM 3)在 frames 层之外，属于进阶，这里先做单帧抠图。
"""
from typing import Optional, Tuple


def isolate_object(
    image_path: str,
    out_path: str,
    bbox: Optional[Tuple[int, int, int, int]] = None,
) -> str:
    """抠出主体，返回处理后图片路径。"""
    cropped = image_path
    if bbox:
        cropped = _crop(image_path, out_path, bbox) or image_path

    try:
        from rembg import remove  # type: ignore
        from PIL import Image  # type: ignore
    except ImportError:
        return cropped  # 无 rembg：返回(裁剪后的)原图

    try:
        with Image.open(cropped).convert("RGBA") as im:
            out = remove(im)
            # 贴到白底上，避免部分生成模型不吃透明通道
            bg = Image.new("RGBA", out.size, (255, 255, 255, 255))
            bg.paste(out, (0, 0), out)
            bg.convert("RGB").save(out_path)
        return out_path
    except Exception:
        return cropped


def _crop(image_path: str, out_path: str, bbox: Tuple[int, int, int, int]) -> Optional[str]:
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return None
    x, y, w, h = bbox
    with Image.open(image_path) as im:
        im.crop((x, y, x + w, y + h)).save(out_path)
    return out_path
