"""Door trim and paint on the bathroom estimate.

A door's trim, one side each: the old casing comes off and new casing goes
up, and the trim and jamb are painted (walls_spec door_trim_action replace,
the default; paint; none). The sketch gives the doors and their casing's LF.
Every paint line in a bathroom is moisture-resistant bath paint, the premium
on top of the chosen grade (mid when none was chosen), and says so."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.bathroom_estimate.pricing import (  # noqa: E402
    DOOR_CASING_LF_DEFAULT,
    DOOR_TRIM,
    MOISTURE_RESISTANT_PAINT_MULT,
    PAINT_GRADE_MULTIPLIER,
    PAINT_RATES,
    get_labor_multiplier,
)

ZIP = "20850"
MULT = get_labor_multiplier(ZIP)
MR = MOISTURE_RESISTANT_PAINT_MULT


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(walls=None, **fields):
    base = dict(property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=8, width_ft=6,
                floor_sf=48, wall_sf=200, height_ft=8,
                walls_spec={"wall_finish": "paint", "paint_grade": "mid", **(walls or {})})
    base.update(fields)
    return BathroomEstimate(**base)


def lines_of(est):
    return {li["description"]: li for li in calculate_estimate(est)["line_items"]}


def near(a, b):
    return abs(a - b) < 0.05


def test_a_door_gets_new_casing_and_its_trim_painted():
    lines = lines_of(estimate({"door_trim_count": 1}))
    casing = lines["Door casing - remove & install new (1 door)"]
    assert casing["unit"] == "LF" and casing["quantity"] == DOOR_CASING_LF_DEFAULT
    assert near(casing["unit_price"], DOOR_TRIM["casing_per_lf"] * MULT)
    paint = lines["Door trim & jamb painting (moisture-resistant, mid grade)"]
    assert paint["quantity"] == 1 and paint["unit"] == "EA"
    assert near(paint["unit_price"], DOOR_TRIM["paint_per_side"] * MR * MULT)


def test_the_sketchs_casing_length_is_used():
    lines = lines_of(estimate({"door_trim_count": 2, "door_trim_lf": 33.5}))
    assert lines["Door casing - remove & install new (2 doors)"]["quantity"] == 33.5
    assert lines["Door trim & jamb painting (moisture-resistant, mid grade)"]["quantity"] == 2


def test_paint_only_or_nothing_as_chosen():
    paint_only = lines_of(estimate({"door_trim_count": 1, "door_trim_action": "paint"}))
    assert not any(d.startswith("Door casing") for d in paint_only)
    assert "Door trim & jamb painting (moisture-resistant, mid grade)" in paint_only
    none = lines_of(estimate({"door_trim_count": 1, "door_trim_action": "none"}))
    assert not any(d.startswith(("Door casing", "Door trim")) for d in none)


def test_window_trim_is_painted_per_side_the_same_way():
    line = lines_of(estimate({"window_trim_count": 1, "paint_grade": "premium"}))[
        "Window trim & jamb painting (moisture-resistant, premium grade)"]
    assert near(line["unit_price"], DOOR_TRIM["paint_per_side"] * PAINT_GRADE_MULTIPLIER["premium"] * MR * MULT)


def test_painted_walls_are_painted_with_no_grade_chosen():
    lines = lines_of(estimate({"paint_grade": None}))
    wall = lines["Wall painting (moisture-resistant, mid grade)"]
    assert near(wall["unit_price"], PAINT_RATES["wall_per_sf"] * MR * MULT)


def test_every_paint_line_is_moisture_resistant_bath_paint():
    lines = calculate_estimate(estimate(
        {"door_trim_count": 1, "window_trim_count": 1, "paint_ceiling": True,
         "baseboard_material": "pvc", "quarter_round": True},
        hidden_costs={"trim_paint": True, "trim_paint_lf": 20},
    ))["line_items"]
    painted = [li["description"] for li in lines
               if "paint" in li["description"].lower()
               and not li["description"].startswith(("Paint prep", "Seal & prime", "Seal and prime"))]
    assert painted, "no paint lines"
    assert all("moisture-resistant" in d for d in painted), painted
    base = next(li for li in lines if li["description"].startswith("Baseboard painting"))
    assert near(base["unit_price"], PAINT_RATES["trim_per_lf"] * MR * MULT)
