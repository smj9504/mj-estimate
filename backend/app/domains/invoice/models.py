"""
Invoice domain models
"""

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, DECIMAL, Boolean, Index, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database_factory import Base
from app.core.base_models import BaseModel
from app.core.database_types import UUIDType  # UUID 타입 임포트 추가


class Invoice(Base, BaseModel):
    __tablename__ = "invoices"
    __table_args__ = (
        Index('ix_invoice_number_version', 'invoice_number', 'version'),
        {'extend_existing': True}
    )

    invoice_number = Column(String(50), nullable=False, index=True)
    version = Column(Integer, default=1, nullable=False)
    is_latest = Column(Boolean, default=True, nullable=False)
    company_id = Column(UUIDType(), ForeignKey("companies.id"))  # String → UUIDType으로 수정
    client_name = Column(String(255), nullable=False)
    client_company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)  # Optional reference to registered company
    client_address = Column(Text)
    client_city = Column(String(100))
    client_state = Column(String(50))
    client_zipcode = Column(String(20))
    client_phone = Column(String(50))
    client_email = Column(String(255))
    
    invoice_date = Column(DateTime(timezone=True), default=func.now())
    due_date = Column(DateTime(timezone=True))
    status = Column(String(50), default="pending")  # pending, paid, overdue, cancelled
    
    subtotal = Column(DECIMAL(15, 2), default=0)
    op_percent = Column(DECIMAL(5, 2), default=0)  # O&P percentage
    tax_method = Column(String(50), default="percentage")  # 'percentage' or 'specific'
    tax_rate = Column(DECIMAL(5, 2), default=0)
    tax_amount = Column(DECIMAL(15, 2), default=0)
    discount_amount = Column(DECIMAL(15, 2), default=0)
    total_amount = Column(DECIMAL(15, 2), default=0)
    
    # Payment tracking
    payments = Column(JSON, default=list)  # Array of payment records
    show_payment_dates = Column(Boolean, default=True)
    balance_due = Column(DECIMAL(15, 2), default=0)

    # Receipt tracking
    has_receipt = Column(Boolean, default=False)  # Indicates if receipt has been generated
    receipt_number = Column(String(50))  # Optional separate receipt number
    receipt_generated_at = Column(DateTime(timezone=True))  # When receipt was generated
    
    # Insurance information
    insurance_company = Column(String(255))
    insurance_policy_number = Column(String(100))
    insurance_claim_number = Column(String(100))
    insurance_deductible = Column(DECIMAL(15, 2))

    notes = Column(Text)
    terms = Column(Text)
    payment_terms = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company", foreign_keys=[company_id], back_populates="invoices")
    items = relationship("InvoiceItem", back_populates="invoice", cascade="all, delete-orphan")
    receipts = relationship("Receipt", back_populates="invoice", cascade="all, delete-orphan")


class InvoiceItem(Base, BaseModel):
    __tablename__ = "invoice_items"

    invoice_id = Column(UUIDType(), ForeignKey("invoices.id"))  # String → UUIDType으로 수정
    name = Column(String(255), nullable=False)
    description = Column(Text)
    quantity = Column(DECIMAL(10, 2), default=1)
    unit = Column(String(50))
    rate = Column(DECIMAL(15, 2), default=0)
    amount = Column(DECIMAL(15, 2), default=0)
    taxable = Column(Boolean, default=True)
    tax_rate = Column(DECIMAL(5, 2), default=0)
    tax_amount = Column(DECIMAL(15, 2), default=0)
    order_index = Column(Integer, default=0)

    # Section/Group fields for organizing items
    primary_group = Column(String(255))  # Section name
    secondary_group = Column(String(255))  # Sub-category (optional)
    sort_order = Column(Integer, default=0)  # Sort order within section
    
    # Line item integration
    line_item_id = Column(UUIDType(), nullable=True)  # References line_items.id - String → UUIDType으로 수정
    is_custom_override = Column(Boolean, default=False)
    override_values = Column(Text)  # JSON string for override values

    # Rich text note field for item-specific notes
    note = Column(Text)  # HTML content for rich text notes

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    invoice = relationship("Invoice", back_populates="items")
    # Note: line_item relationship defined in line_items.models to avoid circular imports