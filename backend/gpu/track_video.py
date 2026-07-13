"""
视频入库追踪 —— 把一段视频里的家具追成 tracklet,产出「闪烁锚点」用的 JSON。
这是 step 6(闪烁数据链)的起点,也是产品最出彩的部分。

⚠️ 说明:
- 本脚本用**官方 sam2** 的视频预测器(mask 沿全片传播,抗遮挡),它比抠图服务用的
  ultralytics 版更适合做长视频追踪。建议**单独建一个 venv** 装官方 sam2,别和抠图服务混。
  安装(A10 已装好 CUDA 驱动的前提下):
     pip install "git+https://github.com/facebookresearch/sam2.git"
     # 权重:从 ModelScope 或官方下载 sam2.1_hiera_base_plus.pt 及其 yaml 配置
- 播种框(frame 0 上每个家具的框)当前用**命令行手动传**,demo 视频足够。
  以后接 GroundingDINO / YOLO-World 自动检测家具来播种(见文末 TODO)。

用法:
  python track_video.py --video demo.mp4 \
      --seed-frame 0 \
      --boxes "120,80,520,600,sofa; 640,300,760,520,lamp" \
      --out demo.tracklets.json --fps-sample 6

产出 JSON(前端消费的稳定契约):
  {
    "video": "demo.mp4", "width":W, "height":H, "fps": 30.0,
    "objects": [
      { "objectId": 1, "label": "sofa", "assetId": null,
        "frames": [
          { "t": 0.00, "bbox":[x1,y1,x2,y2], "cx":.., "cy":.., "visArea":0.0-1.0, "visible": true },
          ...
        ] }
    ]
  }
前端在 timeupdate/暂停时:二分 t → 插值 bbox → 在 (cx,cy) 画跳动圆环;
visible=false 或 visArea<阈值 则不画。assetId 非空才算「已生成」。
"""
import os
import json
import argparse
import tempfile

import numpy as np
import cv2


def parse_boxes(s):
    """'x1,y1,x2,y2,label; ...' -> [ (label, [x1,y1,x2,y2]) ]"""
    out = []
    for part in s.split(";"):
        part = part.strip()
        if not part:
            continue
        a = part.split(",")
        x1, y1, x2, y2 = [float(v) for v in a[:4]]
        label = a[4].strip() if len(a) > 4 else "object"
        out.append((label, [x1, y1, x2, y2]))
    return out


def extract_frames(video_path, out_dir):
    """官方 sam2 的 init_state 需要一个 JPEG 帧目录(00000.jpg...)。"""
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        cv2.imwrite(os.path.join(out_dir, f"{i:05d}.jpg"), frame)
        i += 1
    cap.release()
    return fps, W, H, i


def mask_stats(mask, W, H):
    """从二值 mask 算 bbox、可见质心、可见面积占比。"""
    ys, xs = np.where(mask)
    if xs.size == 0:
        return None
    x1, x2, y1, y2 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    cx, cy = float(xs.mean()), float(ys.mean())          # 可见 mask 质心(半露时锚这里)
    vis_area = float(mask.sum()) / float(W * H)          # 占全画面比例
    return {"bbox": [x1, y1, x2, y2], "cx": cx, "cy": cy, "visArea": round(vis_area, 5)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--boxes", required=True, help="'x1,y1,x2,y2,label; ...' frame0 上的播种框")
    ap.add_argument("--seed-frame", type=int, default=0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fps-sample", type=float, default=6.0, help="tracklet 关键帧采样率")
    ap.add_argument("--min-vis", type=float, default=0.003, help="低于此可见面积占比记 visible=false")
    ap.add_argument("--ckpt", default="sam2.1_hiera_base_plus.pt")
    ap.add_argument("--cfg", default="configs/sam2.1/sam2.1_hiera_b+.yaml")
    args = ap.parse_args()

    seeds = parse_boxes(args.boxes)

    with tempfile.TemporaryDirectory() as frames_dir:
        fps, W, H, n = extract_frames(args.video, frames_dir)
        step = max(1, int(round(fps / args.fps_sample)))  # 每隔 step 帧记一个关键帧

        # —— 官方 sam2 视频预测器 —— #
        from sam2.build_sam import build_sam2_video_predictor
        predictor = build_sam2_video_predictor(args.cfg, args.ckpt)
        state = predictor.init_state(video_path=frames_dir)

        # 在 seed-frame 上把每个家具的框喂进去,分配 objectId
        objects = []
        for obj_id, (label, box) in enumerate(seeds, start=1):
            predictor.add_new_points_or_box(
                inference_state=state,
                frame_idx=args.seed_frame,
                obj_id=obj_id,
                box=np.array(box, dtype=np.float32),
            )
            objects.append({"objectId": obj_id, "label": label, "assetId": None, "frames": []})
        by_id = {o["objectId"]: o for o in objects}

        # 沿全片传播,逐帧取每个物体的 mask
        for frame_idx, obj_ids, mask_logits in predictor.propagate_in_video(state):
            if frame_idx % step != 0:
                continue
            t = round(frame_idx / fps, 3)
            for k, oid in enumerate(obj_ids):
                m = (mask_logits[k] > 0.0).cpu().numpy()
                if m.ndim == 3:
                    m = m[0]
                st = mask_stats(m, W, H)
                rec = {"t": t, "bbox": None, "cx": None, "cy": None, "visArea": 0.0, "visible": False}
                if st is not None:
                    rec.update(st)
                    rec["visible"] = st["visArea"] >= args.min_vis
                by_id[int(oid)]["frames"].append(rec)

    out = {
        "video": os.path.basename(args.video),
        "width": W, "height": H, "fps": fps,
        "objects": objects,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"✓ 写出 {args.out}:{len(objects)} 个物体,视频 {n} 帧 @ {fps:.1f}fps")


# TODO(自动播种):接 GroundingDINO / YOLO-World,对 seed-frame 用
#   prompt="sofa. chair. lamp. table. cabinet. plant." 检测出所有家具框,
#   替代 --boxes 手动输入。demo 阶段手动播种已够。
# TODO(镜头切分):长视频先用 PySceneDetect 切镜头,逐镜头各自 init_state,
#   避免跨镜头把不同物体追串。
if __name__ == "__main__":
    main()
