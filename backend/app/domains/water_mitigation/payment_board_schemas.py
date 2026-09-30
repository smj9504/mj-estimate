"""
WM Payment Board schemas (public manager link + admin token management)
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class PaymentRowResponse(BaseModel):
    """One job as shown on the payment board"""
    id: UUID
    property_address: str
    homeowner_name: Optional[str] = None
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

    class Config:
        from_attributes = True


class PublicBoardResponse(BaseModel):
    """Board as seen through the manager link. valid=False on a dead token."""
    valid: bool
    items: List[PaymentRowResponse] = []


class PublicReceivedUpdate(BaseModel):
    """The only write the public link is allowed to make.

    Deliberately a single field: extra keys in the request body are ignored,
    so a manager link can never reach the amounts or the check recipient.
    """
    payment_received: bool


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
