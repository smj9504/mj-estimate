"""
Supplement domain Pydantic schemas.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator


# ============================================================
# SupplementRequest schemas
# ============================================================

class SupplementRequestBase(BaseModel):
    request_type: str = "supplement"
    title: str
    reason: Optional[str] = None
    description: Optional[str] = None
    original_amount: float = 0
    supplement_amount: float = 0
    our_estimate_amount: float = 0
    priority: str = "normal"
    submitted_to: Optional[str] = None
    submitted_to_email: Optional[str] = None
    required_estimates: Optional[Dict[str, bool]] = None

    @validator('request_type')
    def validate_request_type(cls, v):
        allowed = ['supplement', 'estimate_request']
        if v not in allowed:
            raise ValueError(
                f"request_type must be one of {allowed}"
            )
        return v


class SupplementRequestCreate(SupplementRequestBase):
    claim_id: UUID
    negotiation_id: Optional[UUID] = None


class SupplementRequestUpdate(BaseModel):
    title: Optional[str] = None
    reason: Optional[str] = None
    description: Optional[str] = None
    original_amount: Optional[float] = None
    supplement_amount: Optional[float] = None
    our_estimate_amount: Optional[float] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    submitted_to: Optional[str] = None
    submitted_to_email: Optional[str] = None
    submitted_date: Optional[datetime] = None
    response_date: Optional[datetime] = None
    response_notes: Optional[str] = None
    document_file_id: Optional[str] = None
    document_file_name: Optional[str] = None
    required_estimates: Optional[Dict[str, bool]] = None

    @validator('status')
    def validate_status(cls, v):
        if v is not None:
            allowed = ['identified', 'in_progress', 'submitted', 'under_review', 'approved', 'denied', 'withdrawn']
            if v not in allowed:
                raise ValueError(f"status must be one of {allowed}")
        return v


class SupplementRequestResponse(SupplementRequestBase):
    id: UUID
    claim_id: UUID
    negotiation_id: Optional[UUID] = None
    request_type: str = "supplement"
    difference: float = 0
    status: str
    submitted_date: Optional[datetime] = None
    response_date: Optional[datetime] = None
    response_notes: Optional[str] = None
    document_file_id: Optional[str] = None
    document_file_name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # Enriched fields
    claim_number: Optional[str] = None
    insurance_company: Optional[str] = None
    property_address: Optional[str] = None
    wm_company_id: Optional[str] = None
    wm_company_name: Optional[str] = None
    rebuild_company_id: Optional[str] = None
    rebuild_company_name: Optional[str] = None
    bid_item_count: int = 0
    followup_count: int = 0

    # Nested
    bid_items: List['BidItemEstimateResponse'] = []

    class Config:
        from_attributes = True


# ============================================================
# BidItemEstimate schemas
# ============================================================

class BidItemEstimateBase(BaseModel):
    estimate_type: str = Field(..., description="bathroom | cabinet | packing | roofing | kitchen | flooring | other")
    title: Optional[str] = ""
    description: Optional[str] = None


class BidItemEstimateCreate(BidItemEstimateBase):
    supplement_id: UUID
    bathroom_estimate_id: Optional[UUID] = None
    cabinet_estimate_id: Optional[UUID] = None
    pack_calculation_id: Optional[UUID] = None
    roofing_estimate_id: Optional[UUID] = None
    custom_amount: Optional[float] = None
    custom_document_file_id: Optional[str] = None
    custom_document_file_name: Optional[str] = None
    included_in_xactimate: bool = False


class BidItemEstimateUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    custom_amount: Optional[float] = None
    custom_document_file_id: Optional[str] = None
    custom_document_file_name: Optional[str] = None
    included_in_xactimate: Optional[bool] = None
    sent_to_pa_date: Optional[datetime] = None
    pa_response_date: Optional[datetime] = None
    pa_response_notes: Optional[str] = None


class BidItemEstimateResponse(BidItemEstimateBase):
    id: UUID
    supplement_id: UUID
    bathroom_estimate_id: Optional[UUID] = None
    cabinet_estimate_id: Optional[UUID] = None
    pack_calculation_id: Optional[UUID] = None
    roofing_estimate_id: Optional[UUID] = None
    custom_amount: Optional[float] = None
    custom_document_file_id: Optional[str] = None
    custom_document_file_name: Optional[str] = None
    included_in_xactimate: bool = False
    status: str
    sent_to_pa_date: Optional[datetime] = None
    pa_response_date: Optional[datetime] = None
    pa_response_notes: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# SupplementFollowUp schemas
# ============================================================

class SupplementFollowUpCreate(BaseModel):
    supplement_id: UUID
    followup_type: str = "general"
    contact_method: str = Field(..., description="email | phone | text | in_person")
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    summary: Optional[str] = None
    items_needed: Optional[List[Dict[str, Any]]] = None
    request_to_type: Optional[str] = None
    info_status: Optional[str] = None


class SupplementFollowUpUpdate(BaseModel):
    response_received: Optional[bool] = None
    response_date: Optional[datetime] = None
    response_summary: Optional[str] = None
    reply_body_html: Optional[str] = None
    reply_attachment_ids: Optional[List[str]] = None
    items_needed: Optional[List[Dict[str, Any]]] = None
    info_status: Optional[str] = None
    follow_up_count: Optional[int] = None
    last_follow_up_date: Optional[datetime] = None


class SupplementFollowUpResponse(BaseModel):
    id: UUID
    supplement_id: UUID
    followup_type: str = "general"
    contact_method: str
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    summary: Optional[str] = None
    items_needed: Optional[List[Dict[str, Any]]] = None
    request_to_type: Optional[str] = None
    info_status: Optional[str] = None
    response_received: bool = False
    response_date: Optional[datetime] = None
    response_summary: Optional[str] = None
    reply_body_html: Optional[str] = None
    reply_attachment_ids: Optional[List[str]] = None
    sent_email_id: Optional[UUID] = None
    follow_up_count: int = 0
    last_follow_up_date: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# Dashboard
# ============================================================

class SupplementDashboardStats(BaseModel):
    total: int = 0
    identified: int = 0
    in_progress: int = 0
    submitted: int = 0
    under_review: int = 0
    approved: int = 0
    denied: int = 0
    total_supplement_amount: float = 0
    total_difference: float = 0


# Resolve forward references
SupplementRequestResponse.model_rebuild()
