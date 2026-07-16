"""GLB 材质修正:trimesh 导出默认 baseColorFactor=0.4 灰 + metallic 缺省=1(全金属),
在标准查看器里整体发黑。统一改为 白色因子 + 非金属,纹理按原色显示。

用法: python3 glb_material_fix.py <file.glb 或目录>
也被 server_gen3d.py 在导出后调用。
"""
import json
import os
import struct
import sys


def fix_glb_material(path: str) -> bool:
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"glTF":
        return False
    try:
        json_len = struct.unpack("<I", data[12:16])[0]
        gltf = json.loads(data[20:20 + json_len])
    except (json.JSONDecodeError, struct.error):
        return False  # 非标准 GLB(如测试桩文件),跳过
    changed = False
    for mat in gltf.get("materials", []):
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        if pbr.get("baseColorFactor") != [1.0, 1.0, 1.0, 1.0]:
            pbr["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]
            changed = True
        if pbr.get("metallicFactor") != 0.0:
            pbr["metallicFactor"] = 0.0
            changed = True
    if not changed:
        return False
    body = json.dumps(gltf, separators=(",", ":")).encode()
    body += b" " * ((4 - len(body) % 4) % 4)  # 4字节对齐,空格填充
    rest = data[20 + json_len:]               # BIN chunk 原样保留
    total = 12 + 8 + len(body) + len(rest)
    out = (b"glTF" + struct.pack("<II", 2, total) +
           struct.pack("<I", len(body)) + b"JSON" + body + rest)
    with open(path, "wb") as f:
        f.write(out)
    return True


if __name__ == "__main__":
    target = sys.argv[1]
    files = ([os.path.join(target, n) for n in os.listdir(target) if n.endswith(".glb")]
             if os.path.isdir(target) else [target])
    n = sum(fix_glb_material(p) for p in files)
    print(f"fixed {n}/{len(files)}")
