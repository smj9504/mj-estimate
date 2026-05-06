"""
Rebuild domain Pydantic schemas.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================
# RebuildContractor schemas
# ============================================================

class RebuildContractorBase(BaseModel):
    company_name: str
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    specialty: Optional[str] = None
    license_number: Optional[str] = None
    insurance_info: Optional[str] = None
    notes: Optional[str] = None


class RebuildContractorCreate(RebuildContractorBase):
    doc_config: Optional[Dict[str, Any]] = None


class RebuildContractorUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    specialty: Optional[str] = None
    license_number: Optional[str] = None
    insurance_info: Optional[str] = None
    doc_config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class RebuildContractorResponse(RebuildContractorBase):
    id: UUID
    doc_config: Optional[Dict[str, Any]] = None
    is_active: bool = True
    project_count: int = 0
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# RebuildProject schemas
# ============================================================

class RebuildProjectBase(BaseModel):
    title: str
    description: Optional[str] = None
    scope_of_work: Optional[str] = None
    property_address: Optional[str] = None
    priority: str = "normal"


class RebuildProjectCreate(RebuildProjectBase):
    claim_id: UUID
    contractor_id: Optional[UUID] = None
    start_date: Optional[datetime] = None
    estimated_completion: Optional[datetime] = None
    insurance_estimate_amount: Optional[float] = 0
    contract_amount: Optional[float] = 0


class RebuildProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    scope_of_work: Optional[str] = None
    property_address: Optional[str] = None
    contractor_id: Optional[UUID] = None
    status: Optional[str] = None
    start_date: Optional[datetime] = None
    estimated_completion: Optional[datetime] = None
    actual_completion: Optional[datetime] = None
    insurance_estimate_amount: Optional[float] = None
    contract_amount: Optional[float] = None
    final_invoice_amount: Optional[float] = None
    coc_sent: Optional[bool] = None
    invoice_sent: Optional[bool] = None
    photos_sent: Optional[bool] = None
    docs_sent_to: Optional[str] = None
    docs_sent_date: Optional[datetime] = None
    docs_acknowledged: Optional[bool] = None
    docs_acknowledged_date: Optional[datetime] = None
    priority: Optional[str] = None
    notes: Optional[str] = None


class RebuildProjectResponse(RebuildProjectBase):
    id: UUID
    claim_id: UUID
    contractor_id: Optional[UUID] = None
    status: str
    start_date: Optional[datetime] = None
    estimated_completion: Optional[datetime] = None
    actual_completion: Optional[datetime] = None
    insurance_estimate_amount: float = 0
    contract_amount: float = 0
    final_invoice_amount: float = 0
    coc_sent: bool = False
    invoice_sent: bool = False
    photos_sent: bool = False
    docs_sent_to: Optional[str] = None
    docs_sent_date: Optional[datetime] = None
    docs_acknowledged: bool = False
    docs_acknowledged_date: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # Enriched
    claim_number: Optional[str] = None
    insurance_company: Optional[str] = None
    contractor_name: Optional[str] = None
    completion_doc_count: int = 0

    # Nested
    contractor: Optional[RebuildContractorResponse] = None
    completion_docs: List['RebuildCompletionDocResponse'] = []

    class Config:
        from_attributes = True


# ============================================================
# RebuildCompletionDoc schemas
# ============================================================

class RebuildCompletionDocCreate(BaseModel):
    project_id: UUID
    doc_type: str = Field(..., description="coc | invoice | completion_photo | warranty | permit | lien_waiver | other")
    title: str
    description: Optional[str] = None
    file_id: Optional[str] = None
    file_name: Optional[str] = None
    file_url: Optional[str] = None
    mime_type: Optional[str] = "application/pdf"


class RebuildCompletionDocUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    file_id: Optional[str] = None
    file_name: Optional[str] = None
    file_url: Optional[str] = None
    status: Optional[str] = None


class RebuildCompletionDocResponse(BaseModel):
    id: UUID
    project_id: UUID
    doc_type: str
    title: str
    description: Optional[str] = None
    file_id: Optional[str] = None
    file_name: Optional[str] = None
    file_url: Optional[str] = None
    mime_type: Optional[str] = None
    status: str = "draft"
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# Dashboard
# ============================================================

class RebuildDashboardStats(BaseModel):
    total_projects: int = 0
    pending: int = 0
    assigned: int = 0
    in_progress: int = 0
    completed: int = 0
    docs_sent: int = 0
    total_contract_amount: float = 0
    total_contractors: int = 0
