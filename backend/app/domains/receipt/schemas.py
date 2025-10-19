"""
Receipt domain Pydantic schemas
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime
from uuid import UUID


# Receipt Template Schemas

class ReceiptTemplateBase(BaseModel):
    """Base schema for receipt templates"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    template_type: str = Field("standard", description="Template type: standard, deposit, final, partial, custom")
    is_default: bool = Field(False, description="Is this the default template for this type")
    is_active: bool = Field(True, description="Is this template active")
    top_note: Optional[str] = None
    bottom_note: Optional[str] = None
    display_options: Optional[Dict[str, Any]] = Field(default_factory=dict)

    @validator('template_type')
    def validate_template_type(cls, v):
        valid_types = ['standard', 'deposit', 'final', 'partial', 'custom']
        if v not in valid_types:
            raise ValueError(f"template_type must be one of {valid_types}")
        return v


class ReceiptTemplateCreate(ReceiptTemplateBase):
    """Schema for creating a receipt template"""
    company_id: UUID


class ReceiptTemplateUpdate(BaseModel):
    """Schema for updating a receipt template"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    template_type: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    top_note: Optional[str] = None
    bottom_note: Optional[str] = None
    display_options: Optional[Dict[str, Any]] = None

    @validator('template_type')
    def validate_template_type(cls, v):
        if v is not None:
            valid_types = ['standard', 'deposit', 'final', 'partial', 'custom']
            if v not in valid_types:
                raise ValueError(f"template_type must be one of {valid_types}")
        return v


class ReceiptTemplateResponse(ReceiptTemplateBase):
    """Schema for receipt template response"""
    id: UUID
    company_id: UUID
    version: int
    created_by: Optional[UUID] = None
    updated_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Receipt Schemas

class ReceiptBase(BaseModel):
    """Base schema for receipts"""
    receipt_date: Optional[str] = Field(None, description="Receipt date (YYYY-MM-DD)")
    payment_amount: float = Field(..., gt=0, description="Payment amount for this receipt")
    payment_method: Optional[str] = Field(None, max_length=50)
    payment_reference: Optional[str] = Field(None, max_length=255)
    receipt_number: Optional[str] = Field(None, description="Pre-generated receipt number from payment")
    top_note: Optional[str] = None
    bottom_note: Optional[str] = None

    @validator('receipt_date', pre=True)
    def validate_date_format(cls, v):
        """Validate and convert date to YYYY-MM-DD format"""
        if v is None or v == '':
            return None

        if isinstance(v, str):
            try:
                if '-' in v:
                    parts = v.split('-')
                    if len(parts[0]) == 4:  # Already YYYY-MM-DD
                        return v
                    elif len(parts[0]) == 2:  # MM-DD-YYYY
                        month, day, year = parts
                        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
                elif '/' in v:  # MM/DD/YYYY
                    month, day, year = v.split('/')
                    return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
            except (ValueError, IndexError):
                raise ValueError('Invalid date format. Use YYYY-MM-DD, MM-DD-YYYY, or MM/DD/YYYY')
        return v


class ReceiptGenerateRequest(ReceiptBase):
    """Schema for generating a receipt from an invoice"""
    invoice_id: UUID
    template_id: Optional[UUID] = Field(None, description="Template to use (uses default if not specified)")


class ReceiptCreate(ReceiptBase):
    """Schema for creating a receipt (internal use)"""
    company_id: UUID
    invoice_id: UUID
    template_id: Optional[UUID] = None
    receipt_number: str
    invoice_number: str
    original_amount: float
    paid_amount_to_date: float
    balance_due: float
    status: str = "issued"


class ReceiptUpdate(BaseModel):
    """Schema for updating a receipt"""
    receipt_date: Optional[str] = None
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    top_note: Optional[str] = None
    bottom_note: Optional[str] = None
    status: Optional[str] = None

    @validator('status')
    def validate_status(cls, v):
        if v is not None:
            valid_statuses = ['draft', 'issued', 'voided']
            if v not in valid_statuses:
                raise ValueError(f"status must be one of {valid_statuses}")
        return v


class ReceiptVoidRequest(BaseModel):
    """Schema for voiding a receipt"""
    void_reason: str = Field(..., min_length=1, description="Reason for voiding the receipt")


class ReceiptResponse(ReceiptBase):
    """Schema for receipt response"""
    id: UUID
    receipt_number: str
    company_id: UUID
    invoice_id: UUID
    template_id: Optional[UUID] = None
    invoice_number: str
    original_amount: float
    paid_amount_to_date: float
    balance_due: float
    status: str
    version: int
    superseded_by: Optional[UUID] = None
    created_by: Optional[UUID] = None
    updated_by: Optional[UUID] = None
    voided_at: Optional[datetime] = None
    voided_by: Optional[UUID] = None
    void_reason: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ReceiptListItem(BaseModel):
    """Schema for receipt list item"""
    id: UUID
    receipt_number: str
    invoice_number: str
    receipt_date: str
    payment_amount: float
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ReceiptListResponse(BaseModel):
    """Schema for paginated receipt list response"""
    receipts: List[ReceiptListItem]
    total: int
    skip: int
    limit: int
