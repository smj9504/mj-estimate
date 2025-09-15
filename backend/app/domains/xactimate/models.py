"""
Xactimate domain models
"""

from sqlalchemy import (
    Column, String, Integer, DateTime, Text, 
    ForeignKey, DECIMAL, Boolean, Index
)
from sqlalchemy.orm import relationship, validates
from sqlalchemy.sql import func
from decimal import Decimal
from datetime import datetime
from typing import Optional, List, Dict, Any

from app.core.database_factory import Base


class XactimateCategory(Base):
    """Xactimate category model"""
    __tablename__ = "xactimate_categories"
    __table_args__ = {'extend_existing': True}
    
    category_code = Column(String(3), primary_key=True)
    category_name = Column(String(100), nullable=False)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    items = relationship(
        "XactimateItem",
        back_populates="category",
        cascade="all, delete-orphan"
    )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert model to dictionary"""
        return {
            'category_code': self.category_code,
            'category_name': self.category_name,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
    
    def __repr__(self):
        return f"<XactimateCategory(code={self.category_code}, name={self.category_name})>"


class XactimateItem(Base):
    """Xactimate item model with time-based pricing"""
    __tablename__ = "xactimate_items"
    __table_args__ = (
        Index('idx_xactimate_items_category', 'category_code'),
        Index('idx_xactimate_items_code', 'item_code'),
        Index('idx_xactimate_items_date', 'price_year', 'price_month'),
        Index('idx_xactimate_items_search', 'description'),
        {'extend_existing': True}
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    item_code = Column(String(50), nullable=False)
    category_code = Column(String(3), ForeignKey("xactimate_categories.category_code"), nullable=False)
    description = Column(Text, nullable=False)
    
    # Date fields (month/year only)
    price_year = Column(Integer, nullable=False)
    price_month = Column(Integer, nullable=False)
    
    # Cost fields
    labor_cost = Column(DECIMAL(10, 2), default=0)
    material_cost = Column(DECIMAL(10, 2), default=0)
    equipment_cost = Column(DECIMAL(10, 2), default=0)
    labor_burden = Column(DECIMAL(10, 2), default=0)
    market_conditions = Column(DECIMAL(10, 2), default=0)
    untaxed_unit_price = Column(DECIMAL(10, 2), nullable=False, default=0)
    
    # Life expectancy fields
    life_expectancy_years = Column(Integer)
    depreciation_rate = Column(DECIMAL(5, 2))
    max_depreciation = Column(DECIMAL(5, 2))
    
    # Description fields
    includes_description = Column(Text)
    excludes_description = Column(Text)
    note_description = Column(Text)
    quality_description = Column(Text)
    reference_description = Column(Text)
    has_life_expectancy_data = Column(Boolean, default=False)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    category = relationship("XactimateCategory", back_populates="items")
    components = relationship(
        "XactimateComponent",
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="XactimateComponent.component_type"
    )
    
    @validates('price_month')
    def validate_month(self, key, value):
        """Validate month is between 1-12"""
        if value is not None and (value < 1 or value > 12):
            raise ValueError("Month must be between 1 and 12")
        return value
    
    @validates('price_year')
    def validate_year(self, key, value):
        """Validate year is reasonable"""
        if value is not None and (value < 2020 or value > 2100):
            raise ValueError("Year must be between 2020 and 2100")
        return value
    
    @validates('labor_cost', 'material_cost', 'equipment_cost', 'labor_burden', 'market_conditions')
    def validate_costs(self, key, value):
        """Validate cost fields are non-negative"""
        if value is not None and value < 0:
            raise ValueError(f"{key} cannot be negative")
        return value
    
    def calculate_total_price(self) -> Decimal:
        """Calculate total price from components"""
        return sum(filter(None, [
            Decimal(str(self.labor_cost or 0)),
            Decimal(str(self.material_cost or 0)),
            Decimal(str(self.equipment_cost or 0)),
            Decimal(str(self.labor_burden or 0)),
            Decimal(str(self.market_conditions or 0))
        ]))
    
    def get_taxable_amount(self) -> Decimal:
        """Get taxable amount (typically material cost only for Xactimate)"""
        return Decimal(str(self.material_cost or 0))
    
    def to_dict(self, include_components: bool = False) -> Dict[str, Any]:
        """Convert model to dictionary"""
        result = {
            'id': self.id,
            'item_code': self.item_code,
            'category_code': self.category_code,
            'description': self.description,
            'price_year': self.price_year,
            'price_month': self.price_month,
            'labor_cost': float(self.labor_cost) if self.labor_cost else None,
            'material_cost': float(self.material_cost) if self.material_cost else None,
            'equipment_cost': float(self.equipment_cost) if self.equipment_cost else None,
            'labor_burden': float(self.labor_burden) if self.labor_burden else None,
            'market_conditions': float(self.market_conditions) if self.market_conditions else None,
            'untaxed_unit_price': float(self.untaxed_unit_price) if self.untaxed_unit_price else None,
            'life_expectancy_years': self.life_expectancy_years,
            'depreciation_rate': float(self.depreciation_rate) if self.depreciation_rate else None,
            'max_depreciation': float(self.max_depreciation) if self.max_depreciation else None,
            'includes_description': self.includes_description,
            'excludes_description': self.excludes_description,
            'note_description': self.note_description,
            'quality_description': self.quality_description,
            'reference_description': self.reference_description,
            'has_life_expectancy_data': self.has_life_expectancy_data,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
        
        if include_components and self.components:
            result['components'] = [comp.to_dict() for comp in self.components]
        
        return result
    
    def __repr__(self):
        return f"<XactimateItem(id={self.id}, code={self.item_code}, description={self.description[:50]})>"


class XactimateComponent(Base):
    """Xactimate item component model"""
    __tablename__ = "xactimate_components"
    __table_args__ = (
        Index('idx_xactimate_components_item', 'item_id'),
        Index('idx_xactimate_components_type', 'component_type'),
        {'extend_existing': True}
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    item_id = Column(Integer, ForeignKey("xactimate_items.id", ondelete="CASCADE"), nullable=False)
    component_type = Column(String(10), nullable=False)  # 'lab', 'mat', 'equ', 'burden', 'market'
    component_code = Column(String(50))
    cost = Column(DECIMAL(10, 3), default=0)
    direct_yield = Column(DECIMAL(10, 3), default=0)
    yield_unit = Column(String(20))
    spt_event_percent = Column(DECIMAL(5, 3), default=0)
    yield_value = Column(DECIMAL(10, 3), default=0)
    unit_price = Column(DECIMAL(10, 2), default=0)
    
    # Relationships
    item = relationship("XactimateItem", back_populates="components")
    
    @validates('component_type')
    def validate_component_type(self, key, value):
        """Validate component type"""
        valid_types = ['lab', 'mat', 'equ', 'burden', 'market']
        if value not in valid_types:
            raise ValueError(f"Component type must be one of {valid_types}")
        return value
    
    @validates('cost', 'direct_yield', 'spt_event_percent', 'yield_value', 'unit_price')
    def validate_numeric_fields(self, key, value):
        """Validate numeric fields are non-negative"""
        if value is not None and value < 0:
            raise ValueError(f"{key} cannot be negative")
        return value
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert model to dictionary"""
        return {
            'id': self.id,
            'item_id': self.item_id,
            'component_type': self.component_type,
            'component_code': self.component_code,
            'cost': float(self.cost) if self.cost else None,
            'direct_yield': float(self.direct_yield) if self.direct_yield else None,
            'yield_unit': self.yield_unit,
            'spt_event_percent': float(self.spt_event_percent) if self.spt_event_percent else None,
            'yield_value': float(self.yield_value) if self.yield_value else None,
            'unit_price': float(self.unit_price) if self.unit_price else None
        }
    
    def __repr__(self):
        return f"<XactimateComponent(id={self.id}, type={self.component_type}, code={self.component_code})>"