"""A double door's trim: its trim and jamb painted at Xactimate's large rate
(PNT DORT>: "a double door or large window, per side"), single doors at the
average one; its casing measured on the sketch, or 19 LF a pair when typed."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.bathroom_estimate.pricing import (  # noqa: E402
    DOOR_TRIM,
    MOISTURE_RESISTANT_PAINT_MULT,
    get_labor_multiplier,
)
from app.domains.unit_prices.xactimate import xact  # noqa: E402

ZIP = "20850"
MULT = get_labor_multiplier(ZIP)


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def lines(**walls):
    est = BathroomEstimate(
        property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=8, width_ft=5,
        floor_sf=40, wall_sf=208, height_ft=8,
        walls_spec={"wall_finish": "paint", "paint_grade": "mid", **walls},
    )
    return {li["description"]: li for li in calculate_estimate(est)["line_items"]}


def test_the_large_rate_is_xactimates_double_door_line():
    assert DOOR_TRIM["paint_per_side_large"] == xact(54.27)  # PNT DORT>


def test_a_double_door_is_painted_at_the_large_rate_the_single_at_the_average():
    got = lines(door_trim_count=2, door_trim_double_count=1, door_trim_lf=36.5)
    single = got["Door trim & jamb painting (moisture-resistant, mid grade)"]
    double = got["Double door trim & jamb painting (moisture-resistant, mid grade)"]
    assert single["quantity"] == 1
    assert double["quantity"] == 1
    assert double["unit_price"] == pytest.approx(DOOR_TRIM["paint_per_side_large"] * MOISTURE_RESISTANT_PAINT_MULT * MULT, abs=0.01)
    assert single["unit_price"] == pytest.approx(DOOR_TRIM["paint_per_side"] * MOISTURE_RESISTANT_PAINT_MULT * MULT, abs=0.01)
    casing = got["Door casing - remove & install new (2 doors, 1 double)"]
    assert casing["quantity"] == 36.5


def test_typed_with_no_casing_length_a_pair_takes_19_lf():
    got = lines(door_trim_count=2, door_trim_double_count=1)
    assert got["Door casing - remove & install new (2 doors, 1 double)"]["quantity"] == 17 + 19
    # More pairs than doors: all of them pairs
    got = lines(door_trim_count=1, door_trim_double_count=3)
    assert "Door trim & jamb painting (moisture-resistant, mid grade)" not in got
    assert got["Double door trim & jamb painting (moisture-resistant, mid grade)"]["quantity"] == 1


def test_no_pairs_no_double_line():
    got = lines(door_trim_count=1)
    assert got["Door trim & jamb painting (moisture-resistant, mid grade)"]["quantity"] == 1
    assert not any(d.startswith("Double door") for d in got)
