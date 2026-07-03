"""
Repair Specification domain models.

Condition → Result mapping: every template line item must have a condition (cause).
"""

from sqlalchemy import (
    Boolean,
    Column,
    DECIMAL,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType, generate_uuid


class RepairCondition(BaseModel, Base):
    """Site condition that causes specific line items to be needed."""

    __tablename__ = "repair_conditions"
    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_repair_condition_company_name"),
        Index("idx_repair_conditions_company", "company_id"),
        {"extend_existing": True},
    )

    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)
    name = Column(String(255), nullable=False)
    category = Column(String(100), nullable=True)  # damage, work_type, material, etc.
    scope = Column(String(50), default="damaged")  # damaged | affected
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)


class RepairTemplate(BaseModel, Base):
    """Repair template grouping conditions and their resulting line items."""

    __tablename__ = "repair_templates"
    __table_args__ = (
        Index("idx_repair_templates_company", "company_id"),
        Index("idx_repair_templates_surface", "surface"),
        {"extend_existing": True},
    )

    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)
    name = Column(String(255), nullable=False)
    surface = Column(String(50), nullable=True)  # wall / floor / ceiling / general
    description = Column(Text, nullable=True)
    tags = Column(JSONB, default=list)
    is_active = Column(Boolean, default=True)
    usage_count = Column(Integer, default=0)
    created_by = Column(UUIDType(), ForeignKey("staff.id"), nullable=True)

    # Relationships
    template_conditions = relationship(
        "RepairTemplateCondition",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="RepairTemplateCondition.sort_order",
    )
    items = relationship(
        "RepairTemplateItem",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="RepairTemplateItem.sort_order",
    )
    suggestions = relationship(
        "RepairConditionSuggestion",
        back_populates="template",
        cascade="all, delete-orphan",
    )


class RepairTemplateCondition(Base):
    """M:N link between template and condition."""

    __tablename__ = "repair_template_conditions"
    __table_args__ = (
        UniqueConstraint("template_id", "condition_id", name="uq_tmpl_cond"),
        {"extend_existing": True},
    )

    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)
    template_id = Column(
        UUIDType(),
        ForeignKey("repair_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    condition_id = Column(
        UUIDType(),
        ForeignKey("repair_conditions.id", ondelete="CASCADE"),
        nullable=False,
    )
    sort_order = Column(Integer, default=0)

    template = relationship("RepairTemplate", back_populates="template_conditions")
    condition = relationship("RepairCondition", lazy="joined")


class RepairConditionSuggestion(Base):
    """Soft recommendation: when from_condition is checked, suggest to_condition."""

    __tablename__ = "repair_condition_suggestions"
    __table_args__ = (
        UniqueConstraint(
            "template_id",
            "from_condition_id",
            "to_condition_id",
            name="uq_cond_suggestion",
        ),
        {"extend_existing": True},
    )

    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)
    template_id = Column(
        UUIDType(),
        ForeignKey("repair_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_condition_id = Column(
        UUIDType(),
        ForeignKey("repair_conditions.id", ondelete="CASCADE"),
        nullable=False,
    )
    to_condition_id = Column(
        UUIDType(),
        ForeignKey("repair_conditions.id", ondelete="CASCADE"),
        nullable=False,
    )

    template = relationship("RepairTemplate", back_populates="suggestions")
    from_condition = relationship("RepairCondition", foreign_keys=[from_condition_id], lazy="joined")
    to_condition = relationship("RepairCondition", foreign_keys=[to_condition_id], lazy="joined")


class RepairTemplateItem(BaseModel, Base):
    """A line item required when a specific condition is met. Xactimate-only."""

    __tablename__ = "repair_template_items"
    __table_args__ = (
        Index("idx_repair_tmpl_items_template", "template_id"),
        Index("idx_repair_tmpl_items_condition", "condition_id"),
        {"extend_existing": True},
    )

    template_id = Column(
        UUIDType(),
        ForeignKey("repair_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    condition_id = Column(
        UUIDType(),
        ForeignKey("repair_conditions.id"),
        nullable=False,
    )
    xactimate_item_code = Column(String(50), nullable=False)
    description_override = Column(String(500), nullable=True)
    default_unit = Column(String(30), nullable=True)
    is_required = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)

    template = relationship("RepairTemplate", back_populates="items")
    condition = relationship("RepairCondition", lazy="joined")
