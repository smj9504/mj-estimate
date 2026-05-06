"""
Client, Claim, and ClaimNegotiation Pydantic schemas
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator


# ============================================================
# Owner schema (embedded in Client)
# ============================================================

class OwnerInfo(BaseModel):
    """Individual owner within a client"""
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    is_primary: bool = False


# ============================================================
# Negotiation Section (PDF extraction result)
# ============================================================

class NegotiationSectionData(BaseModel):
    """Single summary section from insurance estimate PDF"""
    section_name: str
    line_item_total: Optional[float] = 0
    material_sales_tax: Optional[float] = 0
    subtotal: Optional[float] = 0
    overhead_amount: Optional[float] = 0
    profit_amount: Optional[float] = 0
    rcv: Optional[float] = 0
    depreciation: Optional[float] = 0
    deductible: Optional[float] = 0
    net_acv: Optional[float] = 0
    recoverable_depreciation: Optional[float] = 0
    non_recoverable_depreciation: Optional[float] = 0
    total_if_incurred: Optional[float] = 0


class PdfExtractionResponse(BaseModel):
    """Response from PDF extraction endpoint"""
    sections: List[NegotiationSectionData]
    totals: Dict[str, Any]  # { acv_amount, rcv_amount, depreciation_amount, deductible }
    validation: Dict[str, Any]  # { is_valid, warnings: [...] }
    file_id: str
    file_name: str


# ============================================================
# ClaimNegotiation schemas
# ============================================================

class ClaimNegotiationBase(BaseModel):
    revision_number: int = 1
    revision_type: str = Field("initial", description="initial | supplement | re_inspection | appraisal | final")
    acv_amount: Optional[float] = 0
    rcv_amount: Optional[float] = 0
    depreciation_amount: Optional[float] = 0
    deductible: Optional[float] = 0
    date_received: Optional[datetime] = None
    received_from: Optional[str] = None
    notes: Optional[str] = None
    document_url: Optional[str] = None
    document_name: Optional[str] = None

    @validator('revision_type')
    def validate_revision_type(cls, v):
        allowed = ['initial', 'supplement', 're_inspection', 'appraisal', 'final']
        if v not in allowed:
            raise ValueError(f"revision_type must be one of {allowed}")
        return v


class ClaimNegotiationCreate(ClaimNegotiationBase):
    claim_id: UUID
    sections_data: Optional[List[NegotiationSectionData]] = None
    file_id: Optional[str] = None


class ClaimNegotiationUpdate(BaseModel):
    revision_type: Optional[str] = None
    acv_amount: Optional[float] = None
    rcv_amount: Optional[float] = None
    depreciation_amount: Optional[float] = None
    deductible: Optional[float] = None
    date_received: Optional[datetime] = None
    received_from: Optional[str] = None
    notes: Optional[str] = None
    document_url: Optional[str] = None
    document_name: Optional[str] = None
    sections_data: Optional[List[NegotiationSectionData]] = None


class ClaimNegotiationResponse(ClaimNegotiationBase):
    id: UUID
    claim_id: UUID
    sections_data: Optional[List[Dict[str, Any]]] = None
    extraction_status: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# Claim schemas
# ============================================================

class ClaimBase(BaseModel):
    claim_number: str
    company_id: Optional[UUID] = None
    insurance_company: Optional[str] = None
    insurance_policy_number: Optional[str] = None
    insurance_deductible: Optional[float] = None
    adjuster_name: Optional[str] = None
    adjuster_phone: Optional[str] = None
    adjuster_email: Optional[str] = None
    date_of_loss: Optional[datetime] = None
    loss_description: Optional[str] = None
    status: Optional[str] = "open"
    notes: Optional[str] = None

    @validator('status')
    def validate_status(cls, v):
        allowed = ['open', 'negotiating', 'settled', 'closed', 'denied']
        if v and v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v


class ClaimCreate(ClaimBase):
    client_id: UUID
    # Optionally create initial negotiation inline
    initial_acv: Optional[float] = None
    initial_rcv: Optional[float] = None


class ClaimUpdate(BaseModel):
    claim_number: Optional[str] = None
    company_id: Optional[UUID] = None
    insurance_company: Optional[str] = None
    insurance_policy_number: Optional[str] = None
    insurance_deductible: Optional[float] = None
    adjuster_name: Optional[str] = None
    adjuster_phone: Optional[str] = None
    adjuster_email: Optional[str] = None
    date_of_loss: Optional[datetime] = None
    loss_description: Optional[str] = None
    our_estimate_amount: Optional[float] = None
    final_invoice_amount: Optional[float] = None
    total_insurance_paid: Optional[float] = None
    payment_status: Optional[str] = None
    insurance_estimate_received: Optional[bool] = None
    insurance_estimate_received_date: Optional[datetime] = None
    insurance_estimate_file_id: Optional[str] = None
    insurance_estimate_file_name: Optional[str] = None
    has_public_adjuster: Optional[bool] = None
    pa_fee_percentage: Optional[float] = None
    pa_name: Optional[str] = None
    pa_company: Optional[str] = None
    pa_email: Optional[str] = None
    pa_phone: Optional[str] = None
    needs_supplement: Optional[bool] = None
    supplement_status: Optional[str] = None
    supplement_notes: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class ClaimSummaryResponse(BaseModel):
    """Lightweight claim for list views"""
    id: UUID
    client_id: UUID
    claim_number: str
    insurance_company: Optional[str] = None
    date_of_loss: Optional[datetime] = None
    current_acv: Optional[float] = 0
    current_rcv: Optional[float] = 0
    status: Optional[str] = "open"
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ClaimPaymentBase(BaseModel):
    payment_type: str = Field("insurance", description="insurance | depreciation_recovery | supplement | deductible | other")
    amount: float
    check_number: Optional[str] = None
    check_date: Optional[datetime] = None
    received_date: Optional[datetime] = None
    paid_by: Optional[str] = None
    description: Optional[str] = None
    status: str = "received"
    notes: Optional[str] = None


class ClaimPaymentCreate(ClaimPaymentBase):
    claim_id: UUID


class ClaimPaymentUpdate(BaseModel):
    payment_type: Optional[str] = None
    amount: Optional[float] = None
    check_number: Optional[str] = None
    check_date: Optional[datetime] = None
    received_date: Optional[datetime] = None
    paid_by: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class ClaimPaymentResponse(ClaimPaymentBase):
    id: UUID
    claim_id: UUID
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PaymentSummary(BaseModel):
    """Payment summary for a claim"""
    total_invoice_amount: float = 0
    total_insurance_paid: float = 0
    payment_difference: float = 0
    deductible: float = 0
    net_expected: float = 0
    payment_status: str = "unpaid"
    insurance_estimate_received: bool = False
    needs_supplement: bool = False
    payments: List[ClaimPaymentResponse] = []


class ClaimDetailResponse(ClaimBase):
    """Full claim detail with negotiations and linked documents"""
    id: UUID
    client_id: UUID
    current_acv: Optional[float] = 0
    current_rcv: Optional[float] = 0
    current_depreciation: Optional[float] = 0
    our_estimate_amount: Optional[float] = 0
    final_invoice_amount: Optional[float] = 0
    total_insurance_paid: Optional[float] = 0
    payment_status: Optional[str] = "unpaid"
    insurance_estimate_received: bool = False
    insurance_estimate_received_date: Optional[datetime] = None
    insurance_estimate_file_id: Optional[str] = None
    insurance_estimate_file_name: Optional[str] = None
    has_public_adjuster: bool = False
    pa_fee_percentage: Optional[float] = 0
    pa_name: Optional[str] = None
    pa_company: Optional[str] = None
    pa_email: Optional[str] = None
    pa_phone: Optional[str] = None
    needs_supplement: bool = False
    supplement_status: Optional[str] = None
    supplement_notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # Nested
    negotiations: List[ClaimNegotiationResponse] = []
    payments: List[ClaimPaymentResponse] = []
    expenses: List['ClaimExpenseResponse'] = []

    # Linked document counts (populated by service)
    invoice_count: int = 0
    estimate_count: int = 0
    wm_job_count: int = 0
    work_order_count: int = 0
    cabinet_estimate_count: int = 0
    plumber_report_id: Optional[str] = None

    class Config:
        from_attributes = True


# ============================================================
# ============================================================
# ClaimExpense schemas
# ============================================================

class ClaimExpenseBase(BaseModel):
    category: str = Field(..., description="material | labor | subcontractor | equipment | permit | overhead | other")
    description: str
    amount: float
    quantity: Optional[float] = 1
    unit_cost: Optional[float] = None
    vendor_name: Optional[str] = None
    expense_date: Optional[datetime] = None
    notes: Optional[str] = None


class ClaimExpenseCreate(ClaimExpenseBase):
    claim_id: UUID
    receipt_file_id: Optional[str] = None
    receipt_file_name: Optional[str] = None


class ClaimExpenseUpdate(BaseModel):
    category: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    quantity: Optional[float] = None
    unit_cost: Optional[float] = None
    vendor_name: Optional[str] = None
    expense_date: Optional[datetime] = None
    receipt_file_id: Optional[str] = None
    receipt_file_name: Optional[str] = None
    notes: Optional[str] = None


class ClaimExpenseResponse(ClaimExpenseBase):
    id: UUID
    claim_id: UUID
    receipt_file_id: Optional[str] = None
    receipt_file_name: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProfitabilitySummary(BaseModel):
    """Full profitability breakdown for a claim"""
    # Revenue
    total_insurance_paid: float = 0
    # Costs
    pa_fee_percentage: float = 0
    pa_fee_amount: float = 0
    total_material: float = 0
    total_labor: float = 0
    total_subcontractor: float = 0
    total_equipment: float = 0
    total_other_expenses: float = 0
    total_expenses: float = 0
    # Profit
    gross_profit: float = 0
    gross_margin_pct: float = 0
    net_profit: float = 0
    net_margin_pct: float = 0
    # Detail
    expenses: List[ClaimExpenseResponse] = []


# ============================================================
# Client schemas
# ============================================================

class ClientBase(BaseModel):
    display_name: str
    owners: List[OwnerInfo] = Field(default_factory=list)
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    insurance_company: Optional[str] = None
    insurance_policy_number: Optional[str] = None
    company_id: Optional[UUID] = None
    notes: Optional[str] = None
    is_active: bool = True


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    display_name: Optional[str] = None
    owners: Optional[List[OwnerInfo]] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    insurance_company: Optional[str] = None
    insurance_policy_number: Optional[str] = None
    company_id: Optional[UUID] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class ClientListResponse(BaseModel):
    """Lightweight client for list views"""
    id: UUID
    display_name: str
    owners: Optional[List[OwnerInfo]] = []
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    insurance_company: Optional[str] = None
    is_active: bool = True
    claim_count: int = 0
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ClientDetailResponse(ClientBase):
    """Full client detail with claims and all linked documents"""
    id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # Nested claims with their details
    claims: List[ClaimDetailResponse] = []

    # Standalone documents (no claim)
    standalone_invoice_count: int = 0
    standalone_estimate_count: int = 0
    standalone_wm_job_count: int = 0
    standalone_work_order_count: int = 0

    class Config:
        from_attributes = True
