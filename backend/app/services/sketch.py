"""草图预处理：把手绘线稿洗干净再喂 3D 底座。

MVP：二值化 + 白底黑线归一，去掉纸张阴影/网格。
进阶(留接口)：线稿→ControlNet 上色效果图→3D，两段式更稳，这里先出干净线稿。
无 PIL 时原样返回。
"""


def clean_sketch(image_path: str, out_path: str) -> str:
    try:
        from PIL import Image, ImageOps  # type: ignore
    except ImportError:
        return image_path

    with Image.open(image_path).convert("L") as im:  # 转灰度
        # 自动对比度拉伸，弱化纸张底色
        im = ImageOps.autocontrast(im, cutoff=2)
        # 阈值二值化：深于阈值→黑线，其余→白
        bw = im.point(lambda p: 0 if p < 128 else 255, mode="1")
        bw.convert("RGB").save(out_path)
    return out_path
