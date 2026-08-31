"""
Cabinet Estimate Sketch Pydantic schemas.
"""

from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class CabinetSketchWall(BaseModel):
    id: str
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    thickness: float = 4
    color: str = "#333333"
    length_ft: float = 0


class CabinetSketchCabinet(BaseModel):
    id: str
    preset_code: str          # "B30", "SB36", "CUSTOM", etc. — matches CABINET_PRESETS keys
    cab_type: str              # base / wall / tall / specialty — color-coding only, not pricing
    x: float
    y: float
    width: float               # canvas pixels
    height: float              # canvas pixels
    rotation: float = 0
    label: str = ""


class CabinetSketchOverlayData(BaseModel):
    walls: List[CabinetSketchWall] = Field(default_factory=list)
    cabinets: List[CabinetSketchCabinet] = Field(default_factory=list)
    element_order: List[str] = Field(default_factory=list)


class CabinetSketchResponse(BaseModel):
    id: UUID
    estimate_id: UUID
    canvas_width: int
    canvas_height: int
    scale_pixels_per_foot: float
    overlay_data: CabinetSketchOverlayData

    class Config:
        from_attributes = True


class CabinetSketchUpdate(BaseModel):
    canvas_width: Optional[int] = None
    canvas_height: Optional[int] = None
    scale_pixels_per_foot: Optional[float] = None
