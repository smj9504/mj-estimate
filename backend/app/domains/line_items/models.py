"""
Line Items domain models
"""

from sqlalchemy import (
    Column, String, Integer, DateTime, Text, 
    ForeignKey, DECIMAL, Boolean, Index, JSON,
    event, Enum as SQLEnum
)
from sqlalchemy.orm import relationship, validates
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
import uuid
import enum
from decimal import Decimal
from datetime import datetime
from typing import Optional

from app.core.database_factory import Base
from app.core.database_types import UUIDType, generate_uuid


class LineItemType(str, enum.Enum):
    """Line item type enumeration"""
    XACTIMATE = "XACTIMATE"
    CUSTOM = "CUSTOM"


class LineItem(Base):
    """Line Item model for custom line items only"""
    __tablename__ = "line_items"
    __table_args__ = (
        Index('idx_line_items_cat_item', 'cat', 'item'),
        Index('idx_line_items_company_active', 'company_id', 'is_active'),
        {'extend_existing': True}
    )
    
    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)
    type = Column(SQLEnum(LineItemType), nullable=False, default=LineItemType.CUSTOM)

    # Common fields
    cat = Column(String(50))  # Category code
    item = Column(String(50))  # Item code
    description = Column(Text, nullable=False)  # Line item name
    includes = Column(Text)  # Work description
    unit = Column(String(50))  # Measurement unit
    untaxed_unit_price = Column(DECIMAL(15, 2))  # Final unit price
    
    # Xactimate specific fields (NULL for custom)
    lab = Column(DECIMAL(15, 2))  # Labor price
    mat = Column(DECIMAL(15, 2))  # Material price (taxable)
    equ = Column(DECIMAL(15, 2))  # Equipment price
    labor_burden = Column(DECIMAL(15, 2))  # Labor burden price
    market_condition = Column(DECIMAL(15, 2))  # Market condition price
    
    # Metadata
    is_active = Column(Boolean, default=True)
    version = Column(Integer, default=1)
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)
    created_by = Column(UUIDType(), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    notes = relationship(
        "LineItemNote",
        secondary="line_item_note_mappings",
        back_populates="line_items",
        lazy="select"
    )
    templates = relationship(
        "TemplateLineItem",
        back_populates="line_item",
        cascade="all, delete-orphan"
    )
    # Note: These relationships work without back_populates since
    # InvoiceItem and EstimateItem don't have explicit line_item relationship
    invoice_items = relationship(
        "InvoiceItem",
        primaryjoin="LineItem.id == foreign(InvoiceItem.line_item_id)",
        viewonly=True
    )
    estimate_items = relationship(
        "EstimateItem",
        primaryjoin="LineItem.id == foreign(EstimateItem.line_item_id)",
        viewonly=True
    )
    
    @validates('lab', 'mat', 'equ', 'labor_burden', 'market_condition')
    def validate_prices(self, key, value):
        """Validate price fields"""
        if value is not None and value < 0:
            raise ValueError(f"{key} cannot be negative")
        return value
    
    def calculate_untaxed_unit_price(self) -> Decimal:
        """Calculate untaxed unit price for Xactimate items"""
        if self.type == LineItemType.XACTIMATE:
            return sum(filter(None, [
                Decimal(str(self.lab or 0)),
                Decimal(str(self.mat or 0)),
                Decimal(str(self.equ or 0)),
                Decimal(str(self.labor_burden or 0)),
                Decimal(str(self.market_condition or 0))
            ]))
        return Decimal(str(self.untaxed_unit_price or 0))
    
    def calculate_tax(self, tax_method: str, tax_rate: Decimal) -> Decimal:
        """Calculate tax for this line item"""
        from decimal import ROUND_HALF_UP
        
        if tax_method == 'percentage':
            if self.type == LineItemType.XACTIMATE:
                # Xactimate: only material price is taxable
                taxable_amount = Decimal(str(self.mat or 0))
            else:
                # Custom: entire price is taxable
                taxable_amount = Decimal(str(self.untaxed_unit_price or 0))
            
            tax = (taxable_amount * tax_rate / 100).quantize(
                Decimal('0.01'), 
                rounding=ROUND_HALF_UP
            )
            return tax
        elif tax_method == 'specific':
            return Decimal(str(tax_rate))
        
        return Decimal('0')
    
    def to_dict(self):
        """Convert model to dictionary"""
        return {
            'id': str(self.id),
            'type': self.type.value if self.type else None,
            'cat': self.cat,
            'item': self.item,
            'description': self.description,
            'includes': self.includes,
            'unit': self.unit,
            'untaxed_unit_price': float(self.untaxed_unit_price) if self.untaxed_unit_price else None,
            'lab': float(self.lab) if self.lab else None,
            'mat': float(self.mat) if self.mat else None,
            'equ': float(self.equ) if self.equ else None,
            'labor_burden': float(self.labor_burden) if self.labor_burden else None,
            'market_condition': float(self.market_condition) if self.market_condition else None,
            'is_active': self.is_active,
            'version': self.version,
            'company_id': str(self.company_id) if self.company_id else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    def __repr__(self):
        return f"<LineItem(id={self.id}, type={self.type}, description={self.description})>"


class LineItemNote(Base):
    """Notes that can be attached to line items"""
    __tablename__ = "line_item_notes"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)
    title = Column(String(200))
    content = Column(Text, nullable=False)
    category = Column(String(50))
    is_template = Column(Boolean, default=True)
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)
    created_by = Column(UUIDType(), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    line_items = relationship(
        "LineItem",
        secondary="line_item_note_mappings",
        back_populates="notes"
    )
    
    def __repr__(self):
        return f"<LineItemNote(id={self.id}, title={self.title})>"


class LineItemNoteMapping(Base):
    """Many-to-many mapping between line items and notes"""
    __tablename__ = "line_item_note_mappings"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUIDType(), primary_key=True, default=generate_uuid)
    line_item_id = Column(UUIDType(), ForeignKey("line_items.id", ondelete="CASCADE"), nullable=False)
    note_id = Column(UUIDType(), ForeignKey("line_item_notes.id", ondelete="CASCADE"), nullable=False)
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    def __repr__(self):
        return f"<LineItemNoteMapping(line_item_id={self.line_item_id}, note_id={self.note_id})>"


