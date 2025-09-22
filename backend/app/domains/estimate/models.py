"""
Estimate domain models
"""

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, DECIMAL, JSON, Boolean, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database_factory import Base
from app.core.base_models import BaseModel
from app.core.database_types import UUIDType  # UUID 타입 임포트 추가


class Estimate(Base, BaseModel):
    __tablename__ = "estimates"
    __table_args__ = (
        Index('ix_estimate_number_version', 'estimate_number', 'version'),
        {'extend_existing': True}
    )

    estimate_number = Column(String(50), nullable=False, index=True)
    estimate_type = Column(String(50), default="standard", nullable=False)  # 'standard' or 'insurance'
    version = Column(Integer, default=1, nullable=False)
    is_latest = Column(Boolean, default=True, nullable=False)
    company_id = Column(UUIDType(), ForeignKey("companies.id"))  # String → UUIDType으로 수정
    client_name = Column(String(255), nullable=False)
    client_address = Column(Text)
    client_city = Column(String(100))
    client_state = Column(String(50))
    client_zipcode = Column(String(20))
    client_phone = Column(String(50))
    client_email = Column(String(255))
    
    estimate_date = Column(DateTime(timezone=True), default=func.now())
    loss_date = Column(DateTime(timezone=True))  # Insurance: Date when loss/damage occurred
    valid_until = Column(DateTime(timezone=True))
    status = Column(String(50), default="draft")  # draft, sent, accepted, rejected, expired
    
    subtotal = Column(DECIMAL(15, 2), default=0)
    op_percent = Column(DECIMAL(5, 2), default=0)  # O&P percentage
    op_amount = Column(DECIMAL(15, 2), default=0)  # O&P amount
    tax_method = Column(String(50), default="percentage")  # 'percentage' or 'specific'
    tax_rate = Column(DECIMAL(5, 2), default=0)
    tax_amount = Column(DECIMAL(15, 2), default=0)
    discount_amount = Column(DECIMAL(15, 2), default=0)
    total_amount = Column(DECIMAL(15, 2), default=0)
    
    notes = Column(Text)
    terms = Column(Text)
    
    # Insurance estimate specific fields
    claim_number = Column(String(100))
    policy_number = Column(String(100))
    insurance_company = Column(String(255))
    deductible = Column(DECIMAL(15, 2))
    adjuster_name = Column(String(255))
    adjuster_phone = Column(String(50))
    adjuster_email = Column(String(255))
    depreciation_amount = Column(DECIMAL(15, 2), default=0)
    acv_amount = Column(DECIMAL(15, 2), default=0)  # Actual Cash Value
    rcv_amount = Column(DECIMAL(15, 2), default=0)  # Replacement Cost Value
    
    # Room data for floor plans
    room_data = Column(JSON)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="estimates")
    items = relationship("EstimateItem", back_populates="estimate", cascade="all, delete-orphan")


class EstimateItem(Base, BaseModel):
    __tablename__ = "estimate_items"

    estimate_id = Column(UUIDType(), ForeignKey("estimates.id"))  # String → UUIDType으로 수정

    # Flexible grouping fields (replacing room field)
    primary_group = Column(String(255))  # 1차 분류 (자유 입력)
    secondary_group = Column(String(255))  # 2차 분류 (자유 입력, 선택적)
    sort_order = Column(Integer, default=0)  # 그룹 내 정렬 순서

    # Keep room for backward compatibility (will be deprecated)
    room = Column(String(100))  # Deprecated - use primary_group/secondary_group instead

    # Item name field - aligned with invoice_items table for consistency
    name = Column(String(255))  # Item name or identifier (renamed from item_code)

    description = Column(Text, nullable=True)
    quantity = Column(DECIMAL(10, 2), default=1)
    unit = Column(String(50))
    rate = Column(DECIMAL(15, 2), default=0)
    amount = Column(DECIMAL(15, 2), default=0)
    taxable = Column(Boolean, default=True)  # Whether the item is taxable
    tax_rate = Column(DECIMAL(5, 2), default=0)
    tax_amount = Column(DECIMAL(15, 2), default=0)
    
    # Insurance specific fields
    depreciation_rate = Column(DECIMAL(5, 2), default=0)
    depreciation_amount = Column(DECIMAL(15, 2), default=0)
    acv_amount = Column(DECIMAL(15, 2), default=0)
    rcv_amount = Column(DECIMAL(15, 2), default=0)
    
    order_index = Column(Integer, default=0)
    category = Column(String(100))  # labor, material, equipment, etc.
    
    # Line item integration
    line_item_id = Column(UUIDType(), nullable=True)  # References line_items.id - String → UUIDType으로 수정
    is_custom_override = Column(Boolean, default=False)
    override_values = Column(Text)  # JSON string for override values
    
    # Rich text note field for item-specific notes
    note = Column(Text)  # HTML content for rich text notes
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    estimate = relationship("Estimate", back_populates="items")
    # Note: line_item relationship defined in line_items.models to avoid circular imports