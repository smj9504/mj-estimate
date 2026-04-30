"""
Xactimate Cheat Sheet - Database Models

4 tables with xact_cs_ prefix:
- xact_cs_sections: Top-level sections (e.g. Carpet, Drywall, Bathroom)
- xact_cs_rules: Rule boxes within sections
- xact_cs_tables: Table definitions within sections
- xact_cs_rows: Table row data with optional user notes
"""

import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database_factory import Base


def _uuid():
    return uuid.uuid4()


class CheatsheetSection(Base):
    """Top-level section in the cheat sheet."""

    __tablename__ = "xact_cs_sections"
    __table_args__ = (
        Index("idx_cs_sections_sort", "sort_order"),
        {"extend_existing": True},
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=_uuid)
    section_key = Column(Text, nullable=False, unique=True)  # e.g. 'carpet', 'lvp'
    title = Column(Text, nullable=False)
    tag = Column(Text, nullable=False)  # e.g. 'FCC', 'DRY'
    tag_color = Column(Text, nullable=False, default="#1a1a1a")
    nav_group = Column(Text, nullable=False)  # e.g. 'Flooring', 'Structure'
    nav_dot_color = Column(Text, nullable=False, default="#4f8ef7")
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    rules = relationship(
        "CheatsheetRule",
        back_populates="section",
        cascade="all, delete-orphan",
        order_by="CheatsheetRule.sort_order",
    )
    tables = relationship(
        "CheatsheetTable",
        back_populates="section",
        cascade="all, delete-orphan",
        order_by="CheatsheetTable.sort_order",
    )

    def to_dict(self, include_children=False):
        d = {
            "id": str(self.id),
            "section_key": self.section_key,
            "title": self.title,
            "tag": self.tag,
            "tag_color": self.tag_color,
            "nav_group": self.nav_group,
            "nav_dot_color": self.nav_dot_color,
            "sort_order": self.sort_order,
            "is_active": self.is_active,
        }
        if include_children:
            d["rules"] = [r.to_dict() for r in self.rules]
            d["tables"] = [t.to_dict(include_rows=True) for t in self.tables]
        return d


class CheatsheetRule(Base):
    """Rule box within a section (info/warning/success/purple cards)."""

    __tablename__ = "xact_cs_rules"
    __table_args__ = (
        Index("idx_cs_rules_section", "section_id"),
        {"extend_existing": True},
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=_uuid)
    section_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("xact_cs_sections.id", ondelete="CASCADE"),
        nullable=False,
    )
    rule_type = Column(Text, nullable=False, default="info")  # info|warning|success|purple
    title = Column(Text, nullable=False)
    items = Column(JSONB, nullable=False, default=[])  # string array
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    section = relationship("CheatsheetSection", back_populates="rules")

    def to_dict(self):
        return {
            "id": str(self.id),
            "section_id": str(self.section_id),
            "rule_type": self.rule_type,
            "title": self.title,
            "items": self.items or [],
            "sort_order": self.sort_order,
        }


class CheatsheetTable(Base):
    """Table definition within a section (column config)."""

    __tablename__ = "xact_cs_tables"
    __table_args__ = (
        Index("idx_cs_tables_section", "section_id"),
        {"extend_existing": True},
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=_uuid)
    section_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("xact_cs_sections.id", ondelete="CASCADE"),
        nullable=False,
    )
    columns = Column(JSONB, nullable=False)  # [{title, dataIndex, key, render?}]
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    section = relationship("CheatsheetSection", back_populates="tables")
    rows = relationship(
        "CheatsheetRow",
        back_populates="table",
        cascade="all, delete-orphan",
        order_by="CheatsheetRow.sort_order",
    )

    def to_dict(self, include_rows=False):
        d = {
            "id": str(self.id),
            "section_id": str(self.section_id),
            "columns": self.columns,
            "sort_order": self.sort_order,
        }
        if include_rows:
            d["rows"] = [r.to_dict() for r in self.rows]
        return d


class CheatsheetRow(Base):
    """Single table row with data and optional user note."""

    __tablename__ = "xact_cs_rows"
    __table_args__ = (
        Index("idx_cs_rows_table", "table_id"),
        Index("idx_cs_rows_key", "row_key"),
        {"extend_existing": True},
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=_uuid)
    table_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("xact_cs_tables.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_key = Column(Text, nullable=False)  # e.g. 'c1', 'l4', 'w6'
    data = Column(JSONB, nullable=False)  # {situation: '', item: '', unit: '', ...}
    note = Column(Text, nullable=True)  # user note
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    table = relationship("CheatsheetTable", back_populates="rows")

    def to_dict(self):
        return {
            "id": str(self.id),
            "table_id": str(self.table_id),
            "row_key": self.row_key,
            "data": self.data or {},
            "note": self.note,
            "sort_order": self.sort_order,
        }
