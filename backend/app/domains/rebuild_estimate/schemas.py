"""What a rebuild estimate takes and gives."""

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .assemble import ADDED_SECTIONS, BASES
from .sources import KINDS


class Measures(BaseModel):
    model_config = ConfigDict(extra="forbid")
    floor_sf: Optional[float] = Field(None, ge=0)
    ceiling_sf: Optional[float] = Field(None, ge=0)
    wall_sf: Optional[float] = Field(None, ge=0)
    perimeter_lf: Optional[float] = Field(None, ge=0)
    height_ft: Optional[float] = Field(None, ge=0)


class Room(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=200)
    level_name: Optional[str] = Field(None, max_length=100)
    measures: Measures = Measures()


class Activity(BaseModel):
    """An Xactimate activity the line can be, at the price list price"""
    model_config = ConfigDict(extra="ignore")
    activity: Literal["&", "+", "-", "R", "M", "I"]
    label: Optional[str] = None
    price: float = Field(..., ge=0)
    material_share: float = Field(0.0, ge=0, le=1)


class Line(BaseModel):
    """A repair added on the rebuild estimate"""
    model_config = ConfigDict(extra="forbid")
    id: str = Field(..., min_length=1, max_length=64)
    room_id: Optional[str] = Field(None, max_length=64)       # none: the General section
    section: Literal[ADDED_SECTIONS] = "other"  # type: ignore[valid-type]
    description: str = Field(..., min_length=1, max_length=500)
    unit: str = Field("EA", min_length=1, max_length=10)
    quantity: Optional[float] = Field(None, ge=0)               # none: the room's measure (basis)
    basis: Optional[str] = None
    unit_price: Optional[float] = Field(None, ge=0)             # typed: used as it is
    # From the Xactimate price list, when it is one of its lines
    code: Optional[str] = Field(None, max_length=50)
    activity: Optional[Literal["&", "+", "-", "R", "M", "I"]] = None
    price_list: Optional[str] = Field(None, max_length=30)
    activities: List[Activity] = []
    notes: Optional[str] = Field(None, max_length=500)

    @field_validator("basis")
    @classmethod
    def check_basis(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in BASES:
            raise ValueError(f"Unknown measure: {value}")
        return value

    @model_validator(mode="after")
    def check_activity(self) -> "Line":
        if self.activity and not any(a.activity == self.activity for a in self.activities):
            raise ValueError(f'"{self.description}": no price for that activity')
        return self


class RebuildEstimateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim_id: Optional[str] = None
    company_id: Optional[str] = None
    status: Optional[Literal["draft", "final"]] = None
    property_address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=5)
    zip_code: Optional[str] = Field(None, max_length=10)
    include_overhead_profit: Optional[bool] = None
    overhead_pct: Optional[float] = Field(None, ge=0, le=1)
    profit_pct: Optional[float] = Field(None, ge=0, le=1)
    notes: Optional[str] = None
    rooms: Optional[List[Room]] = None
    lines: Optional[List[Line]] = None

    @model_validator(mode="after")
    def check_ids(self) -> "RebuildEstimateUpdate":
        if self.rooms is not None and len({r.id for r in self.rooms}) != len(self.rooms):
            raise ValueError("Two rooms have the same id")
        if self.lines is not None and len({li.id for li in self.lines}) != len(self.lines):
            raise ValueError("Two lines have the same id")
        return self


class RebuildEstimateCreate(RebuildEstimateUpdate):
    pass


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal[KINDS]  # type: ignore[valid-type]
    estimate_id: str = Field(..., min_length=1, max_length=64)


class SourceRoomRequest(BaseModel):
    """Put a one-room estimate (a bathroom, the kitchen) in another room, or in a new one"""
    model_config = ConfigDict(extra="forbid")
    room_id: Optional[str] = Field(None, max_length=64)
    new_room_name: Optional[str] = Field(None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def one_of(self) -> "SourceRoomRequest":
        if bool(self.room_id) == bool(self.new_room_name):
            raise ValueError("Give a room, or a name for a new one")
        return self

