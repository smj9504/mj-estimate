from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class InsuranceExtractionItemBase(BaseModel):
    room: Optional[str] = None
    line_item: str = Field(..., min_length=1)
    notes: Optional[str] = None
    unit_price: Optional[Decimal] = None
    quantity: Optional[Decimal] = None
    measurement: Optional[str] = None
    unit: Optional[str] = None
    source_page: Optional[int] = None
    confidence: Optional[Decimal] = None
    raw_line: Optional[str] = None
    token_offsets: Optional[Dict[str, Any]] = None
    validation_flags: List[str] = Field(default_factory=list)
    sort_order: int = 0


class InsuranceExtractionItemResponse(InsuranceExtractionItemBase):
    id: UUID

    class Config:
        from_attributes = True


class InsuranceExtractionResponse(BaseModel):
    id: UUID
    file_id: str
    carrier: Optional[str] = None
    status: str
    pages: int
    raw_text_excerpt: Optional[str] = None
    parser_metadata: Dict[str, Any] = Field(default_factory=dict)
    items: List[InsuranceExtractionItemResponse] = Field(default_factory=list)
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class InsuranceExtractionListResponse(BaseModel):
    """Lightweight response for list endpoint — no items, no raw_text."""
    id: UUID
    file_id: str
    carrier: Optional[str] = None
    status: str
    pages: int
    item_count: int = 0
    parser_metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class InsuranceExtractionItemUpdate(BaseModel):
    id: Optional[UUID] = None
    room: Optional[str] = None
    line_item: str = Field(..., min_length=1)
    notes: Optional[str] = None
    unit_price: Optional[Decimal] = None
    quantity: Optional[Decimal] = None
    measurement: Optional[str] = None
    unit: Optional[str] = None
    source_page: Optional[int] = None
    confidence: Optional[Decimal] = None
    raw_line: Optional[str] = None
    token_offsets: Optional[Dict[str, Any]] = None
    validation_flags: List[str] = Field(default_factory=list)
    sort_order: int = 0


class InsuranceExtractionUpdateRequest(BaseModel):
    carrier: Optional[str] = None
    status: Optional[str] = None
    raw_text_excerpt: Optional[str] = None
    parser_metadata: Optional[Dict[str, Any]] = None
    items: List[InsuranceExtractionItemUpdate] = Field(default_factory=list)


# ── Analysis response schemas ──


class CategorizedItem(BaseModel):
    item_id: str
    line_item: str
    surface_category: str  # wall, floor, ceiling, general
    quantity: Optional[Decimal] = None
    unit: Optional[str] = None
    unit_price: Optional[Decimal] = None


class RoomAnalysisResponse(BaseModel):
    room_name: str
    level_name: str = ""
    dimensions: Dict[str, float] = Field(default_factory=dict)
    height_ft: Optional[float] = None
    items_by_surface: Dict[str, List[CategorizedItem]] = Field(default_factory=dict)
    item_count: int = 0


class SectionAnalysisResponse(BaseModel):
    section_name: str
    kind: str = "section"
    items_by_surface: Dict[str, List[CategorizedItem]] = Field(default_factory=dict)
    item_count: int = 0


class AnalysisSummary(BaseModel):
    total_items: int = 0
    by_category: Dict[str, int] = Field(default_factory=dict)


class ExtractionAnalysisResponse(BaseModel):
    extraction_id: UUID
    rooms: List[RoomAnalysisResponse] = Field(default_factory=list)
    sections: List[SectionAnalysisResponse] = Field(default_factory=list)
    unassigned_items: Dict[str, List[CategorizedItem]] = Field(default_factory=dict)
    summary: AnalysisSummary = Field(default_factory=AnalysisSummary)


class InsuranceExtractionToEstimateItem(BaseModel):
    room: Optional[str] = None
    name: str
    quantity: float
    unit: str
    rate: float
    raw_line: Optional[str] = None
    source_page: Optional[int] = None
    confidence: float = 0.0


class InsuranceExtractionToEstimateResponse(BaseModel):
    extraction_id: UUID
    items: List[InsuranceExtractionToEstimateItem]
