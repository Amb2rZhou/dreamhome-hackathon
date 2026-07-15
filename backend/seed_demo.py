"""灌 demo 种子数据：6 个 ready 资产 + 1 个已索引视频(带合成轨迹) + 1 个未索引视频。

用途：前端(资产库/暂停高亮/全选)在离线 pipeline 就绪前即可联调。
用法：cd backend && python seed_demo.py   (重复跑会先清空再灌)
"""
import math
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app import db  # noqa: E402
from app.config import settings  # noqa: E402

GALLERY = os.path.join(os.path.dirname(__file__), "..", "web", "assets", "gallery")
# 占位 GLB 从本机 /samples 出(国内环境不能依赖境外静态源)
SAMPLE_GLB = "{base}/samples/{name}.glb"

# name, space, labels, 占位 GLB(Khronos 示例，真 GLB 由 pipeline 替换)
ASSETS = [
    ("绿绒复古三人沙发", "客厅", {"category": "沙发", "sub": "三人沙发", "colors": ["绿色"],
     "materials": ["布艺"], "styles": ["复古"], "features": ["簇绒", "圆弧扶手"], "size_class": "大"},
     "sofa.jpg", "SheenChair"),
    ("白色簇绒扶手椅", "客厅", {"category": "单椅", "sub": "扶手椅", "colors": ["白色"],
     "materials": ["布艺"], "styles": ["现代"], "features": ["簇绒"], "size_class": "中"},
     "armchair.jpg", "SheenChair"),
    ("实木细腿吧凳", "餐厨", {"category": "单椅", "sub": "吧凳", "colors": ["棕色"],
     "materials": ["实木"], "styles": ["复古"], "features": ["细腿", "横档"], "size_class": "小"},
     "chair.jpg", "SheenChair"),
    ("黑色金属多头吊灯", "客厅", {"category": "灯具", "sub": "吊灯", "colors": ["黑色"],
     "materials": ["金属"], "styles": ["工业风"], "features": ["多头"], "size_class": "中"},
     "lamp.jpg", "Duck"),
    ("原木色带抽屉边柜", "卧室", {"category": "柜子", "sub": "边柜", "colors": ["原木色"],
     "materials": ["实木"], "styles": ["北欧"], "features": ["带抽屉"], "size_class": "中"},
     "cabinet.jpg", "BoxTextured"),
    ("多肉盆栽", "通用", {"category": "绿植", "sub": "多肉", "colors": ["绿色"],
     "materials": [], "styles": [], "features": ["盆栽"], "size_class": "小"},
     "plant.jpg", "BoxTextured"),
]


def synth_frames(t0: float, t1: float, x0: float, y0: float, w: float, h: float,
                 drift: float = 0.12, step: float = 0.2) -> list[dict]:
    """合成一条平滑漂移的轨迹(模拟运镜)，采样间隔 step 秒。"""
    frames, t = [], t0
    while t <= t1 + 1e-9:
        p = (t - t0) / max(t1 - t0, 1e-9)
        x = x0 + drift * math.sin(p * math.pi)
        y = y0 + drift * 0.4 * p
        frames.append({"t": round(t, 2), "bbox": [round(x, 3), round(y, 3), w, h]})
        t += step
    return frames


def main() -> None:
    conn = db.get_conn()
    for table in ("videos", "tracks", "assets", "user_library"):
        conn.execute(f"DELETE FROM {table}")
    conn.commit()

    thumb_dir = os.path.join(os.path.abspath(settings.STORAGE_DIR), "thumbs")
    os.makedirs(thumb_dir, exist_ok=True)

    asset_ids = []
    for name, space, labels, img, glb_name in ASSETS:
        src = os.path.join(GALLERY, img)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(thumb_dir, img))
        aid = db.insert_asset(
            name=name, space=space, labels=labels,
            glb_url=SAMPLE_GLB.format(base=settings.PUBLIC_BASE_URL, name=glb_name),
            thumb_url=f"{settings.PUBLIC_BASE_URL}/storage/thumbs/{img}",
            source={}, status="ready", created_by="preset",
        )
        asset_ids.append(aid)

    # 视频1：已离线索引，客厅场景 0-12s，四个资产轮流出现
    v1 = db.insert_video(title="奶油风客厅改造 vlog", source_url="https://v.douyin.com/demo1",
                         duration=12.0, status="indexed", index_source="offline")
    specs = [  # (asset_idx, t0, t1, x, y, w, h)
        (0, 0.0, 8.0, 0.08, 0.45, 0.42, 0.38),   # 沙发
        (1, 2.0, 10.0, 0.58, 0.50, 0.24, 0.30),  # 扶手椅
        (3, 0.0, 12.0, 0.40, 0.05, 0.18, 0.25),  # 吊灯
        (5, 5.0, 12.0, 0.72, 0.68, 0.12, 0.15),  # 多肉
    ]
    for idx, t0, t1, x, y, w, h in specs:
        frames = synth_frames(t0, t1, x, y, w, h)
        db.insert_track(v1, ASSETS[idx][2]["category"], frames, t_start=t0, t_end=t1,
                        best_frame_t=round((t0 + t1) / 2, 2), asset_id=asset_ids[idx])
        db.update_asset(asset_ids[idx], source={"video_id": v1, "track_id": "", "t_best": round((t0 + t1) / 2, 2)})
    # 一条没入库的 track(检测到但没人圈过 → 前端不闪烁、可圈选)
    db.insert_track(v1, "地毯", synth_frames(3.0, 9.0, 0.20, 0.75, 0.5, 0.2, drift=0.05),
                    t_start=3.0, t_end=9.0, best_frame_t=6.0, asset_id=None)

    # 视频2：未索引，演示实时 /detect + lazy 写回
    v2 = db.insert_video(title="小户型卧室爆改", source_url="https://v.douyin.com/demo2",
                         duration=20.0, status="unindexed")

    print(f"seeded: {len(asset_ids)} assets, video indexed={v1}, unindexed={v2}")


if __name__ == "__main__":
    main()
