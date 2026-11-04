"""The plumber AI report starts from the source of the leak: the model lays
out the whole repair across every trade, code keeps the plumber's steps, and
the report and invoice are written from those steps only."""

from pathlib import Path
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.plumber_report import ai_service  # noqa: E402
from app.domains.plumber_report.api import AIGenerateRequest  # noqa: E402


PLAN = {
    "failed_component": "hot-water supply line feeding the shower valve, inside the shower wall",
    "line_type": "supply",
    "pipe_material": "",
    "access": {"surface": "tile", "where": "shower valve wall", "opening": "1.5' x 1.5'"},
    "fixture_detached": "",
    "fixture_reset_by_plumber": False,
    "protection_needed": "yes",
    "hours_estimate": "3.5",
    "steps": [
        {"trade": "plumber", "task": "Isolate the water supply to the shower"},
        {"trade": "Plumber", "task": "Cut a 1.5' x 1.5' tile opening at the valve wall"},
        {"trade": "water mitigation", "task": "Open and dry the 1st floor ceiling below"},
        {"trade": "plumbing", "task": "Replace the failed supply line section"},
        {"trade": "tile", "task": "Rebuild backer board and tile at the opening"},
        {"trade": "painter", "task": "Paint the repaired ceiling below"},
    ],
    "materials": [
        {"item": "Type L copper pipe", "quantity": "1.5 ft"},
        {"item": "copper repair couplings", "quantity": "2"},
        {"item": "plastic sheeting and tape"},
    ],
}
REPORT = {"site_findings": "s", "work_performed": "w", "warranty_info": "x", "notes": "n"}
INVOICE = {"invoice_items": [
    {"name": "Emergency Dispatch Fee", "quantity": 1, "unit": "EA", "unit_cost": 150},
    {"name": "Labor - Access", "quantity": 2, "unit": "HR", "unit_cost": 99},
    {"name": "Materials", "quantity": 1, "unit": "LOT", "unit_cost": 100},
]}


@pytest.mark.parametrize("floor, expected", [
    ("Basement", 0), ("lower level", 0), ("1st floor", 1), ("2nd floor", 2),
    ("3rd Floor", 3), ("second floor", 2), ("Main floor", 1), ("attic", None),
])
def test_floor_number(floor, expected):
    assert ai_service._floor_number(floor) == expected


@pytest.mark.parametrize("floor, reached, expected", [
    ("2nd floor", True, "1st floor ceiling directly below the master bathroom"),
    ("3rd floor", True, "2nd floor ceiling directly below the master bathroom"),
    ("1st floor", True, "basement ceiling directly below the master bathroom"),
    ("Basement", True, "none reported"),
    ("2nd floor", False, "none reported"),
    ("attic", True, "ceiling of the level directly below the master bathroom"),
])
def test_areas_below(floor, reached, expected):
    assert ai_service._areas_below(floor, "master bathroom", reached) == expected


def test_plan_keeps_only_plumber_steps():
    plan = ai_service._normalize_plan(PLAN, "")
    assert plan["plumber_steps"] == [
        "Isolate the water supply to the shower",
        "Cut a 1.5' x 1.5' tile opening at the valve wall",
        "Replace the failed supply line section",
    ]
    assert [s["trade"] for s in plan["other_trades"]] == ["water mitigation", "tile", "painter"]


def test_plan_without_plumber_steps_is_rejected():
    assert not ai_service._plan_has_plumber_steps({"steps": [{"trade": "tile", "task": "x"}]})
    assert not ai_service._plan_has_plumber_steps({"steps": "plumber"})
    assert ai_service._plan_has_plumber_steps(PLAN)


def test_given_pipe_material_wins_over_the_model():
    plan = ai_service._normalize_plan({**PLAN, "pipe_material": "PEX"}, "Type L copper", photos_sent=True)
    assert plan["pipe_material"] == "Type L copper"


