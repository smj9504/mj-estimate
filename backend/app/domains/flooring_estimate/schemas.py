"""
Flooring estimate Pydantic schemas
"""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domains.unit_prices.schemas import PriceBookSummary

from . import pricing
from .geometry import FIXTURE_TYPES, OPENING_KINDS
from .items import GENERAL_KEYS, ROOM_ITEM_MAP, ROOM_KEYS


Work = Literal["replace", "refinish"]


def _finish(value: Optional[str]) -> Optional[str]:
    if value is not None and value not in pricing.REFINISH_FINISHES:
        raise ValueError(f"Unknown finish {value!r}; one of {', '.join(pricing.REFINISH_FINISHES)}")
    return value


def _material(value: Optional[str]) -> Optional[str]:
    if value is not None and value not in pricing.MATERIALS:
        raise ValueError(f"Unknown floor {value!r}; one of {', '.join(pricing.MATERIALS)}")
    return value


def _pattern(value: Optional[str]) -> Optional[str]:
    if value is not None and value not in pricing.PATTERNS:
        raise ValueError(f"Unknown pattern {value!r}; one of {', '.join(pricing.PATTERNS)}")
    return value


def _keys(choices: Dict[str, Any], allowed, what: str) -> Dict[str, Any]:
    unknown = sorted(set(choices) - set(allowed))
    if unknown:
        raise ValueError(f"Unknown {what}: {', '.join(unknown)}")
    return choices


# ── Sketch (feet, interior wall to wall) ──

class SketchPoint(BaseModel):
    model_config = ConfigDict(extra="allow")
    x: float
    y: float


