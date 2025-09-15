"""
Line Item Category models
"""

from sqlalchemy import Column, String, Integer, Boolean, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database_factory import Base


class LineItemCategory(Base):
    """Category master table for line items"""
    __tablename__ = "line_item_categories"
    
    code = Column(String(50), primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    parent_code = Column(String(50), ForeignKey("line_item_categories.code"))
    display_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Self-referential relationship for hierarchical categories
    parent = relationship("LineItemCategory", remote_side=[code], backref="subcategories")
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            'code': self.code,
            'name': self.name,
            'description': self.description,
            'parent_code': self.parent_code,
            'display_order': self.display_order,
            'is_active': self.is_active
        }
    
    def __repr__(self):
        return f"<LineItemCategory(code={self.code}, name={self.name})>"