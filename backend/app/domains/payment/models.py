"""
Payment and billing database models
"""

from sqlalchemy import Column, String, Text, DateTime, Boolean, ForeignKey, Enum, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum
from decimal import Decimal

from app.core.database_factory import Base


class PaymentStatus(str, enum.Enum):
    """Payment status enumeration"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"
    PARTIAL_REFUND = "partial_refund"


class PaymentMethod(str, enum.Enum):
    """Payment method enumeration"""
    CASH = "cash"
    CHECK = "check"
    CREDIT_CARD = "credit_card"
    DEBIT_CARD = "debit_card"
    BANK_TRANSFER = "bank_transfer"
    PAYPAL = "paypal"
    STRIPE = "stripe"
    SQUARE = "square"
    OTHER = "other"


class BillingCycle(str, enum.Enum):
    """Billing cycle enumeration"""
    ONE_TIME = "one_time"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUALLY = "annually"


class Payment(Base):
    """Payment model for tracking payments"""
    __tablename__ = "payments"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Payment Information
    payment_number = Column(String(50), unique=True, nullable=False, index=True)
    
    # Relationships
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    work_order_id = Column(UUID(as_uuid=True), ForeignKey("work_orders.id"))
    invoice_id = Column(UUID(as_uuid=True))  # Link to invoice if exists
    
    # Payment Details
    amount = Column(Numeric(precision=10, scale=2), nullable=False)
    currency = Column(String(3), default="USD")
    payment_method = Column(Enum(PaymentMethod), nullable=False)
    status = Column(Enum(PaymentStatus), default=PaymentStatus.PENDING)
    
    # Transaction Information
    transaction_id = Column(String(100))  # External payment processor ID
    reference_number = Column(String(100))
    authorization_code = Column(String(100))
    
    # Payment Processor Details
    processor_name = Column(String(50))  # Stripe, PayPal, Square, etc.
    processor_fee = Column(Numeric(precision=10, scale=2))
    net_amount = Column(Numeric(precision=10, scale=2))
    
    # Payment Dates
    payment_date = Column(DateTime, nullable=False)
    due_date = Column(DateTime)
    processed_date = Column(DateTime)
    
    # Customer Information
    customer_name = Column(String(200))
    customer_email = Column(String(200))
    customer_phone = Column(String(50))
    
    # Billing Address
    billing_address = Column(String(500))
    billing_city = Column(String(100))
    billing_state = Column(String(50))
    billing_zipcode = Column(String(20))
    billing_country = Column(String(100), default="USA")
    
    # Payment Description
    description = Column(Text)
    notes = Column(Text)
    
    # Additional Information
    tax_amount = Column(Numeric(precision=10, scale=2))
    discount_amount = Column(Numeric(precision=10, scale=2))
    tip_amount = Column(Numeric(precision=10, scale=2))
    
    # Status Flags
    is_recurring = Column(Boolean, default=False)
    is_refundable = Column(Boolean, default=True)
    is_disputed = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __str__(self):
        return f"Payment #{self.payment_number} - ${self.amount}"
    
    def __repr__(self):
        return f"<Payment(id={self.id}, number={self.payment_number}, amount={self.amount})>"


class BillingSchedule(Base):
    """Billing schedule model for recurring payments"""
    __tablename__ = "billing_schedules"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Schedule Information
    schedule_name = Column(String(200), nullable=False)
    
    # Relationships
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    work_order_id = Column(UUID(as_uuid=True), ForeignKey("work_orders.id"))
    
    # Billing Details
    billing_cycle = Column(Enum(BillingCycle), nullable=False)
    amount = Column(Numeric(precision=10, scale=2), nullable=False)
    currency = Column(String(3), default="USD")
    
    # Schedule Dates
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime)
    next_billing_date = Column(DateTime, nullable=False)
    last_billing_date = Column(DateTime)
    
    # Customer Information
    customer_name = Column(String(200), nullable=False)
    customer_email = Column(String(200))
    customer_phone = Column(String(50))
    
    # Payment Method
    payment_method = Column(Enum(PaymentMethod), nullable=False)
    payment_token = Column(String(255))  # Stored payment method token
    
    # Schedule Details
    description = Column(Text)
    terms_and_conditions = Column(Text)
    
    # Status Flags
    is_active = Column(Boolean, default=True)
    auto_charge = Column(Boolean, default=True)
    send_reminders = Column(Boolean, default=True)
    
    # Statistics
    total_payments_made = Column(Numeric(precision=10, scale=2), default=0)
    payments_count = Column(String(20), default="0")
    failed_attempts = Column(String(20), default="0")
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __str__(self):
        return f"Billing Schedule: {self.schedule_name}"
    
    def __repr__(self):
        return f"<BillingSchedule(id={self.id}, name={self.schedule_name}, cycle={self.billing_cycle})>"


class PaymentRefund(Base):
    """Payment refund model"""
    __tablename__ = "payment_refunds"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Refund Information
    refund_number = Column(String(50), unique=True, nullable=False, index=True)
    
    # Relationships
    payment_id = Column(UUID(as_uuid=True), ForeignKey("payments.id"), nullable=False)
    
    # Refund Details
    refund_amount = Column(Numeric(precision=10, scale=2), nullable=False)
    reason = Column(Text)
    status = Column(Enum(PaymentStatus), default=PaymentStatus.PENDING)
    
    # Processing Information
    processed_by_staff_id = Column(UUID(as_uuid=True), nullable=False)
    processor_refund_id = Column(String(100))
    processor_fee = Column(Numeric(precision=10, scale=2))
    
    # Refund Dates
    refund_date = Column(DateTime, nullable=False)
    processed_date = Column(DateTime)
    
    # Additional Information
    internal_notes = Column(Text)
    customer_notification_sent = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __str__(self):
        return f"Refund #{self.refund_number} - ${self.refund_amount}"
    
    def __repr__(self):
        return f"<PaymentRefund(id={self.id}, number={self.refund_number}, amount={self.refund_amount})>"