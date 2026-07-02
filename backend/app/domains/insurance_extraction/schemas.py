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
