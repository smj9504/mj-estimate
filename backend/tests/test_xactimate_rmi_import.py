"""Detach & Reset / Material Only / Install Only prices and labor rates by trade
(scripts/xactimate_price_list: parse_reports.py, import_price_list.py)."""

import importlib.util
import json
from decimal import Decimal
from pathlib import Path

import pytest

_DIR = Path(__file__).resolve().parents[1] / "scripts" / "xactimate_price_list"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, _DIR / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


import_price_list = _load("import_price_list")

# CAB CTCON- Detach & Reset report (VAAR8X_NOV26) as pdfplumber extracts it.
CTCON_R = """1
Price List Item: CABCTCON- R 11/11/2026
Page: 1
Description:
Countertop - concrete - Standard grade
Assembly Information:
Type Component Cost Direct Yield SPT Event % Yield Unit Price
RLBR CARP-FNC 92.320 3.678 SF/HR 39.583 2.222 41.55
MATR MPRCLKST 12.480 117.060 SF/TB 10.000 105.354 0.12
Costs: Lab: 35.14 Mat: 0.12 Equ: 0.00 = 35.26
Labor Burden: 6.41
Market Conditions: 0.00
Untaxed Unit Price: 41.67
Definition:
No life expectancy data
"""


def test_detach_and_reset_report_keeps_its_activity():
    pytest.importorskip("pdfplumber")
    item = _load("parse_reports").parse_text(CTCON_R)
    assert (item["item_code"], item["activity"]) == ("CABCTCON-", "R")
    assert [(c["component_type"], c["activity"], c["component_code"], c["unit_price"]) for c in item["components"]] == [
        ("lab", "R", "CARP-FNC", 41.55), ("mat", "R", "MPRCLKST", 0.12),
    ]
    assert item["costs"]["untaxed_unit_price"] == 41.67
    assert item["checks"] == [] and item["unparsed"] == []


def _component(act, kind, code, price):
    return {"component_type": kind, "activity": act, "component_code": code, "cost": 1, "direct_yield": 1,
            "yield_unit": "SF/HR", "spt_event_percent": 0, "yield_value": 1, "unit_price": price}


def _report(code, act, price, comps):
    return {"item_code": code, "activity": act, "description": "x", "checks": [], "unparsed": [],
            "costs": {"lab": 0, "mat": 0, "equ": 0, "subtotal": 0, "labor_burden": 0,
                      "market_conditions": 0, "untaxed_unit_price": price},
            "definition": {}, "life": {}, "components": comps}


def _price_list(tmp_path):
    (tmp_path / "catalog").mkdir()
    (tmp_path / "categories.tsv").write_text("CAB\tCABINETRY\n", encoding="utf-8")
    (tmp_path / "catalog" / "CAB.tsv").write_text(
        "CTCON-\tCountertop - concrete - Standard grade\tSF\t+\t$95.17\tFalse\n"
        "AGRS\tCabinetry - appliance garage - reset\tEA\t+\t$122.25\tFalse\n"
        "LAB\tCabinet installer - per hour\tHR\t+\t$92.32\tFalse\n", encoding="utf-8")
    reports = [
        _report("CABCTCON-", "+", 95.17, [_component("+", "lab", "CARP-FNC", 44.29),
                                          _component("+", "mat", "CTCON-", 50.88)]),
        _report("CABAGRS", "+", 122.25, [_component("+", "lab", "CARP-FNC", 122.25)]),
        _report("CABLAB", "+", 92.32, [_component("+", "lab", "CARP-FNC", 92.32)]),
    ]
    (tmp_path / "parsed.jsonl").write_text("\n".join(json.dumps(r) for r in reports), encoding="utf-8")
    (tmp_path / "parsed_rmi.jsonl").write_text(json.dumps(_report("CABCTCON-", "R", 41.67, [
        _component("R", "lab", "CARP-FNC", 41.55), _component("R", "mat", "MPRCLKST", 0.12)])), encoding="utf-8")
    # as rmi.ps1 writes it: a failed read, then the good one; AGRS only installs; LAB offers none
    (tmp_path / "rmi_index.tsv").write_text(
        "CAB\tCTCON-\t\t\t\t\terror: no window\t2026-11-11T12:25:30\t9.0\n"
        "CAB\tCTCON-\tRMI\t41.67\t50.88\t44.29\tok\t2026-11-11T12:25:43\t8.3\n"
        "CAB\tAGRS\tI\t\t\t122.25\tok\t2026-11-11T12:36:30\t3.3\n"
        "CAB\tLAB\t\t\t\t\tok\t2026-11-11T12:36:33\t1.1\n", encoding="utf-8")


