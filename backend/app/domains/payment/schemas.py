"""
Payment Pydantic schemas
"""

from typing import Optional
from pydantic import BaseModel, EmailStr, validator
from datetime import datetime
from uuid import UUID
from decimal import Decimal

from .models import PaymentStatus, PaymentMethod, BillingCycle


class PaymentBase(BaseModel):
    """Base payment schema"""
    payment_number: str
    company_id: UUID
    work_order_id: Optional[UUID] = None
    invoice_id: Optional[UUID] = None
    
    amount: Decimal
    currency: Optional[str] = "USD"
    payment_method: PaymentMethod
    
    transaction_id: Optional[str] = None
    reference_number: Optional[str] = None
    authorization_code: Optional[str] = None
    
    processor_name: Optional[str] = None
    processor_fee: Optional[Decimal] = None
    net_amount: Optional[Decimal] = None
    
    payment_date: datetime
    due_date: Optional[datetime] = None
    
    customer_name: Optional[str] = None
    customer_email: Optional[EmailStr] = None
    customer_phone: Optional[str] = None
    
    billing_address: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_zipcode: Optional[str] = None
    billing_country: Optional[str] = "USA"
    
    description: Optional[str] = None
    notes: Optional[str] = None
    
    tax_amount: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    tip_amount: Optional[Decimal] = None
    
    is_recurring: Optional[bool] = False
    is_refundable: Optional[bool] = True
    
    @validator('amount', 'processor_fee', 'net_amount', 'tax_amount', 'discount_amount', 'tip_amount')
    def validate_amounts(cls, v):
        if v is not None and v < 0:
            raise ValueError('Amount cannot be negative')
        return v


class PaymentCreate(PaymentBase):
    """Schema for creating a payment"""
    pass


class PaymentUpdate(BaseModel):
    """Schema for updating a payment"""
    payment_number: Optional[str] = None
    work_order_id: Optional[UUID] = None
    invoice_id: Optional[UUID] = None
    
    amount: Optional[Decimal] = None
    currency: Optional[str] = None
    payment_method: Optional[PaymentMethod] = None
    status: Optional[PaymentStatus] = None
    
    transaction_id: Optional[str] = None
    reference_number: Optional[str] = None
    authorization_code: Optional[str] = None
    
    processor_name: Optional[str] = None
    processor_fee: Optional[Decimal] = None
    net_amount: Optional[Decimal] = None
    
    payment_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    processed_date: Optional[datetime] = None
    
    customer_name: Optional[str] = None
    customer_email: Optional[EmailStr] = None
    customer_phone: Optional[str] = None
    
    billing_address: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_zipcode: Optional[str] = None
    billing_country: Optional[str] = None
    
    description: Optional[str] = None
    notes: Optional[str] = None
    
    tax_amount: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    tip_amount: Optional[Decimal] = None
    
    is_recurring: Optional[bool] = None
    is_refundable: Optional[bool] = None
    is_disputed: Optional[bool] = None


class Payment(PaymentBase):
    """Payment schema with all fields"""
    id: UUID
    status: PaymentStatus
    processed_date: Optional[datetime] = None
    is_disputed: Optional[bool] = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class BillingScheduleBase(BaseModel):
    """Base billing schedule schema"""
    schedule_name: str
    company_id: UUID
    work_order_id: Optional[UUID] = None
    
    billing_cycle: BillingCycle
    amount: Decimal
    currency: Optional[str] = "USD"
    
    start_date: datetime
    end_date: Optional[datetime] = None
    next_billing_date: datetime
    
    customer_name: str
    customer_email: Optional[EmailStr] = None
    customer_phone: Optional[str] = None
    
    payment_method: PaymentMethod
    payment_token: Optional[str] = None
    
    description: Optional[str] = None
    terms_and_conditions: Optional[str] = None
    
    auto_charge: Optional[bool] = True
    send_reminders: Optional[bool] = True


class BillingScheduleCreate(BillingScheduleBase):
    """Schema for creating a billing schedule"""
    pass


