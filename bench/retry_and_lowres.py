import os, time, base64, json
os.environ["FAL_KEY"] = open(".fal_key").read().strip()
import fal_client, httpx

def data_uri(p):
    return "data:image/jpeg;base64," + base64.b64encode(open(p, "rb").read()).decode()

def find_glb(res):
    url = [None]
    def walk(o):
        if isinstance(o, dict):
            u = o.get("url")
            if isinstance(u, str) and u.split("?")[0].lower().endswith((".glb", ".gltf")):
                url[0] = url[0] or u
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(res)
    return url[0]

def run(label, ep, args, img_path, outdir, name, retries=2):
    os.makedirs(outdir, exist_ok=True)
    for attempt in range(retries):
        try:
            t0 = time.time()
            res = fal_client.subscribe(ep, arguments=args)
            gen = time.time() - t0
            u = find_glb(res)
            if not u:
                print(f"{label:14s} {name:8s} gen {gen:.2f}s 无glb {str(list(res))[:80]}", flush=True); return
            data = httpx.get(u, timeout=180, follow_redirects=True).content
            open(f"{outdir}/{name}.glb", "wb").write(data)
            print(f"{label:14s} {name:8s} gen {gen:6.2f}s  {len(data):>9} B", flush=True)
            return
        except Exception as e:
            print(f"{label:14s} {name:8s} 尝试{attempt+1} ERR {type(e).__name__}: {str(e)[:100]}", flush=True)
            time.sleep(3)

TF = lambda u: {"image_url": u, "ss_sampling_steps": 6, "slat_sampling_steps": 6, "texture_size": 512, "mesh_simplify": 0.9}

# 1) trellis 降步版重测(现在应是热的)
for n in ["sofa", "chair"]:
    run("trellis_fast", "fal-ai/trellis", TF(data_uri(f"evalset/{n}.jpg")), None, "results/fal/trellis_fast", n)
# 2) sam3 带 prompt 重试
for n, p in [("sofa", "sofa"), ("chair", "stool")]:
    run("sam3_objects", "fal-ai/sam-3/3d-objects",
        {"image_url": data_uri(f"evalset/{n}.jpg"), "export_textured_glb": True, "prompt": p},
        None, "results/fal/sam3_objects", n)
# 3) 低清帧 vs 高清:TRELLIS 默认档
for n in ["sofa", "chair", "cabinet"]:
    run("trellis_lowres", "fal-ai/trellis", {"image_url": data_uri(f"evalset_lowres/{n}.jpg")},
        None, "results/fal/trellis_lowres", n)
print("DONE", flush=True)
