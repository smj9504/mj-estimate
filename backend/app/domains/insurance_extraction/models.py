"""
Insurance PDF extraction domain models.
"""

from sqlalchemy import DECIMAL, Column, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class InsurancePdfExtraction(Base, BaseModel):
    __tablename__ = "insurance_pdf_extractions"
    __table_args__ = (
        Index("ix_insurance_pdf_extractions_file_id", "file_id"),
        Index("ix_insurance_pdf_extractions_status", "status"),
        {"extend_existing": True},
    )

    file_id = Column(String(255), ForeignKey("files.id", ondelete="CASCADE"), nullable=False)
    carrier = Column(String(100), nullable=True)
    status = Column(String(30), nullable=False, default="completed")
    pages = Column(Integer, nullable=False, default=0)
    raw_text_excerpt = Column(Text, nullable=True)
    raw_text = Column(Text, nullable=True)
    parser_metadata = Column(JSONB, nullable=False, default=dict)

    items = relationship(
        "InsurancePdfExtractionItem",
        back_populates="extraction",
        cascade="all, delete-orphan",
        order_by="InsurancePdfExtractionItem.sort_order",
    )


class InsurancePdfExtractionItem(Base, BaseModel):
    __tablename__ = "insurance_pdf_extraction_items"
    __table_args__ = (
        Index("ix_insurance_pdf_extraction_items_extraction_id", "extraction_id"),
        Index("ix_insurance_pdf_extraction_items_source_page", "source_page"),
        {"extend_existing": True},
    )

    extraction_id = Column(
        UUIDType(),
        ForeignKey("insurance_pdf_extractions.id", ondelete="CASCADE"),
        nullable=False,
    )
    room = Column(String(255), nullable=True)
    line_item = Column(Text, nullable=False)
    notes = Column(Text, nullable=True)
    unit_price = Column(DECIMAL(12, 2), nullable=True)
    quantity = Column(DECIMAL(12, 3), nullable=True)
    measurement = Column(String(100), nullable=True)
    unit = Column(String(30), nullable=True)
    source_page = Column(Integer, nullable=True)
    confidence = Column(DECIMAL(5, 2), nullable=True)
    raw_line = Column(Text, nullable=True)
    token_offsets = Column(JSONB, nullable=True)
    validation_flags = Column(JSONB, nullable=False, default=list)
    sort_order = Column(Integer, nullable=False, default=0)

    extraction = relationship("InsurancePdfExtraction", back_populates="items")
