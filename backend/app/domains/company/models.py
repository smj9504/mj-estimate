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
    
    # Status
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    
    # Relationships
    invoices = relationship("Invoice", back_populates="company", cascade="all, delete-orphan")
    estimates = relationship("Estimate", back_populates="company", cascade="all, delete-orphan")
    plumber_reports = relationship("PlumberReport", back_populates="company", cascade="all, delete-orphan")
    
    # Payment configuration relationships - temporarily commented out to resolve circular import
    # payment_method_ref = relationship("PaymentMethod", foreign_keys=[payment_method_id], lazy="joined")
    # payment_frequency_ref = relationship("PaymentFrequency", foreign_keys=[payment_frequency_id], lazy="joined")
    
    # TODO: Add these models when implementing license and insurance management
    # licenses = relationship("CompanyLicense", back_populates="company", cascade="all, delete-orphan")
    # insurance_policies = relationship("CompanyInsurance", back_populates="company", cascade="all, delete-orphan")