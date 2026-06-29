"""
Company domain models
"""

from sqlalchemy import Column, String, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database_factory import Base
from app.core.base_models import BaseModel
from app.core.database_types import UUIDType


class Company(Base, BaseModel):
    """Company entity model"""
    __tablename__ = "companies"
    __table_args__ = {'extend_existing': True}

    # Basic information
    name = Column(String(255), nullable=False)
    # Company type: contractor, public_adjuster, water_mitigation, insurance, moving, roofing, other
    company_type = Column(String(50), default='contractor')
    address = Column(Text)
    city = Column(String(100))
    state = Column(String(50))
    zipcode = Column(String(20))
    
    # Contact information
    phone = Column(String(50))
    email = Column(String(255))
    website = Column(String(255))
    
    # Business information
    company_code = Column(String(10))  # Unique company code
    license_number = Column(String(100))
    insurance_info = Column(Text)
    
    # Payment information (legacy fields - kept for backward compatibility)
    payment_method = Column(String(50))  # e.g., 'zelle', 'stripe', 'check'
    payment_frequency = Column(String(50))  # e.g., 'per_job', 'weekly', 'prepaid'
    
    # Payment configuration references (new fields)
    payment_method_id = Column(UUIDType(), ForeignKey('payment_methods.id', ondelete='SET NULL'), nullable=True)
    payment_frequency_id = Column(UUIDType(), ForeignKey('payment_frequencies.id', ondelete='SET NULL'), nullable=True)
    
    # Logo and branding
    logo = Column(Text)  # Base64 encoded logo

    # Company documents
    w9_file_id = Column(UUIDType(), nullable=True, comment="File ID for company W-9 document")
    
    # Status
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    
    # Relationships (lazy='select' prevents circular import issues)
    invoices = relationship("Invoice", back_populates="company", foreign_keys="Invoice.company_id", cascade="all, delete-orphan", lazy='select')
    estimates = relationship("Estimate", back_populates="company", cascade="all, delete-orphan", lazy='select')
    plumber_reports = relationship("PlumberReport", back_populates="company", cascade="all, delete-orphan", lazy='select')
    electrician_reports = relationship("ElectricianReport", back_populates="company", cascade="all, delete-orphan", lazy='select')
    sketches = relationship("Sketch", back_populates="company", cascade="all, delete-orphan", lazy='select')
    receipts = relationship("Receipt", back_populates="company", cascade="all, delete-orphan", lazy='select')
    receipt_templates = relationship("ReceiptTemplate", back_populates="company", cascade="all, delete-orphan", lazy='select')
    packout_analyses = relationship("PhotoAnalysisPackout", back_populates="company", cascade="all, delete-orphan", lazy='select')

    # Payment configuration relationships - temporarily commented out to resolve circular import
    # payment_method_ref = relationship("PaymentMethod", foreign_keys=[payment_method_id], lazy="joined")
    # payment_frequency_ref = relationship("PaymentFrequency", foreign_keys=[payment_frequency_id], lazy="joined")
    
    # Contacts
    contacts = relationship(
        "CompanyContact",
        back_populates="company",
        cascade="all, delete-orphan",
        lazy="select",
    )


class CompanyContact(Base, BaseModel):
    """Individual contact person within a company"""
    __tablename__ = "company_contacts"
    __table_args__ = {'extend_existing': True}

    company_id = Column(
        UUIDType(),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False)
    title = Column(String(100))       # e.g., "Senior Adjuster", "Project Manager"
    email = Column(String(255))
    phone = Column(String(50))
    is_primary = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    notes = Column(Text)

    company = relationship("Company", back_populates="contacts", lazy="select")