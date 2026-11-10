"""Plastic floor protection: sketch strips to scope items, PDF rows, invoice mapping, migration."""
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.domains.water_mitigation import invoice_config_service
from app.domains.water_mitigation.floor_protection import (
    FLOOR_PROTECTION_SCOPE_NAMES,
    floor_protection_scope_name,
)
from app.domains.water_mitigation.sketch_pdf_service import SketchPdfService
from app.domains.water_mitigation.sketch_schemas import GenerateScopeRequest
from app.domains.water_mitigation.sketch_service import SketchService
from app.main import app as _app  # noqa: F401 - registers every model the mappers refer to

MIGRATION = BACKEND / "alembic" / "versions" / "wm20261110fpp01_seed_plastic_floor_protection.py"

PAPER = "Heavy duty paper & tape"
PLASTIC = "Plastic & tape"


def strip(protection_type=PAPER, is_stair=False, sqft=30.0):
    return SimpleNamespace(
        protection_type=protection_type, is_stair=is_stair, calculated_sqft=sqft,
    )


def floor(protections, demolition_zones=()):
    return SimpleNamespace(
        floor_label="1st Floor", floor_order=1,
        overlay_data={"demolition_zones": []}, demolition_zones=list(demolition_zones),
        equipment_placements=[], containment_zones=[], floor_protections=protections,
        content_protections=[], content_manipulations=[],
    )


def generate(protections):
    db = MagicMock()
    db.execute.return_value.all.return_value = []
    service = SketchService(db)
    service.repository = MagicMock()
    service.repository.get_floor_sketches_by_job.return_value = [floor(protections)]
    service.generate_scope_from_sketch(uuid4(), GenerateScopeRequest())
    added = [call.args[0] for call in db.add.call_args_list]
    return {o.name: float(o.quantity) for o in added if hasattr(o, "item_type")}


def test_each_kind_is_its_own_scope_item():
    items = generate([
        strip(PAPER, False, 30), strip(PAPER, False, 12),
        strip(PAPER, True, 18),
        strip(PLASTIC, False, 45),
        strip(PLASTIC, True, 21), strip(PLASTIC, True, 3),
    ])
    assert items["Floor Protection"] == 42
    assert items["Floor Protection (Stairs)"] == 18
    assert items["Floor Protection - Plastic"] == 45
    assert items["Floor Protection - Plastic (Stairs)"] == 24


def test_strips_saved_before_plastic_stay_paper():
    # Old strips say paper; anything not plastic must keep billing as paper
    items = generate([strip("Heavy duty paper & tape", False, 10), strip(None, True, 5)])
    assert items == {"Floor Protection": 10, "Floor Protection (Stairs)": 5}


def test_only_kinds_present_are_added():
    items = generate([strip(PLASTIC, False, 8)])
    assert list(items) == ["Floor Protection - Plastic"]


def test_names_match_the_frontend_and_the_seeded_standard_items():
    # frontend/src/types/wmSketch.ts floorProtectionScopeName
    assert FLOOR_PROTECTION_SCOPE_NAMES == (
        "Floor Protection",
        "Floor Protection (Stairs)",
        "Floor Protection - Plastic",
        "Floor Protection - Plastic (Stairs)",
    )
    seeded = {std for *_, std, _ in load_migration()._ITEMS}
    assert seeded == {
        floor_protection_scope_name(PLASTIC, False),
        floor_protection_scope_name(PLASTIC, True),
    }


def pdf_summary(protections, demolition_zones=()):
    return SketchPdfService(None)._compute_floor_summary(floor(protections, demolition_zones))


def test_pdf_summary_lists_each_kind_in_scope_order():
    summary = pdf_summary([
        strip(PLASTIC, True, 21), strip(PAPER, False, 30), strip(PLASTIC, False, 45),
    ])
    rows = [(r["label"], r["sqft"], r["is_stair"]) for r in summary["protection_rows"]]
    assert rows == [
        ("Floor Protection", 30, False),
        ("Floor Protection - Plastic", 45, False),
        ("Floor Protection - Plastic (Stairs)", 21, True),
    ]


def test_pdf_draws_plastic_stairs_in_its_own_color_when_none_was_saved():
    svg = "".join(SketchPdfService(None)._render_floor_protection_from_dict(
        {"protection_type": PLASTIC, "is_stair": True, "paper_width_ft": 3,
         "length_ft": 10, "x": 0, "y": 0}, 20,
    ))
    assert 'fill="#00838F"' in svg


def test_pdf_summary_counts_trim_in_the_lf_the_scope_bills():
    trim = SimpleNamespace(
        material_type="window_trim_demo", sub_type="large", surface="wall",
        color="#5B9BD5", calculated_sqft=1, trim_removal="half", trim_lf=None,
        dimension1_ft=0, include_pad=False, include_insulation=False,
        include_crown_molding=False, glue_down=False,
    )
    summary = pdf_summary([], [trim, trim])
    row = summary["demo_by_material"][0]
    assert row["unit"] == "LF"
    assert row["total_sqft"] == 20  # 2 x half of 20 LF, not "2 EA"


