from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Condition schemas ──


class RepairConditionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: Optional[str] = None
    scope: str = "damaged"  # damaged | affected
    description: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0


class RepairConditionCreate(RepairConditionBase):
    company_id: Optional[UUID] = None


class RepairConditionUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    scope: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class RepairConditionResponse(RepairConditionBase):
    id: UUID
    company_id: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Template Item schemas ──


class RepairTemplateItemBase(BaseModel):
    condition_id: UUID
    xactimate_item_code: str = Field(..., min_length=1, max_length=50)
    description_override: Optional[str] = None
    default_unit: Optional[str] = None
    is_required: bool = True
    sort_order: int = 0


class RepairTemplateItemCreate(RepairTemplateItemBase):
    pass


class RepairTemplateItemResponse(RepairTemplateItemBase):
    id: UUID
    template_id: UUID
    condition: Optional[RepairConditionResponse] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Suggestion schemas ──


class ConditionSuggestionBase(BaseModel):
    from_condition_id: UUID
    to_condition_id: UUID


class ConditionSuggestionCreate(ConditionSuggestionBase):
    pass


class ConditionSuggestionResponse(ConditionSuggestionBase):
    id: UUID
    template_id: UUID
    from_condition: Optional[RepairConditionResponse] = None
    to_condition: Optional[RepairConditionResponse] = None

    class Config:
        from_attributes = True


# ── Template schemas ──


class TemplateConditionLink(BaseModel):
    condition_id: UUID
    sort_order: int = 0


class RepairTemplateBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    surface: Optional[str] = None
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    is_active: bool = True


class RepairTemplateCreate(RepairTemplateBase):
    company_id: Optional[UUID] = None
    conditions: List[TemplateConditionLink] = Field(default_factory=list)
    items: List[RepairTemplateItemCreate] = Field(default_factory=list)
    suggestions: List[ConditionSuggestionCreate] = Field(default_factory=list)


class RepairTemplateUpdate(BaseModel):
    name: Optional[str] = None
    surface: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    is_active: Optional[bool] = None
    conditions: Optional[List[TemplateConditionLink]] = None
    items: Optional[List[RepairTemplateItemCreate]] = None
    suggestions: Optional[List[ConditionSuggestionCreate]] = None


class RepairTemplateListResponse(RepairTemplateBase):
    id: UUID
    company_id: Optional[UUID] = None
    usage_count: int = 0
    condition_count: int = 0
    item_count: int = 0
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RepairTemplateDetailResponse(RepairTemplateBase):
    id: UUID
    company_id: Optional[UUID] = None
    usage_count: int = 0
    created_by: Optional[UUID] = None
    conditions: List[RepairConditionResponse] = Field(default_factory=list)
    items: List[RepairTemplateItemResponse] = Field(default_factory=list)
    suggestions: List[ConditionSuggestionResponse] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Apply / Compare schemas ──


class TemplateApplyRequest(BaseModel):
    condition_ids: List[UUID]


class AppliedLineItem(BaseModel):
    xactimate_item_code: str
    description: str
    unit: Optional[str] = None
    unit_price: Optional[float] = None
    condition_name: str
    condition_scope: str  # damaged | affected
    is_required: bool = True


class TemplateApplyResponse(BaseModel):
    template_id: UUID
    template_name: str
    items: List[AppliedLineItem]


class TemplateCompareRequest(BaseModel):
    condition_ids: List[UUID]
    extraction_id: UUID
    room_name: Optional[str] = None


class MatchedItem(BaseModel):
    template_item: AppliedLineItem
    extraction_item: Dict[str, Any]
    status: str  # ok, qty_diff, price_diff


class TemplateCompareResponse(BaseModel):
    matched: List[MatchedItem] = Field(default_factory=list)
    missing: List[AppliedLineItem] = Field(default_factory=list)
    extra: List[Dict[str, Any]] = Field(default_factory=list)
