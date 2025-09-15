"""
Company domain schemas
"""

from typing import Optional, Dict, Any
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime

from app.common.schemas.base import BaseResponseSchema, PaginatedResponse
from app.common.schemas.shared import Address


class CompanyBase(BaseModel):
    """Base company schema"""
    name: str = Field(..., min_length=1, max_length=255)
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    website: Optional[str] = None
    company_code: Optional[str] = Field(None, max_length=10)
    license_number: Optional[str] = Field(None, max_length=100)
    insurance_info: Optional[str] = None
    payment_method: Optional[str] = Field(None, max_length=50)  # Legacy field
    payment_frequency: Optional[str] = Field(None, max_length=50)  # Legacy field
    payment_method_id: Optional[str] = None  # Reference to payment_methods table
    payment_frequency_id: Optional[str] = None  # Reference to payment_frequencies table
    logo: Optional[str] = None  # Base64 encoded logo
    is_active: bool = True
    is_default: bool = False


class CompanyCreate(CompanyBase):
    """Schema for creating a company"""
    pass


class CompanyUpdate(BaseModel):
    """Schema for updating a company"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    website: Optional[str] = None
    company_code: Optional[str] = Field(None, max_length=10)
    license_number: Optional[str] = Field(None, max_length=100)
    insurance_info: Optional[str] = None
    payment_method: Optional[str] = Field(None, max_length=50)  # Legacy field
    payment_frequency: Optional[str] = Field(None, max_length=50)  # Legacy field
    payment_method_id: Optional[str] = None
    payment_frequency_id: Optional[str] = None
    logo: Optional[str] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None


class CompanyResponse(CompanyBase, BaseResponseSchema):
    """Company response schema with ID and timestamps"""
    pass


class PaymentMethodInfo(BaseModel):
    """Payment method information for company response"""
    id: str
    code: str
    name: str
    description: Optional[str] = None
    requires_account_info: bool
    icon: Optional[str] = None


class PaymentFrequencyInfo(BaseModel):
    """Payment frequency information for company response"""
    id: str
    code: str
    name: str
    description: Optional[str] = None
    days_interval: Optional[int] = None


class CompanyDetailResponse(CompanyResponse):
    """Detailed company response with payment configuration details"""
    payment_method_details: Optional[PaymentMethodInfo] = None
    payment_frequency_details: Optional[PaymentFrequencyInfo] = None


class CompanyFilter(BaseModel):
    """Filter parameters for companies"""
    search: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None


# Paginated response for companies
CompanyPaginatedResponse = PaginatedResponse[CompanyResponse]