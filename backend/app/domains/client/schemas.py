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
    estimate_category: Optional[str] = Field(
        None,
        description="reconstruction | water_mitigation | combined",
    )
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

    @validator('estimate_category')
    def validate_estimate_category(cls, v):
        allowed = ['reconstruction', 'water_mitigation', 'combined']
        if v and v not in allowed:
            raise ValueError(f"estimate_category must be one of {allowed}")
        return v


class ClaimNegotiationCreate(ClaimNegotiationBase):
    claim_id: UUID
    sections_data: Optional[List[NegotiationSectionData]] = None
    file_id: Optional[str] = None


class ClaimNegotiationUpdate(BaseModel):
    revision_type: Optional[str] = None
    estimate_category: Optional[str] = None
    acv_amount: Optional[float] = None
    rcv_amount: Optional[float] = None
    depreciation_amount: Optional[float] = None
    deductible: Optional[float] = None
    date_received: Optional[datetime] = None
    received_from: Optional[str] = None
    notes: Optional[str] = None
    document_url: Optional[str] = None
    document_name: Optional[str] = None
    file_id: Optional[str] = None
    sections_data: Optional[List[NegotiationSectionData]] = None

    @validator('revision_type')
    def validate_revision_type(cls, v):
        allowed = ['initial', 'supplement', 're_inspection', 'appraisal', 'final']
        if v and v not in allowed:
            raise ValueError(f"revision_type must be one of {allowed}")
        return v

    @validator('estimate_category')
    def validate_estimate_category(cls, v):
        allowed = ['reconstruction', 'water_mitigation', 'combined']
        if v and v not in allowed:
            raise ValueError(f"estimate_category must be one of {allowed}")
        return v


class ClaimNegotiationResponse(ClaimNegotiationBase):
    id: UUID
    claim_id: UUID
    file_download_id: Optional[str] = None
    sections_data: Optional[List[Dict[str, Any]]] = None
    extraction_status: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# Claim schemas
# ============================================================

CLAIM_TYPES = ('insurance', 'cash')


def _check_claim_type(v):
    if v and v not in CLAIM_TYPES:
        raise ValueError(f"claim_type must be one of {list(CLAIM_TYPES)}")
    return v


def _check_stage_override(v):
    """'' or None hands the stage back to the claim's records"""
    from app.domains.client.claim_stage import OVERRIDE_STAGES
    if not v:
        return None
    if v not in OVERRIDE_STAGES:
        raise ValueError(f"stage_override must be one of {list(OVERRIDE_STAGES)}")
    return v


class ClaimBase(BaseModel):
    claim_number: Optional[str] = None
    # insurance = a claim; cash = a cash job (no insurance details)
    claim_type: Optional[str] = "insurance"
    company_id: Optional[UUID] = None
    insurance_company: Optional[str] = None
    insurance_policy_number: Optional[str] = None
    insurance_deductible: Optional[float] = None
    deductible_discount: Optional[float] = None
    adjuster_name: Optional[str] = None
    adjuster_phone: Optional[str] = None
    adjuster_email: Optional[str] = None
    date_of_loss: Optional[datetime] = None
    loss_description: Optional[str] = None
    status: Optional[str] = "open"
    appraisal_date: Optional[datetime] = None
    estimate_origin: Optional[str] = None
    contractor_estimate_stage: Optional[str] = None
    # Who writes the rebuild estimate on the contractor-prepared path
    rebuild_estimate_company_id: Optional[UUID] = None
    # Lifecycle stage set by hand; None = worked out from the claim's records
    stage_override: Optional[str] = None
    construction_started_at: Optional[datetime] = None
    construction_completed_at: Optional[datetime] = None
    notes: Optional[str] = None

    @validator('status')
    def validate_status(cls, v):
        allowed = ['open', 'negotiating', 'appraisal', 'settled', 'closed', 'denied']
        if v and v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v

    _claim_type = validator('claim_type', allow_reuse=True)(_check_claim_type)
    _stage_override = validator('stage_override', allow_reuse=True)(_check_stage_override)

    @validator('estimate_origin')
    def validate_estimate_origin(cls, v):
        allowed = ['carrier_provided', 'contractor_prepared']
        if v and v not in allowed:
            raise ValueError(f"estimate_origin must be one of {allowed}")
        return v

    @validator('contractor_estimate_stage')
    def validate_contractor_estimate_stage(cls, v):
        allowed = [
            'requested', 'estimate_sent',
            'awaiting_approval', 'approved_initial_received',
        ]
        if v and v not in allowed:
            raise ValueError(f"contractor_estimate_stage must be one of {allowed}")
        return v


class ClaimCreate(ClaimBase):
    client_id: UUID
    # Optionally create initial negotiation inline
    initial_acv: Optional[float] = None
    initial_rcv: Optional[float] = None
    # The companies working it; their people see it
    company_ids: Optional[List[UUID]] = None


