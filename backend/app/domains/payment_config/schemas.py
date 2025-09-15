"""
Payment configuration schemas
"""

from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# Payment Method Schemas
class PaymentMethodBase(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    requires_account_info: bool = False
    is_active: bool = True
    is_default: bool = False


class PaymentMethodCreate(PaymentMethodBase):
    pass


class PaymentMethodUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    requires_account_info: Optional[bool] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None


class PaymentMethodResponse(PaymentMethodBase):
    id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Payment Frequency Schemas
class PaymentFrequencyBase(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    days_interval: Optional[int] = None
    is_active: bool = True
    is_default: bool = False


class PaymentFrequencyCreate(PaymentFrequencyBase):
    pass


class PaymentFrequencyUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    days_interval: Optional[int] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None


class PaymentFrequencyResponse(PaymentFrequencyBase):
    id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True