def test_model_pipe_material_counts_only_when_it_saw_photos():
    raw = {**PLAN, "pipe_material": "braided stainless"}
    assert ai_service._normalize_plan(raw, "", photos_sent=True)["pipe_material"] == "braided stainless"
    assert ai_service._normalize_plan(raw, "", photos_sent=False)["pipe_material"] == ""


@pytest.mark.parametrize("fixture, kept", [
    ("toilet", "toilet"), ("wall-hung toilet", "wall-hung toilet"), ("vanity", "vanity"),
    ("shower tile", ""), ("drywall", ""), ("none", ""), ("", ""),
])
def test_a_cut_surface_is_never_a_detached_fixture(fixture, kept):
    plan = ai_service._normalize_plan({**PLAN, "fixture_detached": fixture, "fixture_reset_by_plumber": True}, "")
    assert plan["fixture_detached"] == kept
    assert plan["fixture_reset_by_plumber"] == bool(kept)


def test_nothing_cut_means_no_opening_size():
    plan = ai_service._normalize_plan(
        {**PLAN, "access": {"surface": "Under-sink cabinet", "where": "kitchen sink", "opening": "1' x 1'"}}, ""
    )
    assert plan["access"]["opening"] == ""
    assert ai_service._access_text(plan["access"]) == "under-sink cabinet, kitchen sink (nothing cut open)"


def test_unreadable_hours_fall_back():
    assert ai_service._normalize_plan({**PLAN, "hours_estimate": "about 3"}, "")["hours_estimate"] == "3"
    assert ai_service._normalize_plan({**PLAN, "hours_estimate": 2.50}, "")["hours_estimate"] == "2.5"


@pytest.mark.parametrize("text, expected", [
    ("cold-water angle stop valve under the sink", "angle stop valve under the sink"),
    ("Replace the cold water supply line", "Replace the supply line"),
    ("cold/hot water supply line feeding the shower valve", "supply line feeding the shower valve"),
    ("hot and cold supply lines", "supply lines"),
    ("Cut out the hot water line", "Cut out the water line"),
    ("Isolate the hot-water side valve", "Isolate the valve"),
    ("hot-water heater relief line", "hot-water heater relief line"),
    ("water supply line to the shower", "water supply line to the shower"),
])
def test_water_side_is_dropped(text, expected):
    assert ai_service._drop_water_side(text) == expected


def test_water_side_stays_when_photos_were_sent():
    raw = {**PLAN, "failed_component": "cold-water stop valve",
           "steps": [{"trade": "plumber", "task": "Replace the cold-water stop valve"}],
           "materials": [{"item": "cold-water stop valve", "quantity": "1"}]}
    without = ai_service._normalize_plan(raw, "", photos_sent=False)
    assert without["failed_component"] == "stop valve"
    assert without["plumber_steps"] == ["Replace the stop valve"]
    assert without["materials"] == ["1 stop valve"]
    assert ai_service._normalize_plan(raw, "", photos_sent=True)["failed_component"] == "cold-water stop valve"


def test_materials_read_as_quantity_and_item():
    plan = ai_service._normalize_plan(PLAN, "")
    assert plan["materials"] == [
        "1.5 ft Type L copper pipe", "2 copper repair couplings", "plastic sheeting and tape",
    ]
    assert ai_service._normalize_plan({**PLAN, "materials": None}, "")["materials"] == []


@pytest.mark.parametrize("quantities, total, expected", [
    ([1.75, 2.0], 3.5, [1.75, 1.75]),   # 3.75 billed against a 3.5-hour plan
    ([0.5, 0.5], 1.0, [0.5, 0.5]),      # already right
    ([0.4, 0.85, 0.25], 1.5, [0.5, 0.75, 0.25]),
    ([0, 0], 2.0, [1.0, 1.0]),          # no hours at all: split evenly
])
def test_labor_lines_add_up_to_the_plan_hours(quantities, total, expected):
    items = [{"unit": "EA", "quantity": 1}] + [{"unit": "HR", "quantity": q} for q in quantities]
    ai_service._fit_labor_hours(items, total)
    hours = [item["quantity"] for item in items if item["unit"] == "HR"]
    assert hours == expected
    assert sum(hours) == total
    assert items[0]["quantity"] == 1