class SketchRoom(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field("Room", max_length=200)
    height_ft: float = Field(8.0, gt=0, le=40)
    points: List[SketchPoint] = Field(..., min_length=3)
    subroom_of: Optional[str] = None


class SketchOpening(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(..., min_length=1, max_length=64)
    kind: str = "opening"
    # The room(s) it opens from and into; null is the outside
    rooms: List[Optional[str]] = Field(..., min_length=1, max_length=2)
    a: SketchPoint
    b: SketchPoint
    swing: Optional[str] = None
    hinge: Optional[Literal["a", "b"]] = None

    @field_validator("kind")
    @classmethod
    def check_kind(cls, value: str) -> str:
        if value not in OPENING_KINDS:
            raise ValueError(f"Unknown opening kind {value!r}")
        return value


class SketchCabinetRun(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(..., min_length=1, max_length=64)
    room_id: str
    a: SketchPoint
    b: SketchPoint
    # Whether the cabinet's side shows at each end (it takes shoe molding);
    # null: worked out from the sketch
    side_a: Optional[bool] = None
    side_b: Optional[bool] = None


class SketchWall(BaseModel):
    """A wall standing in a room: from a point on one of its walls (a), out
    into the room (b), or across it to another wall"""
    model_config = ConfigDict(extra="allow")
    id: str = Field(..., min_length=1, max_length=64)
    room_id: str
    a: SketchPoint
    b: SketchPoint
    thickness: float = Field(0.375, gt=0, le=2)


class SketchFixture(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(..., min_length=1, max_length=64)
    type: str
    x: float
    y: float
    w: float = Field(0, ge=0)
    h: float = Field(0, ge=0)
    rotation: float = 0
    floor_under: bool = False
    # A range or dryer on gas: more to its detach & reset
    gas: bool = False
    # Set on top of the new floor, or the floor cut to fit it (a hole for its pipe or duct);
    # null: its kind's (geometry.FIXTURE_KINDS). An island goes by floor_under.
    floor_fit: Optional[Literal["on_top", "cut_to_fit"]] = None

    @field_validator("type")
    @classmethod
    def check_type(cls, value: str) -> str:
        if value not in FIXTURE_TYPES:
            raise ValueError(f"Unknown fixture type {value!r}")
        return value


class SketchLevel(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field("Main Level", max_length=100)
    rooms: List[SketchRoom] = []
    openings: List[SketchOpening] = []
    cabinet_runs: List[SketchCabinetRun] = []
    fixtures: List[SketchFixture] = []
    walls: List[SketchWall] = []


class FlooringSketch(BaseModel):
    """What the sketch editor saves. Extra keys (colors, label spots) are kept as they are."""
    model_config = ConfigDict(extra="allow")
    version: int = 1
    units: Literal["ft"] = "ft"
    levels: List[SketchLevel] = []

    @model_validator(mode="after")
    def check_references(self):
        room_ids: List[str] = [room.id for level in self.levels for room in level.rooms]
        if len(room_ids) != len(set(room_ids)):
            raise ValueError("Two rooms have the same id")
        known = set(room_ids)
        for level in self.levels:
            for opening in level.openings:
                missing = [r for r in opening.rooms if r and r not in known]
                if missing:
                    raise ValueError(f"Opening {opening.id} opens into a room that isn't drawn: {missing[0]}")
            for run in level.cabinet_runs:
                if run.room_id not in known:
                    raise ValueError(f"Cabinet run {run.id} is in a room that isn't drawn: {run.room_id}")
            for wall in level.walls:
                if wall.room_id not in known:
                    raise ValueError(f"Wall {wall.id} is in a room that isn't drawn: {wall.room_id}")
            for room in level.rooms:
                if room.subroom_of and room.subroom_of not in known:
                    raise ValueError(f"{room.name} is a subroom of a room that isn't drawn")
        return self


# ── Scope: the estimator's choices ──

class ItemChoice(BaseModel):
    """Leave a field null to follow the default (or, on a room, the job's choice)."""
    model_config = ConfigDict(extra="forbid")
    on: Optional[bool] = None
    qty: Optional[float] = Field(None, ge=0)
    unit_price: Optional[float] = Field(None, ge=0)
    note: Optional[str] = Field(None, max_length=500)


class CustomItem(BaseModel):
    """A line the catalog doesn't have. Priced by unit_price as typed, or,
    without one, by price_key from the catalog."""
    model_config = ConfigDict(extra="forbid")
    id: Optional[str] = Field(None, max_length=64)
    description: str = Field(..., min_length=1, max_length=500)
    quantity: float = Field(1.0, ge=0)
    unit: str = Field("EA", min_length=1, max_length=10)
    unit_price: Optional[float] = Field(None, ge=0)
    price_key: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=500)


class RoomScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    included: bool = True
    # "replace" (tear out, new floor) or "refinish" (sand the hardwood); null: the job's
    work: Optional[Work] = None
    finish: Optional[str] = None
    new_material: Optional[str] = None
    pattern: Optional[str] = None
    waste_pct: Optional[float] = Field(None, ge=0, le=100)
    existing_material: Optional[str] = None
    items: Dict[str, ItemChoice] = {}
    custom_items: List[CustomItem] = []
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("new_material", "existing_material")
    @classmethod
    def check_floor(cls, value: Optional[str]) -> Optional[str]:
        return _material(value)

    @field_validator("pattern")
    @classmethod
    def check_lay(cls, value: Optional[str]) -> Optional[str]:
        return _pattern(value)

    @field_validator("items")
    @classmethod
    def check_items(cls, value: Dict[str, ItemChoice]) -> Dict[str, ItemChoice]:
        return _keys(value, ROOM_KEYS, "room item")

    @field_validator("finish")
    @classmethod
    def check_finish(cls, value: Optional[str]) -> Optional[str]:
        return _finish(value)


class JobDefaults(BaseModel):
    """What every room takes unless it says otherwise"""
    model_config = ConfigDict(extra="forbid")
    work: Optional[Work] = None
    finish: Optional[str] = None
    new_material: Optional[str] = None
    existing_material: Optional[str] = None
    pattern: Optional[str] = None

    @field_validator("new_material", "existing_material")
    @classmethod
    def check_floor(cls, value: Optional[str]) -> Optional[str]:
        return _material(value)

    @field_validator("pattern")
    @classmethod
    def check_lay(cls, value: Optional[str]) -> Optional[str]:
        return _pattern(value)

    @field_validator("finish")
    @classmethod
    def check_finish(cls, value: Optional[str]) -> Optional[str]:
        return _finish(value)


class JobScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    defaults: JobDefaults = JobDefaults()
    # An item switched on or off (or priced) for every room at once
    room_items: Dict[str, ItemChoice] = {}
    # The General section
    items: Dict[str, ItemChoice] = {}
    custom_items: List[CustomItem] = []

    @field_validator("room_items")
    @classmethod
    def check_room_items(cls, value: Dict[str, ItemChoice]) -> Dict[str, ItemChoice]:
        _keys(value, ROOM_ITEM_MAP, "room item")
        if any(choice.qty is not None for choice in value.values()):
            raise ValueError("A quantity is set on the room, not for every room")
        return value

    @field_validator("items")
    @classmethod
    def check_items(cls, value: Dict[str, ItemChoice]) -> Dict[str, ItemChoice]:
        return _keys(value, GENERAL_KEYS, "general item")


# ── Estimate ──

class FlooringEstimateBase(BaseModel):
    claim_id: Optional[str] = None
    company_id: Optional[str] = None
    property_address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=5)
    zip_code: Optional[str] = Field(None, max_length=10)
    room_scopes: Optional[Dict[str, RoomScope]] = None
    job_scope: Optional[JobScope] = None
    overview_text: Optional[str] = None
    include_overhead_profit: bool = False
    overhead_pct: float = Field(0.10, ge=0, le=1)
    profit_pct: float = Field(0.10, ge=0, le=1)
    notes: Optional[str] = None


class FlooringEstimateCreate(FlooringEstimateBase):
    project_type: Literal["insurance", "remodel"] = "insurance"
    sketch_data: Optional[FlooringSketch] = None


class FlooringEstimateUpdate(BaseModel):
    """Only what is sent changes. The sketch is saved through its own endpoint."""
    claim_id: Optional[str] = None
    company_id: Optional[str] = None
    property_address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=5)
    zip_code: Optional[str] = Field(None, max_length=10)
    room_scopes: Optional[Dict[str, RoomScope]] = None
    job_scope: Optional[JobScope] = None
    overview_text: Optional[str] = None
    include_overhead_profit: Optional[bool] = None
    overhead_pct: Optional[float] = Field(None, ge=0, le=1)
    profit_pct: Optional[float] = Field(None, ge=0, le=1)
    status: Optional[Literal["draft", "calculated", "approved", "exported"]] = None
    notes: Optional[str] = None


class SketchUpdate(BaseModel):
    sketch_data: FlooringSketch


class LineItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    estimate_id: str
    room_id: Optional[str] = None
    room_name: str
    level_name: Optional[str] = None
    category: str
    item_key: Optional[str] = None
    source: str
    description: str
    quantity: float
    unit: str
    unit_price: float
    total: float
    notes: Optional[str] = None
    display_order: int = 0


class FlooringEstimateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    claim_id: Optional[str] = None
    company_id: Optional[str] = None
    created_by_id: Optional[str] = None
    status: str

    group_id: Optional[str] = None
    project_type: str = "insurance"
    kind: str = "restore"
    option_label: Optional[str] = None
    option_order: int = 0
    price_book: Optional[PriceBookSummary] = None

    property_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None

    sketch_data: Optional[Dict[str, Any]] = None
    room_scopes: Optional[Dict[str, Any]] = None
    job_scope: Optional[Dict[str, Any]] = None
    overview_text: Optional[str] = None

    include_overhead_profit: Optional[bool] = False
    overhead_pct: Optional[float] = 0.10
    profit_pct: Optional[float] = 0.10

    calculated_rooms: Optional[List[Dict[str, Any]]] = None
    subtotal: Optional[float] = 0
    overhead_amount: Optional[float] = 0
    profit_amount: Optional[float] = 0
    tax_amount: Optional[float] = 0
    total: Optional[float] = 0
    methodology_notes: Optional[str] = None
    warning_flags: Optional[List[str]] = None
    notes: Optional[str] = None

    line_items: List[LineItemResponse] = []
    # Each room's measurements and every item it is offered, as of now
    takeoff: Optional[Dict[str, Any]] = None

    claim_number: Optional[str] = None
    client_name: Optional[str] = None
    client_id: Optional[str] = None
    company_info: Optional[Dict[str, Any]] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class FlooringEstimateListResponse(BaseModel):
    items: List[FlooringEstimateResponse]
    total: int
    page: int
    page_size: int


class HistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    estimate_id: str
    version_number: int
    snapshot_data: Dict[str, Any]
    changed_by_id: Optional[str] = None
    change_description: Optional[str] = None
    created_at: Optional[datetime] = None