def keyword_match(scope_name, descriptions):
    """The template keyword fallback, as auto_generate_invoice_configs applies it."""
    include, exclude = invoice_config_service._SCOPE_LINE_ITEM_ALIASES[scope_name.lower()]
    return [
        d for d in descriptions
        if all(k in d.lower() for k in include) and not any(k in d.lower() for k in exclude)
    ]


def test_keyword_fallback_keeps_each_kind_on_its_own_line_item():
    template = [
        "Floor protection - heavy paper and tape",
        "Floor protection - stairs",
        "Floor protection - plastic and tape - 10 mil",
        "Floor protection - plastic and tape - 10 mil - stairs",
    ]
    assert keyword_match("Floor Protection", template) == [template[0]]
    assert keyword_match("Floor Protection (Stairs)", template) == [template[1]]
    assert keyword_match("Floor Protection - Plastic", template) == [template[2]]
    assert keyword_match("Floor Protection - Plastic (Stairs)", template) == [template[3]]


def load_migration():
    spec = importlib.util.spec_from_file_location("plastic_floor_protection", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def catalog_engine(paper_orders=None):
    engine = sa.create_engine("sqlite://", poolclass=sa.pool.StaticPool)
    with engine.begin() as conn:
        conn.execute(sa.text(
            "CREATE TABLE line_items (id TEXT PRIMARY KEY, type TEXT, cat TEXT, item TEXT, "
            "description TEXT, includes TEXT, unit TEXT, untaxed_unit_price NUMERIC, "
            "is_active BOOLEAN, version INTEGER)"
        ))
        conn.execute(sa.text(
            "CREATE TABLE wm_standard_scope_items (id TEXT PRIMARY KEY, company_id TEXT, "
            "item_type TEXT, name TEXT, unit TEXT, default_include_in_debris BOOLEAN, "
            "line_item_id TEXT, quantity_calc_type TEXT, default_invoice_note TEXT, "
            "display_order INTEGER, is_active BOOLEAN)"
        ))
        for name, order in (paper_orders or {}).items():
            conn.execute(sa.text(
                "INSERT INTO wm_standard_scope_items (id, name, display_order, item_type, unit, "
                "quantity_calc_type, is_active) VALUES (:id, :name, :o, 'standard', 'SF', 'fixed', 1)"
            ), {"id": str(uuid4()), "name": name, "o": order})
    return engine


def run(engine, step):
    module = load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def rows(engine, sql):
    with engine.connect() as conn:
        return conn.execute(sa.text(sql)).mappings().all()


def test_migration_seeds_two_priced_items_mapped_from_the_sketch_names():
    engine = catalog_engine({"Floor Protection": 0, "Floor Protection (Stairs)": 1})
    run(engine, "upgrade")

    items = {r["item"]: r for r in rows(engine, "SELECT * FROM line_items")}
    assert set(items) == {"WTRFPP", "WTRFPPS"}
    assert float(items["WTRFPP"]["untaxed_unit_price"]) == 0.37
    assert float(items["WTRFPPS"]["untaxed_unit_price"]) == 1.09
    assert all(r["cat"] == "WTR" and r["unit"] == "SF" and r["is_active"] for r in items.values())

    standard = {
        r["name"]: r for r in rows(engine, "SELECT * FROM wm_standard_scope_items")
        if "Plastic" in r["name"]
    }
    plastic = standard["Floor Protection - Plastic"]
    stairs = standard["Floor Protection - Plastic (Stairs)"]
    assert plastic["line_item_id"] == items["WTRFPP"]["id"]
    assert stairs["line_item_id"] == items["WTRFPPS"]["id"]
    assert (plastic["item_type"], plastic["unit"], plastic["quantity_calc_type"]) == ("standard", "SF", "fixed")
    assert plastic["company_id"] is None
    assert plastic["default_include_in_debris"] == 0
    # Listed next to the paper item of the same kind
    assert (plastic["display_order"], stairs["display_order"]) == (0, 1)


def test_migration_works_without_paper_items_and_reruns_without_duplicates():
    engine = catalog_engine()
    run(engine, "upgrade")
    run(engine, "upgrade")
    assert len(rows(engine, "SELECT id FROM line_items")) == 2
    assert len(rows(engine, "SELECT id FROM wm_standard_scope_items")) == 2


def test_migration_downgrade_removes_only_its_rows():
    engine = catalog_engine({"Floor Protection": 0})
    run(engine, "upgrade")
    run(engine, "downgrade")
    assert rows(engine, "SELECT id FROM line_items") == []
    assert [r["name"] for r in rows(engine, "SELECT name FROM wm_standard_scope_items")] == ["Floor Protection"]
