"""Reading Xactimate's Price List Item Report (scripts/xactimate_price_list/parse_reports.py)."""

import importlib.util
from pathlib import Path

import pytest

pytest.importorskip("pdfplumber")

_PATH = Path(__file__).resolve().parents[1] / "scripts" / "xactimate_price_list" / "parse_reports.py"
_spec = importlib.util.spec_from_file_location("parse_reports", _PATH)
parse_reports = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(parse_reports)

# Text of a real report (CAB AG, VAAR8X_NOV26) as pdfplumber extracts it.
CABAG = """1
Price List Item: CABAG & 11/8/2026
Page: 1
Description:
Cabinetry - appliance garage
Assembly Information:
Type Component Cost Direct Yield SPT Event % Yield Unit Price
RLB+ CARP-FNC 92.320 2.000 EA/HR 39.583 1.208 76.41
MAT+ CABAG 147.231 1.000 EA/EA 0.000 1.000 147.23
RLB- DMO 55.430 4.500 EA/HR 39.583 2.719 20.39
Costs: Lab: 80.82 Mat: 147.23 Equ: 0.00 = 228.05
Labor Burden: 15.98
Market Conditions: 0.00
Untaxed Unit Price: 244.03
Definition:
Includes: Factory built, pre-finished (stained, painted, etc.) cabinet and installation labor. Labor cost to remove
an appliance garage cabinet and to discard in a job-site waste receptacle.
Quality: Average grade particleboard box construction with simulated wood grain veneer on interior. Recessed
panel or tambour doors, and face frames of hardwood construction. Hardware consists of concealed hinges.
Average life expectancy 50 years
Average depreciation 2% per year
Maximum depreciation 100%
"""


def test_report_becomes_an_item():
    item = parse_reports.parse_text(CABAG)
    assert item["item_code"] == "CABAG"
    assert item["activity"] == "&"
    assert item["description"] == "Cabinetry - appliance garage"
    assert item["costs"] == {
        "lab": 80.82, "mat": 147.23, "equ": 0.0, "subtotal": 228.05,
        "labor_burden": 15.98, "market_conditions": 0.0, "untaxed_unit_price": 244.03,
    }
    assert item["life"] == {"years": 50, "rate": 2.0, "max": 100.0}
    assert item["checks"] == []
    assert item["unparsed"] == []


def test_replace_and_remove_components_keep_their_activity():
    comps = parse_reports.parse_text(CABAG)["components"]
    assert [(c["component_type"], c["activity"], c["component_code"]) for c in comps] == [
        ("lab", "+", "CARP-FNC"), ("mat", "+", "CABAG"), ("lab", "-", "DMO"),
    ]
    labor = comps[0]
    assert labor["cost"] == 92.32 and labor["direct_yield"] == 2.0 and labor["yield_unit"] == "EA/HR"
    assert labor["spt_event_percent"] == 39.583 and labor["yield_value"] == 1.208 and labor["unit_price"] == 76.41


def test_definition_lines_are_joined():
    d = parse_reports.parse_text(CABAG)["definition"]
    assert d["includes"].endswith("discard in a job-site waste receptacle.")
    assert "Recessed panel or tambour doors" in d["quality"]


def test_numbers_that_dont_add_up_are_flagged():
    item = parse_reports.parse_text(CABAG.replace("Untaxed Unit Price: 244.03", "Untaxed Unit Price: 254.03"))
    assert "subtotal+burden+market != unit price" in item["checks"]


def test_long_component_codes_wrapped_onto_their_own_line_are_rejoined():
    text = """Price List Item: DMOTREE< - 11/8/2026
Page: 1
Description:
Tree - tear out and disposal - under 12" diameter
Assembly Information:
Type Component Cost Direct Yield SPT Event % Yield Unit Price
RLB- DMO 55.430 0.410 EA/HR 39.583 0.248 223.76
EQU- DMOCHIPPER 500.000 6.000 EA/DA 0.000 6.000 83.33
EQU- DMOCHIPTRU 733.600 4.800 EA/DA 0.000 4.800 152.83
K
EQU- EQUBKTRUK 560.570 12.000 EA/DA 0.000 12.000 46.71
Costs: Lab: 177.78 Mat: 0.00 Equ: 282.88 = 460.66
Labor Burden: 45.98
Market Conditions: 0.00
Untaxed Unit Price: 506.64
"""
    item = parse_reports.parse_text(text)
    assert [c["component_code"] for c in item["components"]] == ["DMO", "DMOCHIPPER", "DMOCHIPTRUK", "EQUBKTRUK"]
    assert item["activity"] == "-"
    assert item["unparsed"] == [] and item["checks"] == []


def test_second_page_number_and_repeated_header_are_skipped():
    two_pages = CABAG.replace(
        "Labor Burden: 15.98\n",
        "Labor Burden: 15.98\n2\nPrice List Item: CABAG & 11/8/2026\nPage: 2\n",
    )
    item = parse_reports.parse_text(two_pages)
    assert item["unparsed"] == [] and item["checks"] == []
    assert item["costs"]["market_conditions"] == 0.0


def test_no_life_expectancy_data_is_not_a_problem():
    text = CABAG.split("Definition:")[0] + "Definition:\nNo life expectancy data\n"
    item = parse_reports.parse_text(text)
    assert item["unparsed"] == [] and item["life"] == {}


def test_unknown_lines_are_kept():
    item = parse_reports.parse_text(CABAG.replace("Labor Burden: 15.98", "Labor Burden: 15.98\nSomething new: 1"))
    assert item["unparsed"] == ["Something new: 1"]
