import os, time, base64, json
os.environ["FAL_KEY"] = open(".fal_key").read().strip()
import fal_client, httpx

def data_uri(p):
    return "data:image/jpeg;base64," + base64.b64encode(open(p, "rb").read()).decode()

CANDS = [
    ("hy_turbo_tex",  "fal-ai/hunyuan3d/v2/turbo",      lambda u: {"input_image_url": u, "textured_mesh": True}),
    ("hy_mini_turbo", "fal-ai/hunyuan3d/v2/mini/turbo", lambda u: {"input_image_url": u, "textured_mesh": True}),
    ("trellis_fast",  "fal-ai/trellis",                 lambda u: {"image_url": u, "ss_sampling_steps": 6, "slat_sampling_steps": 6, "texture_size": 512, "mesh_simplify": 0.9}),
    ("sam3_objects",  "fal-ai/sam-3/3d-objects",        lambda u: {"image_url": u, "export_textured_glb": True}),
]
imgs = ["sofa", "chair"]
results = []
for label, ep, argf in CANDS:
    os.makedirs(f"results/fal/{label}", exist_ok=True)
    for name in imgs:
        rec = {"model": label, "img": name}
        try:
            t0 = time.time()
            res = fal_client.subscribe(ep, arguments=argf(data_uri(f"evalset/{name}.jpg")))
            rec["gen_sec"] = round(time.time() - t0, 2)
            url = None
            def walk(o):
                global url
                if isinstance(o, dict):
                    u = o.get("url")
                    if isinstance(u, str) and u.split("?")[0].lower().endswith((".glb", ".gltf")):
                        url = url or u
                    for v in o.values(): walk(v)
                elif isinstance(o, list):
                    for v in o: walk(v)
            walk(res)
            if url:
                t1 = time.time()
                data = httpx.get(url, timeout=180, follow_redirects=True).content
                rec["dl_sec"] = round(time.time() - t1, 2)
                rec["bytes"] = len(data)
                open(f"results/fal/{label}/{name}.glb", "wb").write(data)
                print(f"{label:14s} {name:6s} gen {rec['gen_sec']:6.2f}s  dl {rec['dl_sec']:5.2f}s  {len(data):>9} B", flush=True)
            else:
                rec["error"] = "no glb url; keys=" + str(list(res))[:100]
                print(f"{label:14s} {name:6s} gen {rec['gen_sec']}s  无glb: {str(list(res))[:80]}", flush=True)
        except Exception as e:
            rec["error"] = f"{type(e).__name__}: {str(e)[:150]}"
            print(f"{label:14s} {name:6s} ERR {rec['error']}", flush=True)
        results.append(rec)
        json.dump(results, open("results/fal/fast_candidates.json", "w"), indent=2)
print("DONE", flush=True)
