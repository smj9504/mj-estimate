"""
Credit and discount Pydantic schemas
"""

from typing import Optional
from pydantic import BaseModel, EmailStr
from datetime import datetime
from uuid import UUID
from decimal import Decimal

from .models import CreditType, DiscountType, CreditStatus


class CustomerCreditBase(BaseModel):
    """Base customer credit schema"""
    credit_number: str
    company_id: UUID
    work_order_id: Optional[UUID] = None
    payment_id: Optional[UUID] = None
    
    credit_type: CreditType
    amount: Decimal
    currency: Optional[str] = "USD"
    
    customer_name: str
    customer_email: Optional[EmailStr] = None
    customer_phone: Optional[str] = None
    
    issued_date: datetime
    expiry_date: Optional[datetime] = None
    
    description: Optional[str] = None
    reason: Optional[str] = None
    terms_and_conditions: Optional[str] = None
    
    issued_by_staff_id: UUID
    approved_by_staff_id: Optional[UUID] = None
    
    is_transferable: Optional[bool] = False
    is_refundable: Optional[bool] = False
    auto_apply: Optional[bool] = False
    
    internal_notes: Optional[str] = None


class CustomerCreditCreate(CustomerCreditBase):
    """Schema for creating a customer credit"""
    pass


class CustomerCreditUpdate(BaseModel):
    """Schema for updating a customer credit"""
    work_order_id: Optional[UUID] = None
    payment_id: Optional[UUID] = None
    status: Optional[CreditStatus] = None
    expiry_date: Optional[datetime] = None
    description: Optional[str] = None
    reason: Optional[str] = None
    terms_and_conditions: Optional[str] = None
    approved_by_staff_id: Optional[UUID] = None
    is_transferable: Optional[bool] = None
    is_refundable: Optional[bool] = None
    auto_apply: Optional[bool] = None
    internal_notes: Optional[str] = None


class CustomerCredit(CustomerCreditBase):
    """Customer credit schema with all fields"""
    id: UUID
    status: CreditStatus
    original_amount: Optional[Decimal] = None
    remaining_amount: Optional[Decimal] = None
    used_amount: Optional[Decimal] = None
    used_date: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class DiscountRuleBase(BaseModel):
    """Base discount rule schema"""
    rule_name: str
    rule_code: str
    company_id: UUID
    
    discount_type: DiscountType
    discount_value: Decimal
    min_order_amount: Optional[Decimal] = None
    max_discount_amount: Optional[Decimal] = None
    
    start_date: datetime
    end_date: Optional[datetime] = None
    max_uses: Optional[str] = None
    max_uses_per_customer: Optional[str] = None
    
    applicable_services: Optional[str] = None
    applicable_customer_types: Optional[str] = None
    minimum_quantity: Optional[str] = None
    
    description: Optional[str] = None
    terms_and_conditions: Optional[str] = None
    public_description: Optional[str] = None
    
    is_automatic: Optional[bool] = False
    is_stackable: Optional[bool] = False
    is_public: Optional[bool] = True
    requires_code: Optional[bool] = False
    
    created_by_staff_id: UUID


class DiscountRuleCreate(DiscountRuleBase):
    """Schema for creating a discount rule"""
    pass


class DiscountRuleUpdate(BaseModel):
    """Schema for updating a discount rule"""
    rule_name: Optional[str] = None
    discount_value: Optional[Decimal] = None
    min_order_amount: Optional[Decimal] = None
    max_discount_amount: Optional[Decimal] = None
    
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    max_uses: Optional[str] = None
    max_uses_per_customer: Optional[str] = None
    
    applicable_services: Optional[str] = None
    applicable_customer_types: Optional[str] = None
    minimum_quantity: Optional[str] = None
    
    description: Optional[str] = None
    terms_and_conditions: Optional[str] = None
    public_description: Optional[str] = None
    
    is_active: Optional[bool] = None
    is_automatic: Optional[bool] = None
    is_stackable: Optional[bool] = None
    is_public: Optional[bool] = None
    requires_code: Optional[bool] = None


class DiscountRule(DiscountRuleBase):
    """Discount rule schema with all fields"""
    id: UUID
    total_uses: Optional[str] = "0"
    total_discount_given: Optional[Decimal] = None
    is_active: Optional[bool] = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class AppliedDiscountBase(BaseModel):
    """Base applied discount schema"""
    work_order_id: UUID
    discount_rule_id: Optional[UUID] = None
    customer_credit_id: Optional[UUID] = None
    
    discount_code_used: Optional[str] = None
    discount_amount: Decimal
    original_amount: Decimal
    final_amount: Decimal
    
    customer_name: Optional[str] = None
    customer_email: Optional[EmailStr] = None
    
    applied_by_staff_id: UUID
    
    description: Optional[str] = None
    notes: Optional[str] = None
    
    is_approved: Optional[bool] = True


class AppliedDiscountCreate(AppliedDiscountBase):
    """Schema for creating an applied discount"""
    pass


class AppliedDiscountUpdate(BaseModel):
    """Schema for updating an applied discount"""
    description: Optional[str] = None
    notes: Optional[str] = None
    is_approved: Optional[bool] = None
    is_reversed: Optional[bool] = None
    reversed_by_staff_id: Optional[UUID] = None
    reversal_reason: Optional[str] = None


class AppliedDiscount(AppliedDiscountBase):
    """Applied discount schema with all fields"""
    id: UUID
    applied_date: datetime
    is_reversed: Optional[bool] = False
    reversed_date: Optional[datetime] = None
    reversed_by_staff_id: Optional[UUID] = None
    reversal_reason: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


# Response schemas
class CustomerCreditResponse(BaseModel):
    """Response schema for customer credit endpoints"""
    data: Optional[CustomerCredit] = None
    error: Optional[str] = None
    message: Optional[str] = None


class CustomerCreditsResponse(BaseModel):
    """Response schema for multiple customer credits"""
    data: list[CustomerCredit]
    total: int


class DiscountRuleResponse(BaseModel):
    """Response schema for discount rule endpoints"""
    data: Optional[DiscountRule] = None
    error: Optional[str] = None
    message: Optional[str] = None


class DiscountRulesResponse(BaseModel):
    """Response schema for multiple discount rules"""
    data: list[DiscountRule]
    total: int


class AppliedDiscountResponse(BaseModel):
    """Response schema for applied discount endpoints"""
    data: Optional[AppliedDiscount] = None
    error: Optional[str] = None
    message: Optional[str] = None


class AppliedDiscountsResponse(BaseModel):
    """Response schema for multiple applied discounts"""
    data: list[AppliedDiscount]
    total: int


# Filter schemas
class CustomerCreditFilter(BaseModel):
    """Filter parameters for customer credits"""
    search: Optional[str] = None
    credit_type: Optional[CreditType] = None
    status: Optional[CreditStatus] = None
    company_id: Optional[UUID] = None
    customer_email: Optional[str] = None
    issued_by_staff_id: Optional[UUID] = None
    amount_min: Optional[Decimal] = None
    amount_max: Optional[Decimal] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None


class DiscountRuleFilter(BaseModel):
    """Filter parameters for discount rules"""
    search: Optional[str] = None
    discount_type: Optional[DiscountType] = None
    company_id: Optional[UUID] = None
    is_active: Optional[bool] = None
    is_public: Optional[bool] = None
    requires_code: Optional[bool] = None