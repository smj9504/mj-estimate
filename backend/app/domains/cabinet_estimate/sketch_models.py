"""
Cabinet Estimate Sketch domain model.

One optional canvas per cabinet estimate, for visualizing cabinet layout
alongside the count-based CabinetBox rows used for pricing. Unlike the
water mitigation sketch (one-to-many floors, several child tables), this
is one-to-one with the estimate and has no child tables at all — walls
and placed cabinets live only in the overlay_data JSONB column, mirroring
the JSONB-only precedent already used for WM's shapes/walls/rooms.
"""

from sqlalchemy import Column, Float, ForeignKey, Index, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class CabinetSketch(Base, BaseModel):
    """
    Cabinet Estimate Sketch.

    One canvas per estimate. overlay_data holds
    { "walls": [...], "cabinets": [...] } — see sketch_schemas.py for shape.
    """

    __tablename__ = "cabinet_sketches"
    __table_args__ = (
        Index("ix_cabinet_sketches_estimate_id", "estimate_id", unique=True),
        {"extend_existing": True},
    )

    estimate_id = Column(
        UUIDType(),
        ForeignKey("cabinet_estimates.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Canvas configuration
    canvas_width = Column(Integer, default=1200, nullable=False)
    canvas_height = Column(Integer, default=900, nullable=False)
    scale_pixels_per_foot = Column(Float, default=20.0, nullable=False)

    # { "walls": [CabinetSketchWall...], "cabinets": [CabinetSketchCabinet...] }
    overlay_data = Column(JSONB, default=dict, nullable=False)

    # Relationships
    estimate = relationship("CabinetEstimate", back_populates="sketch")
