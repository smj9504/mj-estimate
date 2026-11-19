"""A shower in its own room.

The sketch reads a shower whose front stands against a wall with a door's
opening in it (often no door slab, just the opening) as a shower room: its
glass door hangs in the opening, and the wall either side of the opening is
its front, tiled on the inside and round the opening (the jambs, and the head
when the tile goes above it). The sync sends the opening's size; the shower's
tile, its tear-out and its door are priced from it."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import OPENING_RETURN_IN, calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402

ZIP = "20850"


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(shower=None, **fields):
    base = dict(property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=8, width_ft=6,
                floor_sf=48, wall_sf=600, height_ft=8,
                walls_spec={"wall_finish": "paint", "paint_grade": "mid"},
                replace_shower=True,
                shower_spec={"type": "custom_tile", "width_in": 36, "depth_in": 36, "tile_height_in": 84,
                             "layout": "alcove", "wall_material": "tile", **(shower or {})})
    base.update(fields)
    return BathroomEstimate(**base)


def lines_of(est):
    return {li["description"]: li for li in calculate_estimate(est)["line_items"]}


def shower_tile(lines):
    return next(li for d, li in lines.items() if d.startswith("Shower wall tile complete"))


def test_an_open_front_shower_tiles_three_walls():
    line = shower_tile(lines_of(estimate()))
    assert line["quantity"] == pytest.approx((36 + 2 * 36) * 84 / 144)
    assert "opening" not in (line["notes"] or "")


def test_a_shower_room_tiles_its_front_wall_and_round_the_opening():
    line = shower_tile(lines_of(estimate({"front_opening_in": 24, "front_opening_height_in": 80})))
    front = (36 - 24) * 84 / 144
    returns = (2 * 80 + 24) * OPENING_RETURN_IN / 144  # the tile goes above the opening: its head too
    assert line["quantity"] == pytest.approx((36 + 2 * 36) * 84 / 144 + front + returns, abs=0.01)
    assert '24" opening' in line["notes"]


def test_tile_that_stops_below_the_head_tiles_the_jambs_only():
    line = shower_tile(lines_of(estimate({"tile_height_in": 72, "front_opening_in": 24, "front_opening_height_in": 80})))
    returns = (2 * 72) * OPENING_RETURN_IN / 144
    assert line["quantity"] == pytest.approx((36 + 2 * 36) * 72 / 144 + (36 - 24) * 72 / 144 + returns, abs=0.01)


def test_its_old_tile_comes_out_with_it():
    plain = calculate_estimate(estimate())
    room = calculate_estimate(estimate({"front_opening_in": 24, "front_opening_height_in": 80}))
    demo = lambda r: next(li for li in r["line_items"] if li["phase"] == 1 and li["description"].startswith(("Demo", "Tile")))
    assert demo(room)["total"] > demo(plain)["total"]


def test_its_door_is_priced_at_the_openings_width_with_no_panels():
    lines = lines_of(estimate({"front_opening_in": 24, "front_opening_height_in": 80,
                               "door_type": "swing", "door_width_in": 24, "fixed_panel_config": "none"}))
    door = lines["Shower door - Framed Pivot"]
    assert door["total"] > 0
    assert '24" opening' in door["notes"]
    assert "panel" not in door["notes"].lower()


def test_a_neo_angle_shower_has_no_front_wall():
    plain = shower_tile(lines_of(estimate({"layout": "neo_angle"})))
    opened = shower_tile(lines_of(estimate({"layout": "neo_angle", "front_opening_in": 24})))
    assert opened["quantity"] == plain["quantity"]


# ── The front wall tiled or not: the sketch's 4th tiled wall ──

ROOM = {"front_opening_in": 24, "front_opening_height_in": 80}


def test_a_shower_room_with_three_tiled_walls_leaves_its_front_alone():
    untiled = shower_tile(lines_of(estimate({**ROOM, "front_tiled": False})))
    assert untiled["quantity"] == pytest.approx((36 + 2 * 36) * 84 / 144)
    assert "opening" not in (untiled["notes"] or "")
    tiled = shower_tile(lines_of(estimate({**ROOM, "front_tiled": True})))
    assert tiled["quantity"] > untiled["quantity"]


def test_an_untiled_front_comes_out_as_no_tile():
    plain = calculate_estimate(estimate())
    untiled = calculate_estimate(estimate({**ROOM, "front_tiled": False}))
    demo = lambda r: next(li for li in r["line_items"] if li["phase"] == 1 and li["description"].startswith(("Demo", "Tile")))
    assert demo(untiled)["total"] == demo(plain)["total"]


def test_a_shower_room_saved_before_the_choice_keeps_its_tiled_front():
    saved = shower_tile(lines_of(estimate(ROOM)))
    tiled = shower_tile(lines_of(estimate({**ROOM, "front_tiled": True})))
    assert saved["quantity"] == tiled["quantity"]


def test_a_tiled_front_is_backed_and_waterproofed_too():
    durock = lambda spec: lines_of(estimate(spec))["Cement board (Durock) - wet area"]["quantity"]
    walls_and_floor = (36 + 2 * 36) * 84 / 144 + 36 * 36 / 144
    assert durock({**ROOM, "front_tiled": False}) == pytest.approx(walls_and_floor, abs=0.01)
    front = (36 - 24) * 84 / 144 + (2 * 80 + 24) * OPENING_RETURN_IN / 144
    assert durock({**ROOM, "front_tiled": True}) == pytest.approx(walls_and_floor + front, abs=0.01)


def test_a_border_row_runs_along_a_tiled_front_too():
    border = lambda spec: next(li for d, li in lines_of(estimate({**ROOM, "deco_border_rows": 1, **spec})).items()
                               if d.startswith("Decorative tile border"))["quantity"]
    assert border({"front_tiled": False}) == pytest.approx((36 + 2 * 36) / 12, abs=0.05)
    assert border({"front_tiled": True}) == pytest.approx((36 + 2 * 36 + 12) / 12, abs=0.05)
