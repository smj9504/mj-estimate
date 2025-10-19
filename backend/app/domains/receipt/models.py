"""
Receipt domain models
"""

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, DECIMAL, Boolean, Index, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database_factory import Base
from app.core.base_models import BaseModel
from app.core.database_types import UUIDType


class Receipt(Base, BaseModel):
    """
    Receipt model - Generated when invoice is paid
    Links to invoice and captures financial snapshot
    """
    __tablename__ = "receipts"
    __table_args__ = (
        Index('ix_receipt_number', 'receipt_number'),
        Index('ix_receipt_invoice_id', 'invoice_id'),
        Index('ix_receipt_company_id', 'company_id'),
        Index('ix_receipt_status', 'status'),
        {'extend_existing': True}
    )

    # Core identification
    receipt_number = Column(String(50), nullable=False, unique=True, index=True)
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)
    invoice_id = Column(UUIDType(), ForeignKey("invoices.id"), nullable=False)
    template_id = Column(UUIDType(), ForeignKey("receipt_templates.id"), nullable=True)

    # Receipt metadata
    receipt_date = Column(DateTime(timezone=True), nullable=False, default=func.now())
    status = Column(String(20), default="issued", nullable=False)  # draft, issued, voided

    # Payment information
    payment_amount = Column(DECIMAL(15, 2), nullable=False)
    payment_method = Column(String(50), nullable=True)
    payment_reference = Column(String(255), nullable=True)

    # Financial snapshot from invoice at time of receipt
    invoice_number = Column(String(50), nullable=False)
    original_amount = Column(DECIMAL(15, 2), nullable=False)
    paid_amount_to_date = Column(DECIMAL(15, 2), nullable=False)
    balance_due = Column(DECIMAL(15, 2), nullable=False)

    # Customizable notes (can override template)
    top_note = Column(Text, nullable=True)
    bottom_note = Column(Text, nullable=True)

    # Versioning (if invoice payments change, create new version)
    version = Column(Integer, default=1, nullable=False)
    superseded_by = Column(UUIDType(), nullable=True)  # Points to newer version

    # Audit fields
    created_by = Column(UUIDType(), nullable=True)
    updated_by = Column(UUIDType(), nullable=True)
    voided_at = Column(DateTime(timezone=True), nullable=True)
    voided_by = Column(UUIDType(), nullable=True)
    void_reason = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="receipts")
    invoice = relationship("Invoice", back_populates="receipts")
    template = relationship("ReceiptTemplate", foreign_keys=[template_id])


class ReceiptTemplate(Base, BaseModel):
    """
    Receipt template configuration model
    Manages template settings for receipt generation
    """
    __tablename__ = "receipt_templates"
    __table_args__ = (
        Index('ix_template_company_id', 'company_id'),
        Index('ix_template_is_default', 'is_default'),
        Index('ix_template_type', 'template_type'),
        {'extend_existing': True}
    )

    # Core identification
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)

    # Template type and status
    template_type = Column(String(50), default="standard", nullable=False)
    # Types: standard, deposit, final, partial, custom
    is_default = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    # Default note content
    top_note = Column(Text, nullable=True)
    bottom_note = Column(Text, nullable=True)

    # Display configuration (JSON)
    display_options = Column(JSON, default=dict)
    # Example: {
    #   "show_payment_method": true,
    #   "show_balance_due": true,
    #   "show_invoice_details": true,
    #   "show_company_logo": true,
    #   "show_payment_breakdown": false,
    #   "footer_text": "Thank you for your business"
    # }

    # Versioning
    version = Column(Integer, default=1, nullable=False)

    # Audit fields
    created_by = Column(UUIDType(), nullable=True)
    updated_by = Column(UUIDType(), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="receipt_templates")
