import os, time, base64, json
os.environ["FAL_KEY"] = open(".fal_key").read().strip()
import fal_client

def data_uri(p):
    return "data:image/jpeg;base64," + base64.b64encode(open(p, "rb").read()).decode()

def run(tag, args):
    t0 = time.time()
    h = fal_client.submit("fal-ai/trellis", arguments=args)
    t_submitted = time.time()
    first_progress = None
    logs_seen = []
    while True:
        s = h.status(with_logs=True)
        now = time.time()
        cls = type(s).__name__
        if cls == "InProgress" and first_progress is None:
            first_progress = now
        for l in (getattr(s, "logs", None) or []):
            m = l.get("message", "")
            if m and m not in [x[1] for x in logs_seen]:
                logs_seen.append((round(now - t0, 2), m))
        if cls == "Completed":
            t_done = now
            break
        time.sleep(0.5)
    h.get()
    q = (first_progress or t_submitted) - t_submitted
    ex = t_done - (first_progress or t_submitted)
    print(f"[{tag}] 提交往返 {t_submitted-t0:.2f}s | 排队 {q:.2f}s | 执行 {ex:.2f}s | 总 {t_done-t0:.2f}s", flush=True)
    for ts, m in logs_seen[:25]:
        print(f"    t+{ts:6.2f}s  {m[:110]}", flush=True)

u = data_uri("evalset/chair.jpg")
run("默认12步 #1", {"image_url": u})
run("默认12步 #2", {"image_url": u})
run("降步6步", {"image_url": u, "ss_sampling_steps": 6, "slat_sampling_steps": 6, "texture_size": 512})
print("DONE", flush=True)
