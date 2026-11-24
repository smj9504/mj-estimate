"""Niches set in a bathroom wall, priced each by kind.

A tiled niche is Xactimate's charge to tile a niche; a foam-insert one adds
the foam niche set and sealed; a drywall one is built and painted (moisture
resistant, as all bathroom paint). Rows of a kind add up, and a row of no
kind or no count prices nothing."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.bathroom_estimate.niches import niche_groups  # noqa: E402
from app.domains.bathroom_estimate.pricing import (  # noqa: E402
    MOISTURE_RESISTANT_PAINT_MULT,
    WALL_NICHE_PRICES,
    get_labor_multiplier,
)
from app.domains.unit_prices.xactimate import xact  # noqa: E402

ZIP = "20850"
MULT = get_labor_multiplier(ZIP)


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(**fields):
    base = dict(property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=8, width_ft=5,
                floor_sf=40, wall_sf=208, height_ft=8, walls_spec={"wall_finish": "paint", "paint_grade": "mid"})
    base.update(fields)
    return BathroomEstimate(**base)


def lines(est):
    return {li["description"]: li for li in calculate_estimate(est)["line_items"]}


def test_niche_prices_are_xactimates_lines_marked_up():
    assert WALL_NICHE_PRICES["tile"] == xact(293.55)         # TIL NICHE
    assert WALL_NICHE_PRICES["foam_insert"] == xact(138.59)  # TIL NICHEFC
    assert WALL_NICHE_PRICES["paint"] == xact(30.90)         # PNT NICHE


def test_each_kind_of_niche_is_a_line_priced_each():
    got = lines(estimate(accessories_spec={"niches": [
        {"type": "tile", "count": 2, "from_sketch": True},
        {"type": "tile_foam", "count": 1},
        {"type": "drywall", "count": 1},
    ]}))
    tile = round(WALL_NICHE_PRICES["tile"] * MULT, 2)
    assert got["Tiled wall niche"]["quantity"] == 2
    assert got["Tiled wall niche"]["unit"] == "EA"
    assert got["Tiled wall niche"]["unit_price"] == tile
    assert got["Tiled wall niche"]["category"] == "tile"
    assert got["Tiled wall niche, foam insert"]["unit_price"] == round(
        round(WALL_NICHE_PRICES["foam_insert"] * MULT, 2) + tile, 2)
    assert got["Drywall wall niche, painted"]["unit_price"] == round(
        round(WALL_NICHE_PRICES["drywall_build"] * MULT, 2)
        + round(WALL_NICHE_PRICES["paint"] * MOISTURE_RESISTANT_PAINT_MULT * MULT, 2), 2)


def test_rows_of_a_kind_add_up_and_rows_of_no_kind_or_count_price_nothing():
    est = estimate(accessories_spec={"niches": [
        {"type": "tile", "count": 1}, {"type": "tile", "count": 2},
        {"type": "marble", "count": 1}, {"type": "drywall", "count": 0}, "tile",
    ]})
    assert niche_groups(est) == [{"type": "tile", "count": 3}]
    got = lines(est)
    assert got["Tiled wall niche"]["quantity"] == 3
    assert "Drywall wall niche, painted" not in got


def test_no_niches_no_line():
    got = lines(estimate())
    assert not any("niche" in d.lower() for d in got)
