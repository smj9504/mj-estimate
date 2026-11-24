"""Niches set in a bathroom wall, priced each by kind.

A tiled niche is Xactimate's charge to tile a niche; a foam-insert one adds
the foam niche set and sealed; a drywall one is built and painted (moisture
resistant, as all bathroom paint). Each price is for Xactimate's 12" x 12"
niche; a bigger one is priced by its edge length. Rows of a kind and size add
up, and a row of no kind or no count prices nothing."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.bathroom_estimate.niches import niche_groups, size_factor  # noqa: E402
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
    assert niche_groups(est) == [{"type": "tile", "count": 3, "width": None, "height": None}]
    got = lines(est)
    assert got["Tiled wall niche"]["quantity"] == 3
    assert "Drywall wall niche, painted" not in got


def test_no_niches_no_line():
    got = lines(estimate())
    assert not any("niche" in d.lower() for d in got)


def test_a_niche_is_priced_by_its_edge_over_xactimates_12_by_12():
    # TIL NICHE: 8 bullnose 3/4" x 6" round a 12" x 12" niche, 4 LF of edge
    assert size_factor(12, 12) == 1
    assert size_factor(12, 24) == 1.5     # 6 LF
    assert size_factor(12, 48) == 2.5     # 10 LF
    assert size_factor(24, 48) == 3       # 12 LF
    # Never under one niche, and one niche when no size is given
    assert size_factor(8, 10) == 1
    assert size_factor(None, None) == 1


def test_each_size_is_a_line_of_its_own_priced_by_its_edge():
    est = estimate(accessories_spec={"niches": [
        {"type": "tile", "count": 1, "width": 12, "height": 24, "from_sketch": True},
        {"type": "tile", "count": 1, "width": 12, "height": 24, "from_sketch": True},
        {"type": "tile", "count": 1, "width": 48, "height": 12, "from_sketch": True},
        {"type": "tile_foam", "count": 1, "width": 14, "height": 30},
        {"type": "drywall", "count": 1, "width": 12, "height": 12},
    ]})
    assert niche_groups(est) == [
        {"type": "tile", "count": 2, "width": 12, "height": 24},
        {"type": "tile", "count": 1, "width": 48, "height": 12},
        {"type": "tile_foam", "count": 1, "width": 14, "height": 30},
        {"type": "drywall", "count": 1, "width": 12, "height": 12},
    ]
    got = lines(est)
    small = got["Tiled wall niche 12″ × 24″"]
    assert small["quantity"] == 2
    assert small["unit_price"] == round(WALL_NICHE_PRICES["tile"] * MULT * 1.5, 2)
    assert "6 LF of edge: x 1.5" in small["notes"]
    long = got["Tiled wall niche 48″ × 12″"]
    assert long["quantity"] == 1
    assert long["unit_price"] == round(WALL_NICHE_PRICES["tile"] * MULT * 2.5, 2)
    # Foam insert and tile both by its edge: 88" over 48"
    f = 88 / 48
    assert got["Tiled wall niche, foam insert 14″ × 30″"]["unit_price"] == round(
        round(WALL_NICHE_PRICES["foam_insert"] * MULT * round(f, 4), 2)
        + round(WALL_NICHE_PRICES["tile"] * MULT * round(f, 4), 2), 2)
    # A 12" x 12" drywall niche is one niche
    assert got["Drywall wall niche, painted 12″ × 12″"]["unit_price"] == round(
        round(WALL_NICHE_PRICES["drywall_build"] * MULT, 2)
        + round(WALL_NICHE_PRICES["paint"] * MOISTURE_RESISTANT_PAINT_MULT * MULT, 2), 2)
    assert "Up to 4 LF of edge" in got["Drywall wall niche, painted 12″ × 12″"]["notes"]
