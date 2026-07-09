import os, time, base64, json, mimetypes
os.environ["FAL_KEY"] = open(".fal_key").read().strip()
import fal_client
import httpx

imgs = ["sofa", "chair", "armchair", "plant", "lamp", "cabinet"]
# (标签, fal 模型 id, 图片参数名)
models = [
    ("triposr", "fal-ai/triposr", "image_url"),
    ("trellis", "fal-ai/trellis", "image_url"),
    ("hunyuan", "fal-ai/hunyuan3d/v2", "input_image_url"),
]

results = []


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()


def find_mesh_url(res):
    if not isinstance(res, dict):
        return None
    for k in ("model_mesh", "mesh", "model", "glb", "model_glb"):
        v = res.get(k)
        if isinstance(v, dict) and v.get("url"):
            return v["url"]
        if isinstance(v, str) and v.startswith("http"):
            return v
    for v in res.values():
        if isinstance(v, dict) and isinstance(v.get("url"), str):
            if v["url"].split("?")[0].lower().endswith((".glb", ".obj", ".ply", ".zip", ".gltf")):
                return v["url"]
    return None


def run_model(model_id, argname, uri):
    """先用给定参数名，验证错误则换另一个名字重试一次。"""
    try:
        return fal_client.subscribe(model_id, arguments={argname: uri})
    except Exception as e:
        other = "input_image_url" if argname == "image_url" else "image_url"
        if other in str(e) or "validation" in str(e).lower() or "422" in str(e):
            return fal_client.subscribe(model_id, arguments={other: uri})
        raise


for label, model_id, argname in models:
    outdir = f"results/fal/{label}"
    os.makedirs(outdir, exist_ok=True)
    print(f"=== {label} ({model_id}) ===", flush=True)
    for name in imgs:
        uri = data_uri(f"evalset/{name}.jpg")
        rec = {"model": label, "img": name}
        try:
            t0 = time.time()
            res = run_model(model_id, argname, uri)
            gen = time.time() - t0
            url = find_mesh_url(res)
            rec["gen_sec"] = round(gen, 2)
            if url:
                t1 = time.time()
                data = httpx.get(url, timeout=120, follow_redirects=True).content
                dl = time.time() - t1
                ext = os.path.splitext(url.split("?")[0])[1] or ".glb"
                dst = os.path.join(outdir, name + ext)
                with open(dst, "wb") as f:
                    f.write(data)
                rec["dl_sec"] = round(dl, 2)
                rec["bytes"] = len(data)
                rec["file"] = dst
                print(f"{label:8s} {name:9s} gen {gen:6.2f}s  dl {dl:5.2f}s  {len(data):>9} B", flush=True)
            else:
                rec["error"] = "no mesh url; keys=" + ",".join(res.keys() if isinstance(res, dict) else [])
                print(f"{label:8s} {name:9s} gen {gen:.2f}s  但没找到 mesh url: {list(res)[:6]}", flush=True)
        except Exception as e:
            rec["error"] = f"{type(e).__name__}: {str(e)[:120]}"
            print(f"{label:8s} {name:9s} ERR {type(e).__name__}: {str(e)[:120]}", flush=True)
        results.append(rec)
        json.dump(results, open("results/fal/bench.json", "w"), ensure_ascii=False, indent=2)

# 汇总
print("\n=== 汇总 (平均 gen 秒) ===", flush=True)
for label, _, _ in models:
    ok = [r for r in results if r["model"] == label and "gen_sec" in r]
    if ok:
        avg = sum(r["gen_sec"] for r in ok) / len(ok)
        print(f"{label:8s} 平均 {avg:5.2f}s  成功 {len(ok)}/{len(imgs)}", flush=True)
print("DONE", flush=True)
