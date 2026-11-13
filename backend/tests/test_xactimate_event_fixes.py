"""Supporting event codes in the Xactimate price list import
(scripts/xactimate_price_list/import_price_list.py): what details.ps1 settled per
(category, side, component, SPT %), and codes read by eye where OCR missed or misread them."""

import importlib.util
import json
from pathlib import Path

_DIR = Path(__file__).resolve().parents[1] / "scripts" / "xactimate_price_list"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, _DIR / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


import_price_list = _load("import_price_list")


def _component(act, kind, code, price, spt):
    return {"component_type": kind, "activity": act, "component_code": code, "cost": 1, "direct_yield": 1,
            "yield_unit": "SF/HR", "spt_event_percent": spt, "yield_value": 1, "unit_price": price}


def _report(code, comps):
    price = round(sum(c["unit_price"] for c in comps), 2)
    return {"item_code": code, "activity": "+", "description": "x", "checks": [], "unparsed": [],
            "costs": {"lab": 0, "mat": 0, "equ": 0, "subtotal": 0, "labor_burden": 0,
                      "market_conditions": 0, "untaxed_unit_price": price},
            "definition": {}, "life": {}, "components": comps}


def _details(code, sel, rows):
    return {"category": "FRM", "selector": sel, "item_code": code, "minimum_group": None, "status": "ok",
            "sides": [{"side": "replace", "checks": [], "phase": "06 Framing", "market_conditions": 0,
                       "components": [{"code": c, "kind": "mat", "description": c, "event": ev} for c, ev in rows]}]}


def _price_list(tmp_path, fixed=None, renames=None):
    (tmp_path / "catalog").mkdir()
    (tmp_path / "categories.tsv").write_text("FRM\tFRAMING\n", encoding="utf-8")
    (tmp_path / "catalog" / "FRM.tsv").write_text(
        "SHW\tSheathing - plywood\tSF\t+\t$3.00\tFalse\n"
        "SHW+\tSheathing - plywood - premium\tSF\t+\t$3.50\tFalse\n", encoding="utf-8")
    reports = [
        _report("FRMSHW", [_component("+", "lab", "CARP-FRM", 1.00, 0),
                           _component("+", "mat", "FRMSHW3/4T", 2.00, 10)]),
        _report("FRMSHW+", [_component("+", "lab", "CARP-FRM", 1.00, 0),
                            _component("+", "mat", "FRMSHW3/4TW", 1.50, 10),
                            _component("+", "mat", "NAIL", 1.00, 5)]),
    ]
    (tmp_path / "parsed.jsonl").write_text("\n".join(json.dumps(r) for r in reports), encoding="utf-8")
    # FRMSHW: the reader settled the event as RMSH (F dropped). FRMSHW+: the sheathing row was
    # misread the same way, and its nails weren't read there but were settled by a later item.
    (tmp_path / "details.jsonl").write_text("\n".join(json.dumps(d) for d in [
        _details("FRMSHW", "SHW", [("CARP-FRM", ""), ("FRMSHW3/4T", "RMSH")]),
        _details("FRMSHW+", "SHW+", [("CARP-FRM", ""), ("FRMSHW3/4TW", "RMSH"), ("NAIL", "")]),
    ]), encoding="utf-8")
    (tmp_path / "details_events.tsv").write_text(
        "FRM\t+\tFRMSHW3/4T\t10.000\tRMSH\n"
        "FRM\t+\tFRMSHW3/4TW\t10.000\tRMSH\n"
        "FRM\t+\tNAIL\t5.000\tNAIL\n", encoding="utf-8")
    (tmp_path / "details_event_texts.tsv").write_text(
        "RMSH\tSheathing assumption is based on waste due primarily to: cutting and fitting.\n"
        "NAIL\tNail assumption is based on waste.\n", encoding="utf-8")
    if fixed is not None:
        (tmp_path / "details_events_fixed.tsv").write_text(fixed, encoding="utf-8")
    if renames is not None:
        (tmp_path / "details_event_renames.tsv").write_text(renames, encoding="utf-8")


