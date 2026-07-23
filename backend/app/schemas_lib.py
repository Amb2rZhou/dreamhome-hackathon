"""资产库对外数据结构(asset-library-plan.md 第四节)。

bbox 一律归一化 [x, y, w, h]，原点左上。
"""
from typing import List, Literal, Optional, Union
from pydantic import BaseModel, Field


class Labels(BaseModel):
    """结构化标签：既是资产元数据，也是同款匹配依据；合并时取并集。"""
    category: str = ""                 # 品类：沙发/单椅/床/柜/桌/灯…(匹配硬过滤)
    sub: str = ""                      # 子品类：三人沙发/吊灯…
    colors: List[str] = Field(default_factory=list)
    materials: List[str] = Field(default_factory=list)
    styles: List[str] = Field(default_factory=list)
    features: List[str] = Field(default_factory=list)   # 形态特征：圆弧扶手/细腿/簇绒…
    size_class: str = ""               # 尺寸档：小/中/大
    mount: str = ""                    # 挂载类型:floor/wall/ceiling/surface(T5,决定场景内拖拽锚定面)
    special: bool = False              # 专项库资产标记(窗户/吊顶/地板/光线/窗外景观,不进常规资产库)


class AssetSource(BaseModel):
    video_id: str = ""
    track_id: Optional[str] = ""       # 手动图生3D的资产可能没有 track,容忍 null
    t_best: float = 0                  # 资产详情页跳原视频的时间点


class AssetOut(BaseModel):
    asset_id: str
    name: str = ""
    space: str = ""
    labels: Labels = Field(default_factory=Labels)
    size_prior: Optional[Union[List[float], dict]] = None   # 手动图生3D写的是 {w,h,d} 对象,两种都容忍
    glb_url: str = ""
    thumb_url: str = ""
    source: AssetSource = Field(default_factory=AssetSource)
    merged_from: List[str] = Field(default_factory=list)
    status: str = "ready"
    created_by: str = "preset"


class VideoOut(BaseModel):
    video_id: str
    title: str = ""
    source_url: str = ""
    play_url: str = ""
    cover_url: str = ""
    duration: float = 0
    status: str = "unindexed"          # unindexed|processing|indexed
    index_source: str = ""


class FramePoint(BaseModel):
    t: float
    bbox: List[float]                  # [x,y,w,h] 归一化


class TrackOut(BaseModel):
    track_id: str
    category: str = ""
    t_start: float = 0
    t_end: float = 0
    frames: List[FramePoint] = Field(default_factory=list)
    best_frame_t: float = 0
    asset_id: Optional[str] = None     # 空 = 没人圈过，可圈选


class VideoIndex(BaseModel):
    """整包时空索引：前端加载视频时取一次，暂停本地二分查表。"""
    video_id: str
    status: str
    tracks: List[TrackOut] = Field(default_factory=list)


class DetectBox(BaseModel):
    bbox: List[float]
    category: str = ""
    score: float = 0
    track_id: Optional[str] = None     # 命中已有 track(lazy 缓存/离线索引)
    asset_id: Optional[str] = None     # 非空 = 已入库，闪烁可点击


class DetectResponse(BaseModel):
    video_id: str
    t: float
    boxes: List[DetectBox] = Field(default_factory=list)
    provider: str = "mock"


class SelectRequest(BaseModel):
    t: float
    bbox: List[float]
    frame_data_uri: Optional[str] = None   # 前端截帧(dataURI)；不传则服务端尝试从视频抽帧
    polygon: List[List[float]] = Field(default_factory=list)  # 原始帧归一化手绘圈；仅作选择意图
    frame_width: Optional[int] = None
    frame_height: Optional[int] = None
    category_hint: str = ""                # 检测框的品类(前端从 detect 结果透传)
    track_id: Optional[str] = None         # 圈的是 detect 返回的框时透传，复用该 track 不新建


class MatchCandidate(BaseModel):
    asset: AssetOut
    score: float                       # 标签重合度 0-1
    reason: str = ""                   # 命中了哪些标签，给前端展示


class SelectResponse(BaseModel):
    select_id: str
    labels: Labels                     # 本次圈选提取出的标签
    candidates: List[MatchCandidate] = Field(default_factory=list)
    # Deterministic same-video hit (bound track/manual annotation).  Unlike
    # ``candidates``, this may be reused automatically without asking the user
    # to judge whether two merely similar pieces of furniture are identical.
    exact_match: Optional[MatchCandidate] = None


class SelectConfirmRequest(BaseModel):
    select_id: str
    use_asset_id: Optional[str] = None  # 确认同款：挂现有资产，不重新生成
    generate_new: bool = False          # 生成新资产
    reject_matched_asset: bool = False  # 用户已看过候选并明确否决，允许重新生成
    quality_mode: Literal["fast", "production"] = "fast"
    user_id: str = ""                   # 有明确用户身份时才自动加入素材库


class SelectConfirmResponse(BaseModel):
    asset_id: Optional[str] = None
    job_id: Optional[str] = None        # generate_new 时轮询 /api/jobs/{id}
    track_id: str = ""
    quality_mode: Literal["reuse", "fast", "production"] = "reuse"
    library_attached: bool = False


class LibraryAddRequest(BaseModel):
    asset_ids: List[str]
    via: str = "batch"                  # 全选/单击/圈选
    user_id: str = "demo"               # demo 阶段单用户，联调期由前端透传


class MergeRequest(BaseModel):
    keep_id: str
    drop_id: str
