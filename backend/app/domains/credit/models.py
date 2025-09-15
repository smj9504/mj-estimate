"""
Credit and discount database models
"""

from sqlalchemy import Column, String, Text, DateTime, Boolean, ForeignKey, Enum, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum
from decimal import Decimal

from app.core.database_factory import Base


class CreditType(str, enum.Enum):
    """Credit type enumeration"""
    CUSTOMER_CREDIT = "customer_credit"
    PROMOTIONAL_CREDIT = "promotional_credit"
    REFUND_CREDIT = "refund_credit"
    LOYALTY_CREDIT = "loyalty_credit"
    ADJUSTMENT_CREDIT = "adjustment_credit"


class DiscountType(str, enum.Enum):
    """Discount type enumeration"""
    PERCENTAGE = "percentage"
    FIXED_AMOUNT = "fixed_amount"
    BUY_ONE_GET_ONE = "buy_one_get_one"
    VOLUME_DISCOUNT = "volume_discount"
    EARLY_PAYMENT = "early_payment"
    SENIOR_DISCOUNT = "senior_discount"
    MILITARY_DISCOUNT = "military_discount"


class CreditStatus(str, enum.Enum):
    """Credit status enumeration"""
    ACTIVE = "active"
    USED = "used"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    PENDING = "pending"


class CustomerCredit(Base):
    """Customer credit model for tracking customer credits"""
    __tablename__ = "customer_credits"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Credit Information
    credit_number = Column(String(50), unique=True, nullable=False, index=True)
    
    # Relationships
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    work_order_id = Column(UUID(as_uuid=True), ForeignKey("work_orders.id"))
    payment_id = Column(UUID(as_uuid=True))
    
    # Credit Details
    credit_type = Column(Enum(CreditType), nullable=False)
    amount = Column(Numeric(precision=10, scale=2), nullable=False)
    currency = Column(String(3), default="USD")
    status = Column(Enum(CreditStatus), default=CreditStatus.ACTIVE)
    
    # Customer Information
    customer_name = Column(String(200), nullable=False)
    customer_email = Column(String(200))
    customer_phone = Column(String(50))
    
    # Credit Validity
    issued_date = Column(DateTime, nullable=False, default=datetime.utcnow)
    expiry_date = Column(DateTime)
    used_date = Column(DateTime)
    
    # Usage Information
    original_amount = Column(Numeric(precision=10, scale=2))
    remaining_amount = Column(Numeric(precision=10, scale=2))
    used_amount = Column(Numeric(precision=10, scale=2), default=0)
    
    # Credit Description
    description = Column(Text)
    reason = Column(Text)
    terms_and_conditions = Column(Text)
    
    # Staff Information
    issued_by_staff_id = Column(UUID(as_uuid=True), nullable=False)
    approved_by_staff_id = Column(UUID(as_uuid=True))
    
    # Status Flags
    is_transferable = Column(Boolean, default=False)
    is_refundable = Column(Boolean, default=False)
    auto_apply = Column(Boolean, default=False)
    
    # Internal Notes
    internal_notes = Column(Text)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __str__(self):
        return f"Credit #{self.credit_number} - ${self.amount}"
    
    def __repr__(self):
        return f"<CustomerCredit(id={self.id}, number={self.credit_number}, amount={self.amount})>"


