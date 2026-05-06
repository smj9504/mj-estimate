"""
Material Order domain models.
Stores material order lists for Roofing/Siding with line items.
"""

from sqlalchemy import (
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class MaterialOrder(Base, BaseModel):
    """Material order for a roofing or siding job."""

    __tablename__ = "material_orders"
    __table_args__ = (
        Index("ix_material_orders_status", "status"),
        {"extend_existing": True},
    )

    # Relationships
    claim_id = Column(
        UUIDType(),
        ForeignKey("claims.id", ondelete="SET NULL"),
        nullable=True,
    )
    company_id = Column(
        UUIDType(),
        ForeignKey("companies.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_id = Column(
        UUIDType(),
        ForeignKey("staff.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Job info
    scope_type = Column(String(20), nullable=False, default="roofing")  # roofing / siding
    property_address = Column(String(500), nullable=True)
    report_number = Column(String(100), nullable=True)
    delivery_date = Column(String(20), nullable=True)
    brand = Column(String(100), nullable=True, default="CertainTeed")
    product = Column(String(200), nullable=True)
    color = Column(String(100), nullable=True)
    waste_pct = Column(Float, default=12.0)
    status = Column(String(20), default="draft")  # draft / ordered / completed

    # Measurements (JSONB)
    measurements = Column(JSONB, nullable=True)

    # Notes
    notes = Column(JSONB, nullable=True)  # list of strings

    # Totals (cached)
    total_material_cost = Column(Float, default=0)
    item_count = Column(Integer, default=0)

    # Line items relationship
    items = relationship(
        "MaterialOrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="MaterialOrderItem.display_order",
    )


class MaterialOrderItem(Base, BaseModel):
    """Individual material line item in an order."""

    __tablename__ = "material_order_items"
    __table_args__ = (
        Index("ix_material_order_items_order_id", "order_id"),
        {"extend_existing": True},
    )

    order_id = Column(
        UUIDType(),
        ForeignKey("material_orders.id", ondelete="CASCADE"),
        nullable=False,
    )

    category = Column(String(50), default="misc")  # main/underlayment/trim/fastener/misc
    item = Column(String(500), nullable=False, default="")
    qty = Column(Float, default=0)
    unit = Column(String(10), default="EA")  # BD, RL, PC, BX, EA, TB, CTN
    formula = Column(String(300), nullable=True)
    note = Column(Text, nullable=True)
    unit_price = Column(Float, nullable=True)
    ai_qty = Column(Float, nullable=True)  # original calculated qty
    display_order = Column(Integer, default=0)

    # Relationship back to order
    order = relationship("MaterialOrder", back_populates="items")
