"""
Rebuild estimate: one estimate for a claim's whole rebuild.

The flooring, bathroom and kitchen cabinet estimates are imported into it
line by line, and the repairs none of them covers (drywall, insulation,
paint on the walls and ceilings...) are added on, room by room (owner,
2026-11-13). Everything is kept in JSON on the estimate:

  rooms    [{id, name, level_name, measures: {floor_sf, ceiling_sf,
            wall_sf, perimeter_lf, height_ft}}]
  sources  [{id, kind, estimate_id, label, lines: [...], room_map, ...}]
           each imported estimate as it was when imported (sources.py)
  lines    [{id, room_id, section, description, quantity, basis, ...}]
           the repairs added here (assemble.py)
  sketch_data  its own sketch, drawn with the flooring estimate's editor;
           each room drawn is a room above (sketch_rooms.py)
"""

from sqlalchemy import Boolean, Column, Float, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class RebuildEstimate(Base, BaseModel):
    __tablename__ = "rebuild_estimates"
    __table_args__ = (
        Index("ix_rebuild_estimates_claim_id", "claim_id"),
        Index("ix_rebuild_estimates_company_id", "company_id"),
        {"extend_existing": True},
    )

    claim_id = Column(UUIDType(), ForeignKey("claims.id", ondelete="SET NULL"), nullable=True)
    company_id = Column(UUIDType(), ForeignKey("companies.id", ondelete="SET NULL"), nullable=True)
    created_by_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"), nullable=True)
    # draft / final
    status = Column(String(50), default="draft", nullable=False)

    property_address = Column(String(500))
    city = Column(String(100))
    state = Column(String(5))
    zip_code = Column(String(10))

    rooms = Column(JSONB, nullable=True)
    sources = Column(JSONB, nullable=True)
    lines = Column(JSONB, nullable=True)
    sketch_data = Column(JSONB, nullable=True)

    # O&P on the repairs added here, folded into their unit prices. An
    # imported estimate's lines keep the O&P they were priced with.
    include_overhead_profit = Column(Boolean, default=False)
    overhead_pct = Column(Float, default=0.10)
    profit_pct = Column(Float, default=0.10)

    # As last saved: every line, imported and added
    total = Column(Float, default=0)
    notes = Column(Text, nullable=True)

    claim_ref = relationship("Claim", lazy="select")


class RebuildWording(Base, BaseModel):
    """A company's own words for a price list line, by its code and the
    activity it is added as (wording.py). No company: everyone's."""
    __tablename__ = "rebuild_wordings"
    __table_args__ = (
        Index("ix_rebuild_wordings_code", "item_code", "activity"),
        {"extend_existing": True},
    )

    company_id = Column(UUIDType(), ForeignKey("companies.id", ondelete="CASCADE"), nullable=True)
    item_code = Column(String(50), nullable=False)
    activity = Column(String(2), nullable=False)
    text = Column(String(500), nullable=False)
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"), nullable=True)
