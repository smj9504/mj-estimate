"""A shower door can sit against the left or right side of the front instead
of the middle; the fixed glass panel beside it then fills the rest of the
front, and is priced that wide. On a throwaway SQLite database."""

from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.core.database_factory import SQLAlchemySession  # noqa: E402
from app.domains.bathroom_estimate.models import (  # noqa: E402
    BathroomEstimate,
    BathroomEstimateHistory,
    BathroomEstimateLineItem,
)
from app.domains.bathroom_estimate.schemas import BathroomEstimateCreate  # noqa: E402
from app.domains.bathroom_estimate.service import BathroomEstimateService  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.file.models import File  # noqa: E402
from app.domains.product_library.models import Product  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


@pytest.fixture
def service(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'bath.db'}")
    for model in (Client, Claim, BathroomEstimate, BathroomEstimateLineItem, BathroomEstimateHistory, Product, File):
        model.__table__.create(engine)
    s = SQLAlchemySession(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)())
    yield BathroomEstimateService(s)
    s.close()


def door_notes(service, **door):
    """The shower door line's notes for a 60" tiled shower with a 30" swing
    door and 72" glass, set as `door` says."""
    job = service.create_estimate(BathroomEstimateCreate(
        project_type="remodel",
        property_address="12 Elm St", city="Rockville", state="MD", zip_code="20850",
        designation="hall", bath_function="full",
        length_ft=8, width_ft=8, floor_sf=40, wall_sf=256,
        replace_shower=True,
        shower_spec={"type": "custom_tile", "width_in": 60, "depth_in": 36, "tile_height_in": 96,
                     "door_type": "swing", "door_width_in": 30, "door_height_in": 72,
                     "layout": "alcove", **door},
    ))
    items = service.calculate(job["id"])["line_items"]
    [line] = [li for li in items if li["description"].startswith("Shower door")]
    return line["notes"]


def test_a_centred_door_has_a_quarter_of_the_front_for_each_panel(service):
    # 15" × 72" = 7.5 SF a panel
    assert "Fixed panel (1): 7.5 SF" in door_notes(service, fixed_panel_config="right")
    assert "Fixed panel (2): 15.0 SF" in door_notes(service, fixed_panel_config="both")
    # An estimate from before the door could move prices the same
    assert door_notes(service, fixed_panel_config="right") == door_notes(service, fixed_panel_config="right", door_position="center")


def test_a_door_against_one_side_leaves_the_panel_the_rest_of_the_front(service):
    # 60" less the 30" door = 30" × 72" = 15 SF
    assert "Fixed panel (1): 15.0 SF" in door_notes(service, door_position="left", fixed_panel_config="right")
    assert "Fixed panel (1): 15.0 SF" in door_notes(service, door_position="right", fixed_panel_config="left")


def test_a_door_against_one_side_with_no_panel_has_no_glass_beside_it(service):
    assert "Fixed panel" not in door_notes(service, door_position="left", fixed_panel_config="none")