class BillingScheduleUpdate(BaseModel):
    """Schema for updating a billing schedule"""
    schedule_name: Optional[str] = None
    work_order_id: Optional[UUID] = None
    
    billing_cycle: Optional[BillingCycle] = None
    amount: Optional[Decimal] = None
    currency: Optional[str] = None
    
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    next_billing_date: Optional[datetime] = None
    last_billing_date: Optional[datetime] = None
    
    customer_name: Optional[str] = None
    customer_email: Optional[EmailStr] = None
    customer_phone: Optional[str] = None
    
    payment_method: Optional[PaymentMethod] = None
    payment_token: Optional[str] = None
    
    description: Optional[str] = None
    terms_and_conditions: Optional[str] = None
    
    is_active: Optional[bool] = None
    auto_charge: Optional[bool] = None
    send_reminders: Optional[bool] = None


class BillingSchedule(BillingScheduleBase):
    """Billing schedule schema with all fields"""
    id: UUID
    last_billing_date: Optional[datetime] = None
    is_active: Optional[bool] = True
    total_payments_made: Optional[Decimal] = None
    payments_count: Optional[str] = "0"
    failed_attempts: Optional[str] = "0"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class PaymentRefundBase(BaseModel):
    """Base payment refund schema"""
    refund_number: str
    payment_id: UUID
    refund_amount: Decimal
    reason: Optional[str] = None
    processed_by_staff_id: UUID
    refund_date: datetime
    internal_notes: Optional[str] = None


class PaymentRefundCreate(PaymentRefundBase):
    """Schema for creating a payment refund"""
    pass


class PaymentRefundUpdate(BaseModel):
    """Schema for updating a payment refund"""
    reason: Optional[str] = None
    status: Optional[PaymentStatus] = None
    processor_refund_id: Optional[str] = None
    processor_fee: Optional[Decimal] = None
    processed_date: Optional[datetime] = None
    internal_notes: Optional[str] = None
    customer_notification_sent: Optional[bool] = None


class PaymentRefund(PaymentRefundBase):
    """Payment refund schema with all fields"""
    id: UUID
    status: PaymentStatus
    processor_refund_id: Optional[str] = None
    processor_fee: Optional[Decimal] = None
    processed_date: Optional[datetime] = None
    customer_notification_sent: Optional[bool] = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


# Response schemas
class PaymentResponse(BaseModel):
    """Response schema for payment endpoints"""
    data: Optional[Payment] = None
    error: Optional[str] = None
    message: Optional[str] = None


class PaymentsResponse(BaseModel):
    """Response schema for multiple payments"""
    data: list[Payment]
    total: int


class BillingScheduleResponse(BaseModel):
    """Response schema for billing schedule endpoints"""
    data: Optional[BillingSchedule] = None
    error: Optional[str] = None
    message: Optional[str] = None


class BillingSchedulesResponse(BaseModel):
    """Response schema for multiple billing schedules"""
    data: list[BillingSchedule]
    total: int


class PaymentRefundResponse(BaseModel):
    """Response schema for payment refund endpoints"""
    data: Optional[PaymentRefund] = None
    error: Optional[str] = None
    message: Optional[str] = None


class PaymentRefundsResponse(BaseModel):
    """Response schema for multiple payment refunds"""
    data: list[PaymentRefund]
    total: int


# Filter schemas
class PaymentFilter(BaseModel):
    """Filter parameters for payments"""
    search: Optional[str] = None
    status: Optional[PaymentStatus] = None
    payment_method: Optional[PaymentMethod] = None
    company_id: Optional[UUID] = None
    work_order_id: Optional[UUID] = None
    customer_email: Optional[str] = None
    amount_min: Optional[Decimal] = None
    amount_max: Optional[Decimal] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    is_recurring: Optional[bool] = None
    is_disputed: Optional[bool] = None


class BillingScheduleFilter(BaseModel):
    """Filter parameters for billing schedules"""
    search: Optional[str] = None
    billing_cycle: Optional[BillingCycle] = None
    company_id: Optional[UUID] = None
    work_order_id: Optional[UUID] = None
    is_active: Optional[bool] = None
    auto_charge: Optional[bool] = None