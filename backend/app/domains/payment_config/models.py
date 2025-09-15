"""
Payment configuration models for managing payment methods and frequencies
"""

from sqlalchemy import Column, String, Boolean, Integer, Text
from sqlalchemy.orm import relationship

from app.core.database_factory import Base
from app.core.base_models import BaseModel


class PaymentMethod(Base, BaseModel):
    """Payment method configuration model"""
    __tablename__ = "payment_methods"
    
    # Basic information
    code = Column(String(50), unique=True, nullable=False)  # e.g., 'zelle', 'stripe'
    name = Column(String(100), nullable=False)  # Display name
    description = Column(Text)
    
    # Configuration
    requires_account_info = Column(Boolean, default=False)  # If true, requires additional setup
    
    # Status
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)


class PaymentFrequency(Base, BaseModel):
    """Payment frequency configuration model"""
    __tablename__ = "payment_frequencies"
    
    # Basic information
    code = Column(String(50), unique=True, nullable=False)  # e.g., 'per_job', 'weekly'
    name = Column(String(100), nullable=False)  # Display name
    description = Column(Text)
    
    # Configuration
    days_interval = Column(Integer)  # Number of days between payments (null for per_job)
    
    # Status
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)