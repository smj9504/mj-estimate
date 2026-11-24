"""Lights by place: lights of one kind in different places are lines of their
own (the cans over the vanity, the can in the shower). Rows of a kind and place
add up; a can is priced at the several-cans rate when the job has several,
wherever each one is."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.lights import light_groups, light_name  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.bathroom_estimate.pricing import ELECTRICAL_RATES, get_labor_multiplier  # noqa: E402

ZIP = "20850"
MULT = get_labor_multiplier(ZIP)


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(lights):
    return BathroomEstimate(
        property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=8, width_ft=5,
        floor_sf=40, wall_sf=208, height_ft=8, electrical_spec={"lights": lights},
    )


def lines(lights):
    return {li["description"]: li for li in calculate_estimate(estimate(lights))["line_items"]
            if li["category"] == "electrical" or "light" in li["description"].lower()}


def test_each_place_is_a_line_of_its_own():
    got = lines([
        {"type": "recessed", "count": 2, "location": "Over the vanity", "from_sketch": True},
        {"type": "recessed", "count": 1, "location": "In the shower", "from_sketch": True},
        {"type": "vanity_bar", "count": 1, "bulbs": 3, "from_sketch": True},
    ])
    vanity = got["Recessed light installation (2 cans) - Over the vanity"]
    shower = got["Recessed light installation (1 can) - In the shower"]
    assert vanity["quantity"] == 2
    assert shower["quantity"] == 1
    # Three cans on the job: each at the several-cans rate, wherever it is
    assert shower["unit_price"] == vanity["unit_price"] == pytest.approx(ELECTRICAL_RATES["recessed_light_multi"] * MULT, abs=0.01)
    assert "Vanity light fixture installation (3-light)" in got


def test_rows_of_a_kind_and_place_add_up_and_a_lone_can_keeps_its_rate():
    est = estimate([
        {"type": "pendant", "count": 1, "location": "Over the tub"},
        {"type": "pendant", "count": 1, "location": "  over the TUB "},
        {"type": "pendant", "count": 1},
    ])
    assert light_groups(est) == [
        {"type": "pendant", "count": 2, "bulbs": None, "action": "replace", "location": "Over the tub"},
        {"type": "pendant", "count": 1, "bulbs": None, "action": "replace"},
    ]
    assert light_name(light_groups(est)[0]) == "Pendant light - Over the tub"
    one = lines([{"type": "recessed", "count": 1, "location": "In the shower"}])
    assert one["Recessed light installation (1 can) - In the shower"]["unit_price"] == pytest.approx(
        ELECTRICAL_RATES["recessed_light_install"] * MULT, abs=0.01)