def _fake_ai(calls):
    def fake(prompt, required_key, strong=False, max_rounds=2, images=None, validate=None):
        calls.append((required_key, prompt))
        if required_key == "steps":
            assert validate is not None and validate(PLAN)
            return PLAN
        return REPORT if required_key == "work_performed" else INVOICE
    return fake


def test_report_and_invoice_are_written_from_the_plumber_steps(monkeypatch):
    calls = []
    monkeypatch.setattr(ai_service, "_call_ai_json", _fake_ai(calls))
    result = ai_service.generate_plumber_report(
        floor="2nd floor", room="master bathroom", fixture="shower",
        component="water line", state="MD", reached_floor_below=True,
    )
    prompts = dict(calls)
    assert set(prompts) == {"steps", "work_performed", "invoice_items"}

    plan_prompt = prompts["steps"]
    assert "**Leaking part:** water line" in plan_prompt
    assert "Yes: it reached the 1st floor ceiling directly below the master bathroom." in plan_prompt

    report_prompt = prompts["work_performed"]
    steps_part, others_part = report_prompt.split("## LEFT FOR OTHER TRADES", 1)
    assert "  3. Replace the failed supply line section" in steps_part
    assert "Open and dry the 1st floor ceiling below" not in steps_part
    assert "- water mitigation: Open and dry the 1st floor ceiling below" in others_part
    assert "1st floor ceiling directly below the master bathroom" in report_prompt
    assert "tile, shower valve wall (opening approx. 1.5' x 1.5')" in report_prompt

    invoice_prompt = prompts["invoice_items"]
    assert "Replace the failed supply line section" in invoice_prompt
    assert "Rebuild backer board and tile" not in invoice_prompt
    assert "Paint the repaired ceiling" not in invoice_prompt
    assert "- 2 copper repair couplings\n- plastic sheeting and tape" in invoice_prompt

    # labor is the fixed rate for exactly the plan's hours; MD taxes materials at 6%
    assert result["invoice_items"][1]["unit_cost"] == ai_service.LABOR_RATE
    assert result["invoice_items"][1]["quantity"] == 3.5
    assert result["subtotal"] == 150 + 3.5 * ai_service.LABOR_RATE + 100
    assert result["tax_amount"] == 6.0
    assert result["repair_plan"]["plumber_steps"][0] == "Isolate the water supply to the shower"


def test_no_floor_below_says_none_reported(monkeypatch):
    calls = []
    monkeypatch.setattr(ai_service, "_call_ai_json", _fake_ai(calls))
    ai_service.generate_plumber_report(
        floor="1st floor", room="kitchen", fixture="sink", component="valve",
        state="VA", reached_floor_below=False,
    )
    prompts = dict(calls)
    assert "**Did the water reach the floor below?** No." in prompts["steps"]
    assert "**Other areas the water reached (floors below):** none reported" in prompts["work_performed"]


def test_failed_plan_returns_none(monkeypatch):
    monkeypatch.setattr(ai_service, "_call_ai_json", lambda *a, **k: None)
    assert ai_service.generate_plumber_report(
        floor="2nd floor", room="bath", fixture="toilet", component="supply line", state="DC",
    ) is None


def test_request_needs_the_source():
    base = {"floor": "2nd floor", "room": "master bathroom", "component": "water line", "state": "md"}
    assert AIGenerateRequest(**base).state == "MD"
    for field in ("floor", "room", "component"):
        with pytest.raises(ValidationError):
            AIGenerateRequest(**{**base, field: "  "})
