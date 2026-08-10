"""AI furniture recommendation endpoint backed by canonical assets."""

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import settings
from ..services.recommendations import recommend
from ..structured_catalog import StructuredCatalogError


router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])
CATALOG_PATH = Path(settings.STORAGE_DIR) / "catalog" / "structured-assets.v1.json"


class RecommendationRequest(BaseModel):
    mode: Literal["proactive", "space", "replacement"] | None = None
    query: str = Field(default="", max_length=500)
    room: str = Field(default="", max_length=80)
    selectedItemId: str = Field(default="", max_length=120)
    targetCategory: str = Field(default="", max_length=80)
    styles: list[str] = Field(default_factory=list, max_length=20)
    colors: list[str] = Field(default_factory=list, max_length=20)
    seenItemIds: list[str] = Field(default_factory=list, max_length=200)
    limit: int = Field(default=6, ge=1, le=20)


@router.post("")
async def create_recommendations(request: RecommendationRequest):
    try:
        return await recommend(request.model_dump(), CATALOG_PATH)
    except StructuredCatalogError as exc:
        raise HTTPException(503, str(exc)) from exc
