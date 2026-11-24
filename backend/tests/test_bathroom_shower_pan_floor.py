"""A shower whose floor is a prefab base (a fiberglass or acrylic pan).

The pan takes the place of everything a tiled shower floor needs: the floor
tile, the mortar pre-slope and liner, the tiled curb, and the floor's cement
board and waterproofing. It's a line of its own from Xactimate's PLM SWRB (a
36" x 36" base, its drain and install), a bigger base's material by its area.
The walls stay tiled. A curbless shower's floor is always tile."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.bathroom_estimate.pricing import SHOWER_BASE, get_labor_multiplier  # noqa: E402
from app.domains.bathroom_estimate.shower_base import floor_pan  # noqa: E402
from app.domains.unit_prices.xactimate import xact  # noqa: E402

ZIP = "20850"
MULT = get_labor_multiplier(ZIP)


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def lines(**shower):
    est = BathroomEstimate(
        property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=8, width_ft=5,
        floor_sf=40, wall_sf=208, height_ft=8, replace_shower=True,
        shower_spec={"type": "custom_tile", "width_in": 60, "depth_in": 32, "tile_height_in": 84,
                     "curb_height": 4, "wall_material": "tile", **shower},
    )
    return {li["description"]: li for li in calculate_estimate(est)["line_items"]}


def test_the_base_is_xactimates_shower_base_new():
    assert SHOWER_BASE["material"] == xact(330.48)   # PLM SWRB material
    assert SHOWER_BASE["install"] == xact(368.97)    # PLM SWRB install


def test_a_tiled_floor_keeps_its_tile_mud_bed_and_curb():
    got = lines(floor_type="tile")
    assert any(d.startswith("Shower floor tile complete") for d in got)
    assert "Shower pan (pre-slope + liner + drain)" in got
    assert "Shower curb tile" in got
    assert not any(d.startswith("Shower base") for d in got)


def test_a_pan_floor_is_a_base_in_place_of_the_tile_mud_bed_and_curb():
    got = lines(floor_type="acrylic_pan")
    base = got['Shower base - acrylic pan (60″ × 32″), supply + install']
    # 60" x 32" is 13.3 SF: the base's material by that over 9 SF, its install the same
    factor = (60 * 32 / 144) / 9
    assert base["unit_price"] == pytest.approx(
        round(SHOWER_BASE["material"] * factor, 2) + round(SHOWER_BASE["install"] * MULT, 2), abs=0.01)
    assert not any(d.startswith("Shower floor tile") for d in got)
    assert "Shower pan (pre-slope + liner + drain)" not in got
    assert "Shower curb tile" not in got
    # The walls stay tiled
    assert any("Shower wall tile" in d or "shower wall" in d.lower() for d in got)
    # No line builds a curb (a tiled floor's shower line does)
    assert not any("Curb:" in (li.get("notes") or "") for li in got.values())
    assert any("Curb:" in (li.get("notes") or "") for li in lines(floor_type="tile").values())


def test_a_fiberglass_pan_and_a_curbless_shower():
    assert lines(floor_type="fiberglass_pan")['Shower base - fiberglass pan (60″ × 32″), supply + install']
    assert floor_pan({"floor_type": "acrylic_pan", "type": "curbless_wood"}) is None
    assert floor_pan({"floor_type": "tile"}) is None
    assert floor_pan({}) is None


def test_no_floor_cement_board_or_waterproofing_under_a_pan():
    tile = lines(floor_type="tile")
    pan = lines(floor_type="acrylic_pan")
    wet = lambda got: next(li for d, li in got.items() if d.startswith("Cement board (Durock) - wet area"))  # noqa: E731
    assert wet(tile)["quantity"] - wet(pan)["quantity"] == pytest.approx(60 * 32 / 144, abs=0.2)
