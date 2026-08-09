"""结构化资产目录的纯文件读取层，与 FastAPI 路由解耦。"""
import json
from pathlib import Path


class StructuredCatalogError(RuntimeError):
    pass


def load_structured_catalog(path: Path) -> dict:
    if not path.is_file():
        raise StructuredCatalogError("structured asset catalog is not built")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StructuredCatalogError("structured asset catalog is unreadable") from exc
    if payload.get("schema_version") != 1 or not isinstance(payload.get("assets"), list):
        raise StructuredCatalogError("structured asset catalog has an unsupported schema")
    return payload
