"""Replace / remove prices of a price list item (scripts/xactimate_price_list/import_price_list.py)."""

import importlib.util
from decimal import Decimal
from pathlib import Path

_PATH = Path(__file__).resolve().parents[1] / "scripts" / "xactimate_price_list" / "import_price_list.py"
_spec = importlib.util.spec_from_file_location("import_price_list", _PATH)
import_price_list = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(import_price_list)
split_prices = import_price_list.split_prices

# CAB AG (VAAR8X_NOV26): Xactimate shows Replace Price $223.64 for "+", the & report $244.03.
CABAG = [
    {"activity": "+", "unit_price": Decimal("76.41")},
    {"activity": "+", "unit_price": Decimal("147.23")},
    {"activity": "-", "unit_price": Decimal("20.39")},
]


def test_remove_and_replace_item_splits_into_its_activities():
    assert split_prices("&", Decimal("244.03"), CABAG) == (Decimal("223.64"), Decimal("20.39"))


def test_without_xactimate_split_market_conditions_fall_on_replace_and_parts_add_up():
    # The report's market conditions total isn't split; the importer prefers
    # Xactimate's own split (split_prices.tsv) and only falls back to this.
    comps = [{"activity": "+", "unit_price": Decimal("3.78")}, {"activity": "-", "unit_price": Decimal("0.40")}]
    replace, remove = split_prices("&", Decimal("4.20"), comps)
    assert remove == Decimal("0.40") and replace == Decimal("3.80")
    assert replace + remove == Decimal("4.20")


def test_replace_only_and_remove_only_items():
    assert split_prices("+", Decimal("12.50"), []) == (Decimal("12.50"), None)
    assert split_prices("-", Decimal("3.10"), []) == (None, Decimal("3.10"))


def _report(code, total, mc, comps):
    return {
        "item_code": code, "activity": "&", "description": code, "checks": [], "unparsed": [],
        "costs": {"lab": 0, "mat": 0, "equ": 0, "subtotal": 0, "labor_burden": 0,
                  "market_conditions": mc, "untaxed_unit_price": total},
        "definition": {}, "life": {},
        "components": [{"component_type": "lab", "activity": a, "component_code": "X", "cost": 1,
                        "direct_yield": 1, "yield_unit": "EA/HR", "spt_event_percent": 0,
                        "yield_value": 1, "unit_price": p} for a, p in comps],
    }


def test_import_takes_xactimate_split_where_market_conditions_hide_it(tmp_path):
    import json
    (tmp_path / "catalog").mkdir()
    (tmp_path / "categories.tsv").write_text("DRY\tDRYWALL\n", encoding="utf-8")
    (tmp_path / "catalog" / "DRY.tsv").write_text(
        "1/2\t1/2\" drywall\tSF\t&\t$3.80\tFalse\n1/2WR\tgreenboard\tSF\t&\t$3.56\tFalse\n", encoding="utf-8")
    reports = [
        # DRY 1/2: + 3.27, - 0.52, market conditions 0.02 - Xactimate: replace 3.26, remove 0.54
        _report("DRY1/2", 3.80, 0.02, [("+", 3.27), ("-", 0.52)]),
        _report("DRY1/2WR", 3.56, 0.09, [("+", 2.96), ("-", 0.52)]),
    ]
    (tmp_path / "parsed.jsonl").write_text("\n".join(json.dumps(r) for r in reports), encoding="utf-8")
    (tmp_path / "split_prices.tsv").write_text("DRY\t1/2\tok\t$3.26\t$0.54\t1/2\" drywall\n", encoding="utf-8")

    _, items, problems, notes, _, _ = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    by_code = {i["item_code"]: i for i in items}
    assert (by_code["DRY1/2"]["replace_price"], by_code["DRY1/2"]["remove_price"]) == (Decimal("3.26"), Decimal("0.54"))
    # No Xactimate split read for this one: falls back, and says so
    assert by_code["DRY1/2WR"]["replace_price"] + by_code["DRY1/2WR"]["remove_price"] == Decimal("3.56")
    assert problems["& split guessed (market conditions, no Xactimate split)"] == 1
    assert any(n.startswith("DRY1/2WR: market conditions") for n in notes)


def test_import_puts_item_window_details_on_items_and_components(tmp_path):
    import json
    (tmp_path / "catalog").mkdir()
    (tmp_path / "categories.tsv").write_text("CAB\tCABINETRY\n", encoding="utf-8")
    (tmp_path / "catalog" / "CAB.tsv").write_text(
        "AG\tCabinetry - appliance garage\tEA\t&\t$244.03\tFalse\n", encoding="utf-8")
    rep = _report("CABAG", 244.03, 0.0, [("+", 76.41), ("+", 147.23), ("-", 20.39)])
    for c, code, kind in zip(rep["components"], ["CARP-FNC", "CABAG", "DMO"], ["lab", "mat", "lab"]):
        c["component_code"], c["component_type"] = code, kind
    (tmp_path / "parsed.jsonl").write_text(json.dumps(rep), encoding="utf-8")
    # as details.ps1 writes it (CAB AG, read 2026-11-09)
    det = {
        "category": "CAB", "selector": "AG", "item_code": "CABAG", "status": "ok",
        "replace_price": 223.64, "remove_price": 20.39, "minimum_group": "CABMN-A",
        "sides": [
            {"side": "replace", "phase": "06 Finish Carpentrv", "market_conditions": 0, "components": [
                {"code": "CARP-FNC", "description": "Carpenter - Finish, Trim/Cabinet", "event": "CAB-LAB"},
                {"code": "CABAG", "description": "Cabinetry - appl. garage - picture-frame or tambour doors"}]},
            {"side": "remove", "phase": "02 Demolition", "market_conditions": 0, "components": [
                {"code": "DMO", "description": "Demolition Laborer", "event": "DMO2-LAB"}]},
        ],
    }
    other = [{"item_code": f"X{i}", "sides": [{"side": "replace", "phase": "06 Finish Carpentry"}]} for i in range(3)]
    (tmp_path / "details.jsonl").write_text("\n".join(json.dumps(d) for d in [det] + other), encoding="utf-8")
    (tmp_path / "details_event_texts.tsv").write_text(
        "CAB-LAB\tLabor assumption is based on an 8 hour day\n", encoding="utf-8")

    _, items, problems, notes, _, events = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    item = items[0]
    assert item["minimum_group"] == "CABMN-A"
    assert item["replace_phase"] == "06 Finish Carpentry"   # OCR slip mapped to the usual reading
    assert item["remove_phase"] == "02 Demolition"
    assert item["replace_market_conditions"] == Decimal("0.00")
    by_code = {c["component_code"]: c for c in item["components"]}
    assert by_code["CARP-FNC"]["description"] == "Carpenter - Finish, Trim/Cabinet"
    assert by_code["CARP-FNC"]["supporting_event"] == "CAB-LAB"
    assert by_code["CABAG"]["supporting_event"] is None
    assert by_code["DMO"]["supporting_event"] == "DMO2-LAB"
    assert events == {"CAB-LAB": "Labor assumption is based on an 8 hour day"}
    assert problems["with details"] == 1 and not problems["details not matching the report"]


def test_unknown_split_is_left_empty():
    assert split_prices("&", Decimal("10"), []) == (None, None)  # no report to split by
    assert split_prices(None, Decimal("10"), CABAG) == (None, None)
    assert split_prices("&", None, CABAG) == (None, None)
