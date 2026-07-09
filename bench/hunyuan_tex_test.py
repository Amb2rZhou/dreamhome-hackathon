import os, time, base64, mimetypes, json
os.environ["FAL_KEY"] = open(".fal_key").read().strip()
import fal_client, httpx

def data_uri(p):
    return "data:image/jpeg;base64," + base64.b64encode(open(p, "rb").read()).decode()

os.makedirs("results/fal/hunyuan_tex", exist_ok=True)
for name in ["sofa", "chair"]:
    t0 = time.time()
    res = fal_client.subscribe("fal-ai/hunyuan3d/v2", arguments={
        "input_image_url": data_uri(f"evalset/{name}.jpg"), "textured_mesh": True})
    gen = time.time() - t0
    url = None
    for v in res.values():
        if isinstance(v, dict) and str(v.get("url", "")).split("?")[0].endswith(".glb"):
            url = v["url"]
    print(name, f"gen {gen:.2f}s", "keys:", list(res))
    if url:
        data = httpx.get(url, timeout=120, follow_redirects=True).content
        open(f"results/fal/hunyuan_tex/{name}.glb", "wb").write(data)
        print(name, "saved", len(data), "B")
print("DONE")
