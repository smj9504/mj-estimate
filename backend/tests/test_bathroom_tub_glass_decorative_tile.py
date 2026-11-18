"""A tub's fixed glass panel and decorative tile on the estimate.

A tub can have a fixed glass panel over part of its open side (a splash
screen, not a door); it is detached and reset or replaced as the person
chose, priced by its SF and never under the glazier's minimum.

Tile can carry a pattern: border / listello strips and accent inserts set
into the field. They are lines of their own on top of the surface's field
tile: a tub surround or shower walls take border rows (each all the way
around), walls and floor the border's LF; inserts are counted."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.bathroom_estimate.pricing import (  # noqa: E402
    DECORATIVE_TILE,
    TUB_GLASS_PANEL,
    get_labor_multiplier,
)
from app.domains.unit_prices.catalog import get_domain  # noqa: E402

ZIP = "20850"
MULT = get_labor_multiplier(ZIP)
DR = "Tub glass panel - Detach & Reset"
RR = "Tub glass panel - R&R"


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


# ── Tub glass panel ──

def test_no_glass_panel_unless_chosen():
    lines = lines_of(estimate())
    assert not any(d.startswith("Tub glass panel") for d in lines)
    lines = lines_of(estimate({"glass_panel_action": "none", "glass_panel_width_in": 30}))
    assert not any(d.startswith("Tub glass panel") for d in lines)


def test_glass_panel_detach_and_reset_by_its_sf():
    lines = lines_of(estimate({"glass_panel_action": "detach_reset",
                               "glass_panel_width_in": 32, "glass_panel_height_in": 60}))
    sf = round(32 * 60 / 144, 1)
    line = lines[DR]
    assert line["quantity"] == 1 and line["unit"] == "EA"
    assert near(line["unit_price"], sf * TUB_GLASS_PANEL["detach_reset_per_sf"] * MULT)
    assert f"{sf:g} SF" in line["notes"]
    assert RR not in lines


def test_a_small_panel_is_never_under_the_minimum():
    lines = lines_of(estimate({"glass_panel_action": "detach_reset",
                               "glass_panel_width_in": 20, "glass_panel_height_in": 40}))
    assert near(lines[DR]["unit_price"], TUB_GLASS_PANEL["minimum"] * MULT)
    assert "Minimum charge" in lines[DR]["notes"]


def test_glass_panel_replaced_frosted_glass_costs_more():
    size = {"glass_panel_width_in": 30, "glass_panel_height_in": 58}
    sf = round(30 * 58 / 144, 1)
    clear = lines_of(estimate({"glass_panel_action": "replace", **size}))[RR]
    assert near(clear["unit_price"], sf * TUB_GLASS_PANEL["replace_per_sf"] * MULT)
    frosted = lines_of(estimate({"glass_panel_action": "replace", "glass_panel_frosted": True, **size}))[RR]
    assert near(frosted["unit_price"],
                sf * (TUB_GLASS_PANEL["replace_per_sf"] + TUB_GLASS_PANEL["frosted_per_sf"]) * MULT)
    assert "frosted" in frosted["notes"]


def test_glass_panel_without_a_size_is_taken_as_30_by_58():
    line = lines_of(estimate({"glass_panel_action": "replace"}))[RR]
    assert near(line["unit_price"], round(30 * 58 / 144, 1) * TUB_GLASS_PANEL["replace_per_sf"] * MULT)


def test_glass_panel_with_the_tub_left_in_place():
    # The surround torn out around a tub that stays: the panel still comes off
    lines = lines_of(estimate({"glass_panel_action": "detach_reset"}, replace_tub=False))
    assert DR in lines


# ── Decorative tile ──

SURROUND = {"surround_tile": True, "tub_length_in": 60, "tub_depth_in": 32,
            "surround_height_in": 60, "surround_wall_count": 3}


def test_tub_surround_border_rows_go_all_the_way_around():
    lines = lines_of(estimate({**SURROUND, "deco_border_rows": 2, "deco_inserts": 4}))
    border = lines["Decorative tile border / listello - tub surround"]
    assert border["unit"] == "LF"
    assert near(border["quantity"], round(2 * (60 + 2 * 32) / 12, 1))
    assert near(border["unit_price"], DECORATIVE_TILE["border_per_lf"] * MULT)
    assert "2 rows around" in border["notes"]
    inserts = lines["Decorative tile inserts - tub surround"]
    assert inserts["quantity"] == 4 and inserts["unit"] == "EA"
    assert near(inserts["unit_price"], DECORATIVE_TILE["insert_each"] * MULT)


def test_two_wall_surround_runs_along_two_walls():
    lines = lines_of(estimate({**SURROUND, "surround_wall_count": 2, "deco_border_rows": 1}))
    assert near(lines["Decorative tile border / listello - tub surround"]["quantity"], round((60 + 32) / 12, 1))


def test_no_decorative_tile_without_a_tiled_surround():
    lines = lines_of(estimate({"deco_border_rows": 2, "deco_inserts": 4}))
    assert not any(d.startswith("Decorative tile") for d in lines)


def test_no_decorative_lines_when_none_typed():
    lines = lines_of(estimate({**SURROUND, "deco_border_rows": None, "deco_inserts": ""}))
    assert not any(d.startswith("Decorative tile") for d in lines)


def test_shower_wall_border_rows_by_its_layout():
    shower = {"type": "custom_tile", "width_in": 48, "depth_in": 36, "tile_height_in": 84,
              "deco_border_rows": 1, "deco_inserts": 2}
    lines = lines_of(estimate(replace_tub=False, bathtub_spec=None, replace_shower=True, shower_spec=shower))
    assert near(lines["Decorative tile border / listello - shower walls"]["quantity"], round((48 + 2 * 36) / 12, 1))
    assert lines["Decorative tile inserts - shower walls"]["quantity"] == 2
    lines = lines_of(estimate(replace_tub=False, bathtub_spec=None, replace_shower=True,
                              shower_spec={**shower, "layout": "corner"}))
    assert near(lines["Decorative tile border / listello - shower walls"]["quantity"], round((48 + 36) / 12, 1))


def test_wall_tile_and_floor_take_the_border_lf_as_typed():
    lines = lines_of(estimate(
        replace_floor=True, demo_floor=True,
        floor_spec={"material": "porcelain", "deco_border_lf": 24, "deco_inserts": 6},
        walls_spec={"wall_finish": "tile", "tile_wall_sf": 120, "deco_border_lf": 28.5},
    ))
    assert near(lines["Decorative tile border / listello - floor"]["quantity"], 24)
    assert lines["Decorative tile inserts - floor"]["quantity"] == 6
    assert near(lines["Decorative tile border / listello - walls"]["quantity"], 28.5)
    assert "Decorative tile inserts - walls" not in lines


# ── Company prices ──

def test_the_new_prices_are_on_the_company_price_screen():
    items = get_domain("bathroom").item_map()
    keys = {k for k in items if k.startswith(("TUB_GLASS_PANEL", "DECORATIVE_TILE"))}
    assert len(keys) == 6
    border = next(items[k] for k in keys if k.endswith("border_per_lf"))
    assert border.unit == "LF" and near(border.total, DECORATIVE_TILE["border_per_lf"])
    dr = next(items[k] for k in keys if k.endswith("detach_reset_per_sf"))
    assert dr.unit == "SF" and dr.material == 0