class ClaimUpdate(BaseModel):
    claim_number: Optional[str] = None
    claim_type: Optional[str] = None
    # Replaces the claim's companies when given
    company_ids: Optional[List[UUID]] = None
    company_id: Optional[UUID] = None
    insurance_company: Optional[str] = None
    insurance_policy_number: Optional[str] = None
    insurance_deductible: Optional[float] = None
    deductible_discount: Optional[float] = None
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
    # Link to a CompanyContact. Settable directly so a claim can have a PA
    # without going through the WM sheet mapping (rebuild-only claims, or a
    # PA that changed hands). '' clears it.
    pa_contact_id: Optional[str] = None
    wm_cost_status: Optional[str] = None
    wm_estimate_amount: Optional[float] = None
    wm_estimate_file_id: Optional[str] = None
    wm_estimate_file_name: Optional[str] = None
    needs_supplement: Optional[bool] = None
    supplement_status: Optional[str] = None
    supplement_notes: Optional[str] = None
    status: Optional[str] = None
    appraisal_date: Optional[datetime] = None
    estimate_origin: Optional[str] = None
    contractor_estimate_stage: Optional[str] = None
    # Must not be a company that did this claim's water mitigation. '' clears it.
    rebuild_estimate_company_id: Optional[str] = None
    # null or '' goes back to the stage worked out from the records
    stage_override: Optional[str] = None
    construction_started_at: Optional[datetime] = None
    construction_completed_at: Optional[datetime] = None
    notes: Optional[str] = None

    _claim_type = validator('claim_type', allow_reuse=True)(_check_claim_type)
    _stage_override = validator('stage_override', allow_reuse=True)(_check_stage_override)

    @validator('wm_cost_status')
    def validate_wm_cost_status(cls, v):
        from app.domains.client.claim_paths import WM_COST_STATUSES
        if v and v not in WM_COST_STATUSES:
            raise ValueError(f"wm_cost_status must be one of {list(WM_COST_STATUSES)}")
        return v


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
    pa_contact_id: Optional[str] = None
    wm_cost_status: Optional[str] = None
    wm_estimate_amount: Optional[float] = None
    wm_estimate_file_id: Optional[str] = None
    wm_estimate_file_name: Optional[str] = None
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
    wm_jobs: List[Dict[str, Any]] = []
    work_order_count: int = 0
    rebuild_jobs: List[Dict[str, Any]] = []
    cabinet_estimate_count: int = 0
    plumber_report_id: Optional[str] = None

    # Lifecycle stage (populated by claim_stage.claim_stages)
    stage: Optional[str] = None
    stage_detail: Optional[str] = None
    stage_source: Optional[str] = None  # auto | manual
    auto_stage: Optional[str] = None
    auto_stage_detail: Optional[str] = None
    construction: Optional[str] = None  # in_progress | done | None (not started)

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
    current_rcv: float = 0
    deductible: float = 0
    # Waived part of the deductible and what the homeowner still owes us
    deductible_discount: float = 0
    homeowner_deductible_due: float = 0
    # PA Fee: (RCV - deductible) * pa_pct%
    pa_fee_percentage: float = 0
    pa_fee_base: float = 0
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
# ClaimNote schemas
# ============================================================

class ClaimNoteCreate(BaseModel):
    content: str
    created_by_name: Optional[str] = None
    pinned: bool = False


class ClaimNoteUpdate(BaseModel):
    content: Optional[str] = None
    pinned: Optional[bool] = None


class ClaimNoteResponse(BaseModel):
    id: UUID
    claim_id: UUID
    content: str
    created_by_name: Optional[str] = None
    pinned: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# ClaimTodo schemas
# ============================================================

class ClaimTodoCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "normal"
    due_date: Optional[datetime] = None

    @validator('priority')
    def validate_priority(cls, v):
        allowed = ['low', 'normal', 'high', 'urgent']
        if v not in allowed:
            raise ValueError(f"priority must be one of {allowed}")
        return v


class ClaimTodoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[datetime] = None
    is_completed: Optional[bool] = None


class ClaimTodoResponse(BaseModel):
    id: UUID
    claim_id: Optional[UUID] = None
    client_id: Optional[UUID] = None
    title: str
    description: Optional[str] = None
    priority: str = "normal"
    due_date: Optional[datetime] = None
    status: str = "todo"
    sort_order: int = 0
    is_completed: bool = False
    completed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ClaimTodoDashboardResponse(ClaimTodoResponse):
    """Extended todo for dashboard view with client/claim context"""
    client_name: Optional[str] = None
    claim_number: Optional[str] = None


# ============================================================
# Todo board schemas
# ============================================================

TODO_STATUSES = ['todo', 'in_progress', 'done']
TODO_PRIORITIES = ['low', 'normal', 'high', 'urgent']


def _check_status(v):
    if v is not None and v not in TODO_STATUSES:
        raise ValueError(f"status must be one of {TODO_STATUSES}")
    return v


def _check_priority(v):
    if v is not None and v not in TODO_PRIORITIES:
        raise ValueError(f"priority must be one of {TODO_PRIORITIES}")
    return v


class TodoCreate(BaseModel):
    """A board todo: a client and claim are both optional"""
    title: str
    client_id: Optional[UUID] = None
    claim_id: Optional[UUID] = None
    description: Optional[str] = None
    priority: str = "normal"
    due_date: Optional[datetime] = None
    status: str = "todo"

    _status = validator('status', allow_reuse=True)(_check_status)
    _priority = validator('priority', allow_reuse=True)(_check_priority)

    @validator('title')
    def title_not_blank(cls, v):
        if not v.strip():
            raise ValueError("title is required")
        return v.strip()


class TodoUpdate(BaseModel):
    """Changing the client drops the claim unless a claim is sent with it"""
    title: Optional[str] = None
    client_id: Optional[UUID] = None
    claim_id: Optional[UUID] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = None
    is_completed: Optional[bool] = None

    _status = validator('status', allow_reuse=True)(_check_status)
    _priority = validator('priority', allow_reuse=True)(_check_priority)


class TodoReorder(BaseModel):
    """The full order of one column after a drop; every todo listed moves into it"""
    status: str
    ids: List[UUID]

    _status = validator('status', allow_reuse=True)(_check_status)


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
    source: Optional[str] = None
    claim_count: int = 0
    # The claim shown: the newest one still being worked, else the newest one
    active_claim_count: int = 0
    latest_claim_status: Optional[str] = None
    claim_stage: Optional[str] = None
    claim_stage_detail: Optional[str] = None
    claim_stage_source: Optional[str] = None
    claim_construction: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None  # client or any of its claims changed

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
