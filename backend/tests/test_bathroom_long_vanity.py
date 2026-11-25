"""A cabinet vanity of any width, one sink or two, and an open knee space.

A long vanity with one sink (a makeup area beside the sink, open under the
top) is priced as its cabinet (the width less the knee space) and the top the
whole width. The cabinet's price comes from the price table by width: a table
size at its price, between sizes by the inch, past the largest at the rate of
the two largest."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.bathroom_estimate.pricing import VANITY_PRICES, VANITY_TOP_PRICES  # noqa: E402
from app.domains.bathroom_estimate.vanities import (  # noqa: E402
    cabinet_price,
    cabinet_width_in,
    knee_space_in,
)

ZIP = "20850"
STOCK = {24: 390, 30: 468, 36: 551, 48: 772, 60: 1048, 72: 1323}


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(item):
    return BathroomEstimate(
        property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=10, width_ft=8,
        floor_sf=80, wall_sf=288, height_ft=8, replace_vanity=True,
        vanity_spec={"items": [{"sink_type": "cabinet", "source": "stock_rta", "top_material": "quartz",
                                "faucet_type": "single_hole", "sinks": 1, **item}]},
    )


def vanity_line(item):
    lines = calculate_estimate(estimate(item))["line_items"]
    return next(li for li in lines if li["description"].startswith("Vanity complete"))


def test_a_cabinet_is_priced_at_any_width():
    assert cabinet_price(STOCK, 36) == 551
    # Between two sizes, by the inch
    assert cabinet_price(STOCK, 42) == pytest.approx((551 + 772) / 2)
    # Past the largest: on at the rate between 60" and 72"
    assert cabinet_price(STOCK, 96) == pytest.approx(1323 + 24 * (1323 - 1048) / 12)
    # Under the smallest: pro rata
    assert cabinet_price(STOCK, 18) == pytest.approx(390 * 18 / 24)
    # A table kept with its widths as text reads the same
    assert cabinet_price({str(k): v for k, v in STOCK.items()}, 42) == pytest.approx((551 + 772) / 2)


def test_a_knee_space_is_open_under_the_top_never_all_of_it():
    assert knee_space_in({"width": 96, "knee_space_in": 36}) == 36
    assert cabinet_width_in({"width": 96, "knee_space_in": 36}) == 60
    # A cabinet of 12" at least stays under the sink
    assert knee_space_in({"width": 30, "knee_space_in": 36}) == 18
    # Only a cabinet vanity has one
    assert knee_space_in({"sink_type": "pedestal_sink", "width": 30, "knee_space_in": 10}) == 0
    assert cabinet_width_in({"width": None}) == 36


def test_a_long_one_sink_vanity_with_a_knee_space():
    line = vanity_line({"width": 96, "knee_space_in": 36})
    assert line["description"] == 'Vanity complete - stock rta (96") (1 sink, 36" knee space)'
    notes = line["notes"]
    # The cabinet is the 60" under the sink; the top runs the whole 96"
    assert 'Cabinet: stock rta (60")' in notes
    assert 'Knee space: 36" open under the top' in notes
    assert f"${96 * VANITY_TOP_PRICES['quartz']:,.2f}" in notes
    # One faucet: one sink
    assert "Sinks:" not in notes


def test_a_long_vanity_without_one_is_priced_past_72_not_as_36():
    long = vanity_line({"width": 96})
    standard = vanity_line({"width": 36})
    assert long["description"] == 'Vanity complete - stock rta (96")'
    assert 'Cabinet: stock rta (96")' in long["notes"]
    # The table's largest size is 72": a 96" one costs more than that, cabinet and top
    assert long["unit_price"] > vanity_line({"width": 72})["unit_price"] > standard["unit_price"]
    assert VANITY_PRICES["stock_rta"][72] < cabinet_price(VANITY_PRICES["stock_rta"], 96)


def test_detach_and_reset_goes_by_the_cabinet_also_under_a_price_book():
    from app.domains.bathroom_estimate.pricing import DETACH_RESET_COSTS, get_labor_multiplier
    from app.domains.unit_prices.tables import use_prices

    est = estimate({"width": 96, "knee_space_in": 36})
    est.replace_vanity = False
    est.detach_reset_vanity = True
    # A book's keys are whole inches: the 60" cabinet's
    with use_prices({"VANITY_PRICES.stock_rta.24": [390, 0]}):
        lines = calculate_estimate(est)["line_items"]
    dr = next(li for li in lines if li["description"].startswith("Detach & Reset - Vanity"))
    assert dr["description"] == 'Detach & Reset - Vanity & sink (96")'
    assert dr["unit_price"] == pytest.approx(
        round(DETACH_RESET_COSTS["vanity"][60] * get_labor_multiplier(ZIP) + 5 * 13.35 * get_labor_multiplier(ZIP), 2), abs=0.02)
