"""Reading a Xactimate item off a screenshot of its Item Activity Information
window: Claude's transcription becomes a price-list item whose cost fields add
up to the replace price, and an estimate line priced for the activity shown."""

from datetime import date
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.xactimate.screen_read import to_draft  # noqa: E402

# APP CT, + (Replace): electric cooktop, as the window shows it.
COOKTOP = {
    "is_item_window": True,
    "category": "APP",
    "selector": "CT",
    "activity": "+",
    "phase": "11 Appliances",
    "description": None,
    "unit": None,
    "material": 499.00,
    "equipment": 0.00,
    "retail_labor": 158.39,
    "market_conditions": 0.00,
    "replace_price": 657.39,
    "remove_price": None,
    "workers_wage": 35.20,
    "labor_burden": 14.76,
    "labor_overhead": 108.43,
    "components": [
        {"type": "Labor", "description": "Electrician", "price_per_unit": 158.39},
        {"type": "Material", "description": "Cooktop - electric", "price_per_unit": 499.0},
    ],
    "includes": "Cooktop and installation labor.",
    "excludes": None,
    "quality": 'Average grade, 4 elements, 30" cooktop.',
    "reference": None,
    "green": "LEED considers cooktops to be green if they are Energy Star rated.",
    "notes": None,
}


def test_cooktop_window_becomes_an_item():
    draft = to_draft(COOKTOP, today=date(2026, 11, 8))
    assert draft["item_code"] == "APPCT"
    assert draft["category_code"] == "APP"
    assert draft["activity_label"] == "Replace"
    assert (draft["price_year"], draft["price_month"]) == (2026, 11)
    assert draft["material_cost"] == 499.0
    assert draft["labor_cost"] == 35.2
    assert draft["labor_burden"] == 123.19
    # The stored costs add up to the replace price.
    total = draft["material_cost"] + draft["equipment_cost"] + draft["labor_cost"] + draft["labor_burden"] + draft["market_conditions"]
    assert round(total, 2) == 657.39
    assert draft["untaxed_unit_price"] == 657.39
    assert draft["unit_price"] == 657.39
    assert [c["component_type"] for c in draft["components"]] == ["lab", "mat"]
    assert draft["includes_description"] == "Cooktop and installation labor."
    assert draft["reference_description"].startswith("Green: LEED")


def test_hidden_description_falls_back_to_the_material_and_is_flagged():
    draft = to_draft(COOKTOP)
    assert draft["description"] == "Cooktop - electric"
    assert any("description" in w for w in draft["warnings"])
    assert not any("replace price reads" in w for w in draft["warnings"])


def test_numbers_that_dont_add_up_are_flagged():
    draft = to_draft({**COOKTOP, "description": "Cooktop - electric", "replace_price": 600.0})
    assert any("replace price reads 600.00" in w for w in draft["warnings"])


def test_remove_and_replace_prices_both_activities():
    draft = to_draft({**COOKTOP, "description": "Cooktop", "activity": "&", "remove_price": 41.25})
    assert draft["unit_price"] == 698.64
    assert draft["untaxed_unit_price"] == 657.39


def test_not_an_item_window():
    empty = {key: None for key in COOKTOP}
    empty.update({"is_item_window": False, "components": []})
    draft = to_draft(empty)
    assert draft["warnings"][0].startswith("This doesn't look like")
    assert draft["unit_price"] is None
