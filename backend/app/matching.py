"""同款匹配：品类硬过滤 + 标签重合度排序。

只出建议、从不判定——结果给用户/审核确认(asset-library-plan.md 核心设计 B)。
embedding 余弦留了钩子作并列排序辅助，hackathon 体量 numpy 都不必引。
"""
import json
import struct
from typing import Optional

from . import db

# 参与重合度计算的列表字段及权重(品类是硬过滤不在此)
_FIELDS = {"colors": 1.0, "materials": 1.2, "styles": 0.8, "features": 1.5}
_SUGGEST_THRESHOLD = 0.35   # 只影响建议召回，不影响正确性；粗标即可
_TOP_K = 3


def _overlap(a: dict, b: dict) -> tuple[float, list[str]]:
    """加权 Jaccard；返回 (分数, 命中标签列表) 供前端展示理由。"""
    score_num, score_den, hits = 0.0, 0.0, []
    for field, w in _FIELDS.items():
        sa, sb = set(a.get(field) or []), set(b.get(field) or [])
        if not sa and not sb:
            continue
        inter = sa & sb
        score_num += w * len(inter)
        score_den += w * len(sa | sb)
        hits += sorted(inter)
    if a.get("sub") and a.get("sub") == b.get("sub"):
        score_num += 1.0
        hits.insert(0, a["sub"])
    score_den += 1.0
    if a.get("size_class") and a.get("size_class") == b.get("size_class"):
        score_num += 0.3
    score_den += 0.3
    return (score_num / score_den if score_den else 0.0), hits


def match_candidates(labels: dict, *, exclude_asset_ids: Optional[set] = None) -> list[dict]:
    """拿一次圈选/入库的标签，返回库内疑似同款 top-k：
    [{asset_id, score, reason}]，score 降序。品类不同直接不候选。
    """
    category = labels.get("category", "")
    if not category:
        return []
    out = []
    for row in db.all_assets_raw(status="ready"):
        if exclude_asset_ids and row["asset_id"] in exclude_asset_ids:
            continue
        asset_labels = json.loads(row["labels_json"] or "{}")
        if asset_labels.get("category") != category:
            continue
        score, hits = _overlap(labels, asset_labels)
        if score >= _SUGGEST_THRESHOLD:
            out.append({"asset_id": row["asset_id"], "score": round(score, 3),
                        "reason": "、".join(hits[:5])})
    out.sort(key=lambda x: -x["score"])
    return out[:_TOP_K]


def pack_embedding(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def unpack_embedding(blob: bytes) -> list[float]:
    return list(struct.unpack(f"{len(blob) // 4}f", blob))


def _cos(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))  # 向量已归一化


# 外观相似度阈值:≥0.90 几乎必是同款;标签重合仅在无 embedding 时兜底
_EMBED_DUP_THRESHOLD = 0.90


def duplicate_pairs() -> list[dict]:
    """审核页用：全库扫"疑似重复"资产对。
    主判据 CLIP 外观向量(标签是 mock/粗标签时也不误报);无向量时退回标签重合。
    百级资产 O(n²) 无压力。"""
    rows = db.all_assets_raw(status="ready")
    parsed = []
    for r in rows:
        emb = unpack_embedding(r["embedding"]) if r["embedding"] else None
        parsed.append((r["asset_id"], json.loads(r["labels_json"] or "{}"), emb))
    pairs = []
    for i in range(len(parsed)):
        for j in range(i + 1, len(parsed)):
            ida, la, ea = parsed[i]
            idb, lb, eb = parsed[j]
            if la.get("category") != lb.get("category"):
                continue
            if ea is not None and eb is not None:
                sim = _cos(ea, eb)
                if sim >= _EMBED_DUP_THRESHOLD:
                    pairs.append({"a": ida, "b": idb, "score": round(sim, 3),
                                  "reason": f"外观相似 {sim:.0%}"})
                continue  # 有向量就以向量为准,不再看标签
            score, hits = _overlap(la, lb)
            if score >= _SUGGEST_THRESHOLD:
                pairs.append({"a": ida, "b": idb, "score": round(score, 3),
                              "reason": "标签重合:" + "、".join(hits[:5])})
    pairs.sort(key=lambda x: -x["score"])
    return pairs