class LineItemTemplate(Base):
    """Templates containing collections of line items"""
    __tablename__ = "line_item_templates"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    category = Column(String(100))
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)
    created_by = Column(UUIDType(), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    template_items = relationship(
        "TemplateLineItem",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="TemplateLineItem.order_index"
    )
    
    def __repr__(self):
        return f"<LineItemTemplate(id={self.id}, name={self.name})>"


class TemplateLineItem(Base):
    """Line items within a template

    Supports two modes:
    1. Reference mode: line_item_id points to existing LineItem in library
    2. Embedded mode: embedded_data contains complete item information (no line_item_id)

    Embedded data structure:
    {
        "item_code": "RDG",           # Item name/code for identification
        "description": "Item name",    # Display name
        "includes": "Work details",    # Optional work description
        "unit": "EA",                  # Measurement unit
        "rate": 100.0,                 # Unit price
        "type": "CUSTOM"               # Optional: CUSTOM or XACTIMATE
    }
    """
    __tablename__ = "template_line_items"
    __table_args__ = {'extend_existing': True}

    id = Column(UUIDType(), primary_key=True, default=generate_uuid)
    template_id = Column(UUIDType(), ForeignKey("line_item_templates.id", ondelete="CASCADE"), nullable=False)

    # Reference-based: points to existing LineItem (nullable for embedded mode)
    line_item_id = Column(UUIDType(), ForeignKey("line_items.id", ondelete="CASCADE"), nullable=True)

    # Embedded mode: stores complete item data (nullable for reference mode)
    embedded_data = Column(JSON, nullable=True)

    quantity_multiplier = Column(DECIMAL(10, 2), default=1)
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    template = relationship("LineItemTemplate", back_populates="template_items")
    line_item = relationship("LineItem", back_populates="templates")

    # Note: Validation is handled by:
    # 1. Pydantic schema validation (TemplateLineItemBase.validate_item_reference)
    # 2. Database CHECK constraint (template_line_items_data_check)
    # SQLAlchemy @validates is removed to avoid premature validation during object construction

    def get_item_code(self) -> str:
        """Get item code from embedded data or related line_item"""
        if self.embedded_data:
            return self.embedded_data.get('item_code', 'UNKNOWN')
        elif self.line_item:
            return self.line_item.item or 'UNKNOWN'
        return 'UNKNOWN'

    def get_description(self) -> str:
        """Get description from embedded data or related line_item"""
        if self.embedded_data:
            return self.embedded_data.get('description', '')
        elif self.line_item:
            return self.line_item.description
        return ''

    def get_rate(self) -> Decimal:
        """Get rate from embedded data or related line_item"""
        if self.embedded_data:
            return Decimal(str(self.embedded_data.get('rate', 0)))
        elif self.line_item:
            return self.line_item.untaxed_unit_price or Decimal('0')
        return Decimal('0')

    def __repr__(self):
        if self.line_item_id:
            return f"<TemplateLineItem(template_id={self.template_id}, line_item_id={self.line_item_id})>"
        else:
            item_code = self.embedded_data.get('item_code', 'UNKNOWN') if self.embedded_data else 'UNKNOWN'
            return f"<TemplateLineItem(template_id={self.template_id}, embedded={item_code})>"


class LineItemAudit(Base):
    """Audit log for line item changes"""
    __tablename__ = "line_item_audits"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUIDType(), primary_key=True, default=generate_uuid)
    line_item_id = Column(UUIDType(), ForeignKey("line_items.id"), nullable=False)
    action = Column(String(20), nullable=False)  # CREATE, UPDATE, DELETE
    old_values = Column(JSON)
    new_values = Column(JSON)
    changed_by = Column(UUIDType())
    changed_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Calculation verification
    calculated_price = Column(DECIMAL(15, 2))
    stored_price = Column(DECIMAL(15, 2))
    price_match = Column(Boolean)
    
    def __repr__(self):
        return f"<LineItemAudit(id={self.id}, action={self.action}, line_item_id={self.line_item_id})>"


# Event listeners for automatic calculations
@event.listens_for(LineItem, 'before_insert')
@event.listens_for(LineItem, 'before_update')
def calculate_price_before_save(mapper, connection, target):
    """Automatically calculate untaxed_unit_price for Xactimate items"""
    if target.type == LineItemType.XACTIMATE:
        target.untaxed_unit_price = target.calculate_untaxed_unit_price()