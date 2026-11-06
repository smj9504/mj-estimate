"""
WM Payment Board schemas (public manager link + admin token management)
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator

from .schemas import CHECK_RECIPIENTS, CompanyBrief


class PaymentRowResponse(BaseModel):
    """One job as shown on the payment board"""
    id: UUID
    property_address: str
    homeowner_name: Optional[str] = None
    company: Optional[CompanyBrief] = None  # WM company assigned to the job
    status: Optional[str] = None
    invoice_amount: Optional[float] = None
    approved_amount: Optional[float] = None
    approved_amount_auto: Optional[float] = None  # from the claim's insurance estimate
    final_amount: Optional[float] = None
    check_recipient: Optional[str] = None
    check_number: Optional[str] = None
    check_date: Optional[datetime] = None
    payment_received: bool = False
    payment_received_at: Optional[datetime] = None
    payment_note: Optional[str] = None
    payment_note_updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PublicBoardResponse(BaseModel):
    """Board as seen through the manager link. valid=False on a dead token."""
    valid: bool
    items: List[PaymentRowResponse] = []


class PublicReceivedUpdate(BaseModel):
    """Received toggle from the manager link.

    Each public write takes a single field: extra keys in the request body
    are ignored, so a manager link can never reach the amounts.
    """
    payment_received: bool


class PublicCheckRecipientUpdate(BaseModel):
    """Who the check is payable to, set from the manager link. None clears it."""
    check_recipient: Optional[str] = None

    @validator('check_recipient')
    def validate_check_recipient(cls, v):
        if v is not None and v not in CHECK_RECIPIENTS:
            raise ValueError(f'check_recipient must be one of: {sorted(CHECK_RECIPIENTS)}')
        return v


class PublicNoteUpdate(BaseModel):
    """Manager note for one job. Stored on the job and mirrored to its claim."""
    payment_note: Optional[str] = Field(None, max_length=4000)


class BoardTokenResponse(BaseModel):
    id: UUID
    token: str
    label: Optional[str] = None
    is_active: bool
    view_count: int
    confirm_count: int
    last_accessed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True
