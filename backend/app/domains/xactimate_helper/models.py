"""
Xactimate Helper Tool - Database Models

6 tables with xact_ prefix:
- xact_line_items: Line Item master with embeddings
- xact_assemblies: Assembly templates
- xact_assembly_items: Assembly ↔ Line Item mapping
- xact_rooms: User project rooms
- xact_correction_feedback: User correction feedback
- xact_item_descriptions: Justification description library
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    ARRAY,
    DECIMAL,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database_factory import Base

# Try to import pgvector; fallback gracefully if unavailable
try:
    from pgvector.sqlalchemy import Vector

    PGVECTOR_AVAILABLE = True
except ImportError:
    PGVECTOR_AVAILABLE = False
    Vector = None


def _uuid_default():
    return uuid.uuid4()


class XactLineItem(Base):
    """Line Item master table with vector embeddings for AI search."""

    __tablename__ = "xact_line_items"
    __table_args__ = (
        Index("idx_xact_line_items_code", "item_code", unique=True),
        Index("idx_xact_line_items_category", "category"),
        Index("idx_xact_line_items_active", "is_active"),
        {"extend_existing": True},
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=_uuid_default)
    item_code = Column(Text, nullable=False, unique=True)
    category = Column(Text, nullable=False)
    description = Column(Text)
    unit = Column(Text)  # EA / LF / SF / HR
    unit_price = Column(DECIMAL(10, 2), default=0.0)
    definition = Column(JSONB)  # includes, excludes, note, etc.
    is_active = Column(Boolean, default=True)

    # Vector embedding for similarity search (1536 dim for text-embedding-3-small)
    # Stored as JSONB fallback when pgvector is not available
    if PGVECTOR_AVAILABLE:
        embedding = Column(Vector(1536))
    else:
        embedding = Column(JSONB)  # Store as JSON array fallback

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    assembly_items = relationship(
        "XactAssemblyItem",
        back_populates="line_item",
        foreign_keys="XactAssemblyItem.item_code",
        primaryjoin="XactLineItem.item_code == foreign(XactAssemblyItem.item_code)",
    )
    descriptions = relationship(
        "XactItemDescription",
        back_populates="line_item",
        foreign_keys="XactItemDescription.item_code",
        primaryjoin="XactLineItem.item_code == foreign(XactItemDescription.item_code)",
    )

    def to_dict(self, include_embedding: bool = False) -> Dict[str, Any]:
        result = {
            "id": str(self.id),
            "item_code": self.item_code,
            "category": self.category,
            "description": self.description,
            "unit": self.unit,
            "unit_price": float(self.unit_price) if self.unit_price else 0.0,
            "definition": self.definition,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_embedding and self.embedding is not None:
            result["embedding"] = (
                list(self.embedding)
                if not isinstance(self.embedding, list)
                else self.embedding
            )
        return result

    def __repr__(self):
        return f"<XactLineItem(code={self.item_code}, desc={self.description[:40] if self.description else ''})>"


class XactAssembly(Base):
    """Assembly template — a group of line items for a specific work scenario."""

    __tablename__ = "xact_assemblies"
    __table_args__ = (
        Index("idx_xact_assemblies_damage", "damage_type"),
        Index("idx_xact_assemblies_room", "room_type"),
        {"extend_existing": True},
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=_uuid_default)
    name = Column(Text, nullable=False)
    damage_type = Column(Text)  # water / fire / mold / general
    room_type = Column(Text)  # living_room / bedroom / kitchen / any
    trigger_keywords = Column(ARRAY(Text))  # e.g. ['baseboard', 'water', 'LF']
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    items = relationship(
        "XactAssemblyItem",
        back_populates="assembly",
        cascade="all, delete-orphan",
        order_by="XactAssemblyItem.sort_order",
    )

    def to_dict(self, include_items: bool = False) -> Dict[str, Any]:
        result = {
            "id": str(self.id),
            "name": self.name,
            "damage_type": self.damage_type,
            "room_type": self.room_type,
            "trigger_keywords": self.trigger_keywords or [],
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_items and self.items:
            result["items"] = [item.to_dict() for item in self.items]
        return result

    def __repr__(self):
        return f"<XactAssembly(name={self.name}, damage={self.damage_type})>"


class XactAssemblyItem(Base):
    """Assembly ↔ Line Item mapping with conditional inclusion logic."""

    __tablename__ = "xact_assembly_items"
    __table_args__ = (
        Index("idx_xact_assembly_items_assembly", "assembly_id"),
        Index("idx_xact_assembly_items_code", "item_code"),
        {"extend_existing": True},
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=_uuid_default)
    assembly_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("xact_assemblies.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_code = Column(Text, ForeignKey("xact_line_items.item_code"), nullable=False)
    condition = Column(Text)  # paint / stain / null
    qty_formula = Column(Text)  # e.g. 'LF * 1', 'SF * 0.1', '1'
    is_required = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)

    # Relationships
    assembly = relationship("XactAssembly", back_populates="items")
    line_item = relationship(
        "XactLineItem",
        back_populates="assembly_items",
        foreign_keys=[item_code],
        primaryjoin="XactAssemblyItem.item_code == XactLineItem.item_code",
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": str(self.id),
            "assembly_id": str(self.assembly_id),
            "item_code": self.item_code,
            "condition": self.condition,
            "qty_formula": self.qty_formula,
            "is_required": self.is_required,
            "sort_order": self.sort_order,
        }

    def __repr__(self):
        return f"<XactAssemblyItem(assembly={self.assembly_id}, code={self.item_code})>"


class XactRoom(Base):
    """User project room — the unit for AI analysis and line item management."""

    __tablename__ = "xact_rooms"
    __table_args__ = (
        Index("idx_xact_rooms_project", "project_id"),
        Index("idx_xact_rooms_user", "user_id"),
        Index("idx_xact_rooms_status", "status"),
        {"extend_existing": True},
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=_uuid_default)
    project_id = Column(PG_UUID(as_uuid=True), nullable=True)
    user_id = Column(PG_UUID(as_uuid=True), nullable=True)
    name = Column(Text, nullable=False)
    room_type = Column(Text)  # living_room / bedroom / kitchen / bathroom / other
    dimensions = Column(JSONB)  # { "LF": 18, "SF": 220, "height": 9 }
    damage_type = Column(Text)  # water / fire / mold / general
    condition_flags = Column(JSONB)  # { "paint": true, "stain": false, "after_hours": false }
    selected_assemblies = Column(JSONB)  # Confirmed assembly list
    final_line_items = Column(JSONB)  # Final confirmed line item list
    status = Column(Text, default="draft")  # draft / confirmed / exported
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    corrections = relationship(
        "XactCorrectionFeedback",
        back_populates="room",
        cascade="all, delete-orphan",
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": str(self.id),
            "project_id": str(self.project_id) if self.project_id else None,
            "user_id": str(self.user_id) if self.user_id else None,
            "name": self.name,
            "room_type": self.room_type,
            "dimensions": self.dimensions or {},
            "damage_type": self.damage_type,
            "condition_flags": self.condition_flags or {},
            "selected_assemblies": self.selected_assemblies or [],
            "final_line_items": self.final_line_items or [],
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<XactRoom(name={self.name}, type={self.room_type}, status={self.status})>"


class XactCorrectionFeedback(Base):
    """User correction feedback for AI recommendation improvement."""

    __tablename__ = "xact_correction_feedback"
    __table_args__ = (
        Index("idx_xact_correction_user", "user_id"),
        Index("idx_xact_correction_room", "room_id"),
        Index("idx_xact_correction_damage", "damage_type"),
        Index("idx_xact_correction_confidence", "confidence_score"),
        {"extend_existing": True},
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=_uuid_default)
    user_id = Column(PG_UUID(as_uuid=True), nullable=True)
    room_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("xact_rooms.id", ondelete="SET NULL"),
        nullable=True,
    )
    situation_summary = Column(Text)  # e.g. "Living room baseboard flood, LF=18, Paint"
    # Vector embedding for similar situation search
    if PGVECTOR_AVAILABLE:
        situation_embedding = Column(Vector(1536))
    else:
        situation_embedding = Column(JSONB)

    damage_type = Column(Text)
    room_type = Column(Text)
    ai_suggested = Column(JSONB)  # AI original recommendation
    user_corrected = Column(JSONB)  # User's confirmed version
    correction_type = Column(ARRAY(Text))  # ['add', 'remove', 'swap', 'qty_change']
    confidence_score = Column(Integer, default=1)
    is_applied_to_rule = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    room = relationship("XactRoom", back_populates="corrections")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": str(self.id),
            "user_id": str(self.user_id) if self.user_id else None,
            "room_id": str(self.room_id) if self.room_id else None,
            "situation_summary": self.situation_summary,
            "damage_type": self.damage_type,
            "room_type": self.room_type,
            "ai_suggested": self.ai_suggested,
            "user_corrected": self.user_corrected,
            "correction_type": self.correction_type or [],
            "confidence_score": self.confidence_score,
            "is_applied_to_rule": self.is_applied_to_rule,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<XactCorrectionFeedback(id={self.id}, confidence={self.confidence_score})>"


class XactItemDescription(Base):
    """Justification description library for insurance claim submissions."""

    __tablename__ = "xact_item_descriptions"
    __table_args__ = (
        Index("idx_xact_desc_item_code", "item_code"),
        Index("idx_xact_desc_type", "description_type"),
        Index("idx_xact_desc_approved", "approved"),
        {"extend_existing": True},
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=_uuid_default)
    item_code = Column(Text, ForeignKey("xact_line_items.item_code"), nullable=False)
    description_type = Column(Text, nullable=False)  # waste / building_code / secondary_damage / scope_of_work / industry_standard
    trigger_condition = Column(JSONB)  # Conditions for suggesting this description
    title = Column(Text, nullable=False)
    body = Column(Text, nullable=False)  # The actual text to copy
    variables = Column(JSONB)  # Dynamic substitution variables e.g. {{LF}}, {{room_name}}
    source_reference = Column(Text)  # e.g. "IRC Section E3401.1", "IICRC S520"
    is_ai_generated = Column(Boolean, default=False)
    approved = Column(Boolean, default=False)
    usage_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    line_item = relationship(
        "XactLineItem",
        back_populates="descriptions",
        foreign_keys=[item_code],
        primaryjoin="XactItemDescription.item_code == XactLineItem.item_code",
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": str(self.id),
            "item_code": self.item_code,
            "description_type": self.description_type,
            "trigger_condition": self.trigger_condition,
            "title": self.title,
            "body": self.body,
            "variables": self.variables,
            "source_reference": self.source_reference,
            "is_ai_generated": self.is_ai_generated,
            "approved": self.approved,
            "usage_count": self.usage_count,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<XactItemDescription(item={self.item_code}, type={self.description_type})>"
