"""Sliding glass doors on a tub.

A tub can have a sliding door set across its open side instead of a
curtain. It is detached and reset or replaced as the person chose: a
framed set per set (by its grade when new), a frameless one by its SF and
never under the glazier's minimum."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.bathroom_estimate.pricing import (  # noqa: E402
    TUB_GLASS_DOORS,
    TUB_GLASS_PANEL,
    get_labor_multiplier,
)

ZIP = "20850"
MULT = get_labor_multiplier(ZIP)
DR = "Tub sliding doors - Detach & Reset"
RR = "Tub sliding doors - R&R"


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(tub=None, **fields):
    base = dict(property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=8, width_ft=6,
                floor_sf=40, wall_sf=600, height_ft=8,
                walls_spec={"wall_finish": "paint", "paint_grade": "mid"},
                replace_tub=True, bathtub_spec={"type": "alcove", "material": "acrylic", **(tub or {})})
    base.update(fields)
    return BathroomEstimate(**base)


def lines_of(est):
    return {li["description"]: li for li in calculate_estimate(est)["line_items"]}


def near(a, b):
    return abs(a - b) < 0.05


def door_lines(lines):
    return [d for d in lines if d.startswith("Tub sliding doors")]


def test_no_doors_unless_chosen():
    assert door_lines(lines_of(estimate())) == []
    assert door_lines(lines_of(estimate({"glass_door_action": "none", "glass_door_grade": "high"}))) == []


def test_a_new_framed_set_is_priced_by_its_grade():
    for grade in ("standard", "mid", "high", "premium"):
        line = lines_of(estimate({"glass_door_action": "replace", "glass_door_grade": grade}))[RR]
        assert line["quantity"] == 1 and line["unit"] == "EA"
        assert near(line["unit_price"], TUB_GLASS_DOORS[grade] * MULT)
        assert line["notes"].startswith("Framed set, ")


def test_a_framed_set_with_no_grade_is_mid():
    line = lines_of(estimate({"glass_door_action": "replace"}))[RR]
    assert near(line["unit_price"], TUB_GLASS_DOORS["mid"] * MULT)
    assert "obscure glass" in line["notes"]


def test_a_framed_set_detached_and_reset_whatever_its_grade():
    lines = lines_of(estimate({"glass_door_action": "detach_reset", "glass_door_grade": "premium"}))
    assert near(lines[DR]["unit_price"], TUB_GLASS_DOORS["detach_reset"] * MULT)
    assert RR not in lines


def test_frameless_doors_by_their_sf():
    lines = lines_of(estimate({"glass_door_action": "replace", "glass_door_frameless": True,
                               "glass_door_width_in": 60, "glass_door_height_in": 62}))
    sf = round(60 * 62 / 144, 1)
    assert near(lines[RR]["unit_price"], sf * TUB_GLASS_DOORS["frameless_per_sf"] * MULT)
    assert f"{sf:g} SF" in lines[RR]["notes"]

    lines = lines_of(estimate({"glass_door_action": "detach_reset", "glass_door_frameless": True}))
    sf = round(60 * 58 / 144, 1)  # blank size: a 60" tub, 58" doors
    assert near(lines[DR]["unit_price"], sf * TUB_GLASS_DOORS["frameless_detach_reset_per_sf"] * MULT)


def test_small_frameless_doors_are_never_under_the_minimum():
    lines = lines_of(estimate({"glass_door_action": "detach_reset", "glass_door_frameless": True,
                               "glass_door_width_in": 30, "glass_door_height_in": 30}))
    assert near(lines[DR]["unit_price"], TUB_GLASS_PANEL["minimum"] * MULT)
    assert "Minimum charge" in lines[DR]["notes"]


def test_doors_come_off_even_when_the_tub_stays():
    lines = lines_of(estimate({"glass_door_action": "detach_reset"}, replace_tub=False))
    assert DR in lines


def test_a_panel_and_doors_are_separate_lines():
    lines = lines_of(estimate({"glass_door_action": "replace", "glass_panel_action": "detach_reset"}))
    assert RR in lines and "Tub glass panel - Detach & Reset" in lines


def test_no_doors_without_a_tub():
    lines = lines_of(estimate({"type": "none", "glass_door_action": "replace"}))
    assert door_lines(lines) == []