def test_items_get_their_other_activities_and_prices(tmp_path):
    _price_list(tmp_path)
    _, items, problems, notes, _, _ = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    by_code = {i["item_code"]: i for i in items}

    ctcon = by_code["CABCTCON-"]
    assert ctcon["other_activities"] == "RMI"
    assert (ctcon["detach_reset_price"], ctcon["material_only_price"], ctcon["install_only_price"]) == (
        Decimal("41.67"), Decimal("50.88"), Decimal("44.29"))
    # Detach & Reset's own components join the replace ones
    assert [(c["activity"], c["component_code"], c["unit_price"]) for c in ctcon["components"]] == [
        ("+", "CARP-FNC", Decimal("44.29")), ("+", "CTCON-", Decimal("50.88")),
        ("R", "CARP-FNC", Decimal("41.55")), ("R", "MPRCLKST", Decimal("0.12")),
    ]

    agrs = by_code["CABAGRS"]
    assert agrs["other_activities"] == "I"
    assert (agrs["detach_reset_price"], agrs["material_only_price"], agrs["install_only_price"]) == (
        None, None, Decimal("122.25"))
    assert by_code["CABLAB"]["other_activities"] == ""  # read: offers none
    assert problems["with R/M/I"] == 3 and not problems["R/M/I to look at"]


def test_detach_and_reset_without_a_matching_report_keeps_the_price_only(tmp_path):
    _price_list(tmp_path)
    (tmp_path / "parsed_rmi.jsonl").write_text(json.dumps(_report("CABCTCON-", "R", 40.00, [
        _component("R", "lab", "CARP-FNC", 40.00)])), encoding="utf-8")
    _, items, problems, notes, _, _ = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    ctcon = next(i for i in items if i["item_code"] == "CABCTCON-")
    assert ctcon["detach_reset_price"] == Decimal("41.67")
    assert not any(c["activity"] == "R" for c in ctcon["components"])
    assert problems["R/M/I to look at"] == 1
    assert any(n.startswith("CABCTCON-: R/M/I") and "vs report" in n for n in notes)


def test_without_rmi_files_items_stay_unread(tmp_path):
    _price_list(tmp_path)
    (tmp_path / "rmi_index.tsv").unlink()
    _, items, problems, _, _, _ = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    assert all(i["other_activities"] is None and i["detach_reset_price"] is None for i in items)
    assert not problems["with R/M/I"]


def test_labor_rates_by_trade(tmp_path):
    head = ("trade\tcategory\tselector\tside\tlabor_per_unit\trate_per_hour\twage_per_unit\tburden_per_unit\t"
            "overhead_per_unit\tretail\twage_per_hour\tburden_per_hour\toverhead_per_hour\tstatus\tseconds\n")
    (tmp_path / "labor_trades.tsv").write_text(
        head
        + "CARP-FNC\tAPP\tRFBIXRS\t+\t854.81\t92.32\t295.09\t131.85\t427.87\t\t31.87\t14.24\t46.21\tok\t4.7\n"
        + "CARP-FNC\tCAB\tIHRS\t+\t820.63\t92.32\t283.29\t126.58\t410.76\t\t31.87\t14.24\t46.21\tok\t3.7\n"
        + "DMO\tDMO\tLAB\t+\t55.43\t55.43\t23.37\t11.39\t20.67\t\t23.37\t11.39\t20.67\tok\t3.9\n"
        + "ELE\tELE\tLAB\t+\t150.70\t150.70\t35.30\t14.72\t90.00\t\t35.30\t14.72\t90.00\tok\t4.0\n"
        + "PM\tLAB\tPM\t+\t\t\t\t\t\t\t\t\t\terror: no trade\t1.0\n", encoding="utf-8")
    (tmp_path / "details.jsonl").write_text(json.dumps({"item_code": "CABIHRS", "sides": [{"side": "replace", "components": [
        {"code": "CARP-FNC", "kind": "lab", "description": "Carpenter - Finish, Trim/Cabinet"}]}]}), encoding="utf-8")

    rates, notes = import_price_list.read_labor_rates(tmp_path, "VAAR8X_NOV26")
    assert [r["trade"] for r in rates] == ["CARP-FNC", "DMO"]  # ELE's parts don't add up
    fnc = rates[0]
    assert fnc["description"] == "Carpenter - Finish, Trim/Cabinet"
    assert (fnc["rate_per_hour"], fnc["wage_per_hour"], fnc["burden_per_hour"], fnc["overhead_per_hour"]) == (
        Decimal("92.32"), Decimal("31.87"), Decimal("14.24"), Decimal("46.21"))
    assert (fnc["price_year"], fnc["price_month"], fnc["sample_item_code"]) == (2026, 11, "APPRFBIXRS")
    assert rates[1]["description"] is None
    assert len(notes) == 1 and notes[0].startswith("labor ELE")


def test_api_shows_detach_and_reset_components_and_new_prices():
    from app.domains.xactimate.schemas import XactimateComponentResponse, XactimateItemResponse
    comp = XactimateComponentResponse(id=1, item_id=1, component_type="lab", activity="R",
                                      component_code="CARP-FNC", unit_price=Decimal("41.55"))
    item = XactimateItemResponse(id=1, item_code="CABCTCON-", category_code="CAB", description="Countertop",
                                 price_year=2026, price_month=11, untaxed_unit_price=Decimal("95.17"),
                                 other_activities="RMI", detach_reset_price=Decimal("41.67"),
                                 material_only_price=Decimal("50.88"), install_only_price=Decimal("44.29"),
                                 components=[comp])
    assert item.components[0].activity == "R"
    assert item.detach_reset_price == Decimal("41.67")