def _events(items):
    return {(i["item_code"], c["component_code"]): c["supporting_event"] for i in items for c in i["components"]}


def test_an_event_settled_by_a_later_item_fills_an_earlier_gap(tmp_path):
    _price_list(tmp_path)
    _, items, problems, notes, _, texts = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    ev = _events(items)
    assert ev[("FRMSHW+", "NAIL")] == "NAIL"
    assert ev[("FRMSHW", "CARP-FRM")] is None          # SPT 0: no event
    assert ev[("FRMSHW", "FRMSHW3/4T")] == "RMSH"       # no fix: as read
    assert problems["components with a supporting event % but no event code"] == 0
    assert texts["RMSH"].startswith("Sheathing")


def test_a_misread_code_is_renamed_everywhere_and_its_text_follows(tmp_path):
    _price_list(tmp_path, renames="RMSH\tFRMSH\tF dropped by OCR\n")
    _, items, problems, _, _, texts = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    ev = _events(items)
    assert ev[("FRMSHW", "FRMSHW3/4T")] == "FRMSH"
    assert ev[("FRMSHW+", "FRMSHW3/4TW")] == "FRMSH"
    assert ev[("FRMSHW+", "NAIL")] == "NAIL"
    # the text was read from the same window: it goes with the right code
    assert texts["FRMSH"].startswith("Sheathing")
    assert texts["RMSH"] is None
    assert problems["supporting event codes without a text"] == 0


def test_a_fix_for_one_item_leaves_the_others_sharing_its_key(tmp_path):
    # the same component and % is underlayment in one item, sheathing in the rest
    _price_list(tmp_path,
                fixed="FRM\t+\tFRMSHW3/4TW\t10\tFRMUL\tSHW+\tpicture\n",
                renames="RMSH\tFRMSH\tF dropped by OCR\n")
    _, items, problems, notes, _, texts = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    ev = _events(items)
    assert ev[("FRMSHW+", "FRMSHW3/4TW")] == "FRMUL"
    assert ev[("FRMSHW", "FRMSHW3/4T")] == "FRMSH"
    # a different event, not a misread one: the sheathing text isn't copied to it
    assert "FRMUL" not in texts
    assert problems["supporting event codes without a text"] == 1
    assert "supporting events without a text: FRMUL" in notes


def test_a_fix_for_a_key_covers_every_item_of_the_category(tmp_path):
    _price_list(tmp_path, fixed="FRM\t+\tNAIL\t5.000\tNAIL-2\t\tpicture\n")
    _, items, _, _, _, _ = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    assert _events(items)[("FRMSHW+", "NAIL")] == "NAIL-2"


def test_a_misread_code_still_used_elsewhere_is_kept(tmp_path):
    _price_list(tmp_path, fixed="FRM\t+\tFRMSHW3/4T\t10.000\tFRMSH\t\tpicture\n")
    _, items, _, _, _, texts = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    assert _events(items)[("FRMSHW+", "FRMSHW3/4TW")] == "RMSH"
    assert texts["RMSH"].startswith("Sheathing")


def test_an_unread_event_is_counted(tmp_path):
    _price_list(tmp_path)
    (tmp_path / "details_events.tsv").write_text("FRM\t+\tFRMSHW3/4T\t10.000\tRMSH\n", encoding="utf-8")
    _, items, problems, notes, _, _ = import_price_list.build(tmp_path, "VAAR8X_NOV26")
    # FRMSHW+'s sheathing still takes the row's own read; its nails have nothing
    assert _events(items)[("FRMSHW+", "NAIL")] is None
    assert problems["components with a supporting event % but no event code"] == 1
    assert any(n.startswith("FRMSHW+: 1 supporting event") for n in notes)
