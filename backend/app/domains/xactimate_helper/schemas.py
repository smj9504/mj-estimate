"""
Xactimate Helper Tool - Pydantic Schemas (Request / Response)
"""

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ─── Line Item ────────────────────────────────────────────────────────────────


class XactLineItemBase(BaseModel):
    item_code: str
    category: str
    description: Optional[str] = None
    unit: Optional[str] = None
    unit_price: float = 0.0
    definition: Optional[Dict[str, Any]] = None
    is_active: bool = True


class XactLineItemResponse(XactLineItemBase):
    id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class XactLineItemSearchRequest(BaseModel):
    query: Optional[str] = None
    category: Optional[str] = None
    is_active: Optional[bool] = True
    limit: int = Field(default=20, le=100)
    offset: int = 0


# ─── Assembly ─────────────────────────────────────────────────────────────────


class XactAssemblyItemBase(BaseModel):
    item_code: str
    condition: Optional[str] = None
    qty_formula: Optional[str] = None
    is_required: bool = True
    sort_order: int = 0


class XactAssemblyItemResponse(XactAssemblyItemBase):
    id: UUID
    assembly_id: UUID

    model_config = {"from_attributes": True}


class XactAssemblyCreate(BaseModel):
    name: str
    damage_type: Optional[str] = None
    room_type: Optional[str] = None
    trigger_keywords: Optional[List[str]] = None
    items: Optional[List[XactAssemblyItemBase]] = None


class XactAssemblyResponse(BaseModel):
    id: UUID
    name: str
    damage_type: Optional[str] = None
    room_type: Optional[str] = None
    trigger_keywords: Optional[List[str]] = None
    is_active: bool
    items: Optional[List[XactAssemblyItemResponse]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ─── Room ─────────────────────────────────────────────────────────────────────


class RoomDimensions(BaseModel):
    LF: Optional[float] = None
    SF: Optional[float] = None
    height: Optional[float] = None


class ConditionFlags(BaseModel):
    paint: bool = True
    stain: bool = False
    after_hours: bool = False
    occupied: bool = False


class XactRoomCreate(BaseModel):
    project_id: Optional[UUID] = None
    name: str
    room_type: Optional[str] = None
    dimensions: Optional[Dict[str, Any]] = None
    damage_type: Optional[str] = None
    condition_flags: Optional[Dict[str, Any]] = None


class XactRoomUpdate(BaseModel):
    name: Optional[str] = None
    room_type: Optional[str] = None
    dimensions: Optional[Dict[str, Any]] = None
    damage_type: Optional[str] = None
    condition_flags: Optional[Dict[str, Any]] = None
    selected_assemblies: Optional[List[Dict[str, Any]]] = None
    final_line_items: Optional[List[Dict[str, Any]]] = None
    status: Optional[str] = None


class XactRoomResponse(BaseModel):
    id: UUID
    project_id: Optional[UUID] = None
    user_id: Optional[UUID] = None
    name: str
    room_type: Optional[str] = None
    dimensions: Optional[Dict[str, Any]] = None
    damage_type: Optional[str] = None
    condition_flags: Optional[Dict[str, Any]] = None
    selected_assemblies: Optional[List[Dict[str, Any]]] = None
    final_line_items: Optional[List[Dict[str, Any]]] = None
    status: str = "draft"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ─── AI Analysis ──────────────────────────────────────────────────────────────


class AnalyzeRequest(BaseModel):
    """Photo upload triggers AI analysis pipeline."""
    photos: Optional[List[str]] = None  # Base64 encoded images or file paths
    manual_keywords: Optional[List[str]] = None  # Manual keyword entry alternative


class RecommendedItem(BaseModel):
    item_code: str
    description: Optional[str] = None
    qty: float
    unit: Optional[str] = None
    unit_price: float = 0.0
    reason: Optional[str] = None


class AssemblyRecommendation(BaseModel):
    assembly_name: str
    items: List[RecommendedItem]
    source: str = "ai"  # ai / feedback / assembly_rule
    confidence: Optional[float] = None


class AnalyzeResponse(BaseModel):
    room_id: UUID
    keywords: List[str]
    recommendations: List[AssemblyRecommendation]
    feedback_applied: bool = False
    feedback_message: Optional[str] = None


# ─── Correction Feedback ──────────────────────────────────────────────────────


class CorrectionCreate(BaseModel):
    ai_suggested: List[Dict[str, Any]]
    user_corrected: List[Dict[str, Any]]
    situation_summary: Optional[str] = None


class CorrectionResponse(BaseModel):
    id: UUID
    room_id: Optional[UUID] = None
    situation_summary: Optional[str] = None
    damage_type: Optional[str] = None
    room_type: Optional[str] = None
    ai_suggested: Optional[List[Dict[str, Any]]] = None
    user_corrected: Optional[List[Dict[str, Any]]] = None
    correction_type: Optional[List[str]] = None
    confidence_score: int = 1
    is_applied_to_rule: bool = False
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ─── Item Descriptions ────────────────────────────────────────────────────────


class DescriptionCreate(BaseModel):
    item_code: str
    description_type: str  # waste / building_code / secondary_damage / scope_of_work / industry_standard
    title: str
    body: str
    trigger_condition: Optional[Dict[str, Any]] = None
    variables: Optional[Dict[str, Any]] = None
    source_reference: Optional[str] = None


class DescriptionUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    trigger_condition: Optional[Dict[str, Any]] = None
    variables: Optional[Dict[str, Any]] = None
    source_reference: Optional[str] = None
    approved: Optional[bool] = None


class DescriptionResponse(BaseModel):
    id: UUID
    item_code: str
    description_type: str
    trigger_condition: Optional[Dict[str, Any]] = None
    title: str
    body: str
    variables: Optional[Dict[str, Any]] = None
    source_reference: Optional[str] = None
    is_ai_generated: bool = False
    approved: bool = False
    usage_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DescriptionRenderRequest(BaseModel):
    """Render a description with variable substitution."""
    description_id: UUID
    variables: Dict[str, Any]  # e.g. {"LF": 18, "room_name": "Living Room"}


# ─── Embedding Sync ──────────────────────────────────────────────────────────


class EmbeddingSyncRequest(BaseModel):
    """Admin: batch generate/update embeddings."""
    category: Optional[str] = None  # Limit to specific category, or all if null
    force_regenerate: bool = False


class EmbeddingSyncResponse(BaseModel):
    total_items: int
    processed: int
    skipped: int
    errors: int
    message: str


# ─── Confirmed Line Items (Room export) ──────────────────────────────────────


class ConfirmedLineItem(BaseModel):
    item_code: str
    description: Optional[str] = None
    qty: float
    unit: Optional[str] = None
    unit_price: float = 0.0
    total: float = 0.0
    reason: Optional[str] = None
    descriptions: Optional[List[Dict[str, Any]]] = None  # Attached justifications