class DiscountRule(Base):
    """Discount rule model for defining discount policies"""
    __tablename__ = "discount_rules"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Rule Information
    rule_name = Column(String(200), nullable=False)
    rule_code = Column(String(50), unique=True, nullable=False, index=True)
    
    # Relationships
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    
    # Discount Details
    discount_type = Column(Enum(DiscountType), nullable=False)
    discount_value = Column(Numeric(precision=10, scale=2), nullable=False)
    min_order_amount = Column(Numeric(precision=10, scale=2))
    max_discount_amount = Column(Numeric(precision=10, scale=2))
    
    # Rule Validity
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime)
    max_uses = Column(String(20))  # Maximum number of uses
    max_uses_per_customer = Column(String(20))  # Max uses per customer
    
    # Usage Statistics
    total_uses = Column(String(20), default="0")
    total_discount_given = Column(Numeric(precision=10, scale=2), default=0)
    
    # Rule Conditions
    applicable_services = Column(Text)  # JSON list of applicable services
    applicable_customer_types = Column(Text)  # JSON list of customer types
    minimum_quantity = Column(String(20))
    
    # Rule Description
    description = Column(Text)
    terms_and_conditions = Column(Text)
    public_description = Column(Text)  # Customer-facing description
    
    # Status Flags
    is_active = Column(Boolean, default=True)
    is_automatic = Column(Boolean, default=False)  # Auto-apply if conditions met
    is_stackable = Column(Boolean, default=False)  # Can be combined with other discounts
    is_public = Column(Boolean, default=True)  # Visible to customers
    requires_code = Column(Boolean, default=False)  # Requires discount code
    
    # Staff Information
    created_by_staff_id = Column(UUID(as_uuid=True), nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __str__(self):
        return f"Discount Rule: {self.rule_name}"
    
    def __repr__(self):
        return f"<DiscountRule(id={self.id}, name={self.rule_name}, code={self.rule_code})>"


class AppliedDiscount(Base):
    """Applied discount model for tracking discount usage"""
    __tablename__ = "applied_discounts"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Relationships
    work_order_id = Column(UUID(as_uuid=True), ForeignKey("work_orders.id"), nullable=False)
    discount_rule_id = Column(UUID(as_uuid=True), ForeignKey("discount_rules.id"))
    customer_credit_id = Column(UUID(as_uuid=True), ForeignKey("customer_credits.id"))
    
    # Discount Application Details
    discount_code_used = Column(String(50))
    discount_amount = Column(Numeric(precision=10, scale=2), nullable=False)
    original_amount = Column(Numeric(precision=10, scale=2), nullable=False)
    final_amount = Column(Numeric(precision=10, scale=2), nullable=False)
    
    # Customer Information
    customer_name = Column(String(200))
    customer_email = Column(String(200))
    
    # Application Details
    applied_date = Column(DateTime, nullable=False, default=datetime.utcnow)
    applied_by_staff_id = Column(UUID(as_uuid=True), nullable=False)
    
    # Additional Information
    description = Column(Text)
    notes = Column(Text)
    
    # Status Flags
    is_approved = Column(Boolean, default=True)
    is_reversed = Column(Boolean, default=False)
    
    # Reversal Information
    reversed_date = Column(DateTime)
    reversed_by_staff_id = Column(UUID(as_uuid=True))
    reversal_reason = Column(Text)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __str__(self):
        return f"Applied Discount: ${self.discount_amount}"
    
    def __repr__(self):
        return f"<AppliedDiscount(id={self.id}, amount={self.discount_amount}, work_order_id={self.work_order_id})>"


class CreditTransaction(Base):
    """Credit transaction model for tracking credit usage"""
    __tablename__ = "credit_transactions"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Transaction Information
    transaction_number = Column(String(50), unique=True, nullable=False, index=True)
    
    # Relationships
    customer_credit_id = Column(UUID(as_uuid=True), ForeignKey("customer_credits.id"), nullable=False)
    work_order_id = Column(UUID(as_uuid=True), ForeignKey("work_orders.id"))
    payment_id = Column(UUID(as_uuid=True))
    
    # Transaction Details
    transaction_type = Column(String(50), nullable=False)  # 'use', 'refund', 'transfer', 'expire'
    amount = Column(Numeric(precision=10, scale=2), nullable=False)
    balance_before = Column(Numeric(precision=10, scale=2), nullable=False)
    balance_after = Column(Numeric(precision=10, scale=2), nullable=False)
    
    # Transaction Information
    transaction_date = Column(DateTime, nullable=False, default=datetime.utcnow)
    processed_by_staff_id = Column(UUID(as_uuid=True), nullable=False)
    
    # Additional Information
    description = Column(Text)
    reference_number = Column(String(100))
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __str__(self):
        return f"Credit Transaction #{self.transaction_number}"
    
    def __repr__(self):
        return f"<CreditTransaction(id={self.id}, number={self.transaction_number}, amount={self.amount})>"