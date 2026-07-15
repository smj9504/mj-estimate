"""Contractor Portal schemas."""

from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional

from pydantic import BaseModel


class TokenValidateResponse(BaseModel):
    valid: bool
    contact_name: Optional[str] = None
    contact_id: Optional[str] = None


class ClaimListItem(BaseModel):
    claim_id: str
    claim_number: Optional[str] = None
    client_name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    company_name: Optional[str] = None
    role: Optional[str] = None
    date_of_loss: Optional[str] = None
    expected_amount: Optional[float] = None  # current_rcv
    received_total: Optional[float] = None
    remaining: Optional[float] = None


class ExpectedAmounts(BaseModel):
    rcv: Optional[float] = None
    acv: Optional[float] = None
    depreciation: Optional[float] = None
    deductible: Optional[float] = None


class ContractorPaymentCreate(BaseModel):
    payment_type: str = "insurance"
    payment_category: str  # water_mitigation, pack_in_out, rebuild_interior, roofing, siding, other
    amount: float  # Net amount (after PA fee deduction)
    check_number: Optional[str] = None
    check_date: Optional[datetime] = None
    received_date: Optional[datetime] = None
    pa_fee_deducted: bool = True
    pa_fee_amount: Optional[float] = None
    gross_amount: Optional[float] = None
    memo: Optional[str] = None
    check_photo_file_id: Optional[str] = None
    company_id: Optional[str] = None


class ContractorPaymentResponse(BaseModel):
    id: str
    payment_type: Optional[str] = None
    payment_category: Optional[str] = None
    amount: Optional[float] = None
    check_number: Optional[str] = None
    check_date: Optional[str] = None
    received_date: Optional[str] = None
    pa_fee_deducted: Optional[bool] = None
    pa_fee_amount: Optional[float] = None
    gross_amount: Optional[float] = None
    check_photo_file_id: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None


class PaymentSummaryResponse(BaseModel):
    payments: List[ContractorPaymentResponse]
    total_by_category: Dict[str, float]
    grand_total: float
    expected: ExpectedAmounts


class TokenCreateRequest(BaseModel):
    company_contact_id: str


class TokenResponse(BaseModel):
    id: str
    token: str
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    company_name: Optional[str] = None
    is_active: bool = True
    last_accessed_at: Optional[str] = None
    portal_url: Optional[str] = None
    created_at: Optional[str] = None
