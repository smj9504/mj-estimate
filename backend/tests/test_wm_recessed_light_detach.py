"""Recessed light detach: sketch marker to scope item, and the migration that prices it."""
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
from app.domains.water_mitigation.sketch_pdf_service import SketchPdfService
from app.domains.water_mitigation.sketch_schemas import GenerateScopeRequest
from app.domains.water_mitigation.sketch_service import SketchService
from app.main import app as _app  # noqa: F401 - registers every model the mappers refer to

MIGRATION =BACKEND / "alembic" / "versions" / "wm20261030rld01_seed_recessed_light_detach.py"


def light(**patch):
    return {
        "id": str(uuid4()), "material_type": "recessed_light_detach", "surface": "ceiling",
        "color": "#00897B", "x": 100, "y": 200, "dimension1_ft": 1, "dimension2_ft": 0,
        "rotation": 0, "calculated_sqft": 1, "pixel_width": 28, "pixel_height": 28,
        "render_mode": "shape", **patch,
    }


def generate(zones):
    """Run scope generation for one floor and return the items and warnings."""
    db = MagicMock()
    db.execute.return_value.all.return_value = [
        SimpleNamespace(material_type="drywall_1_2", id=uuid4()),
    ]
    service = SketchService(db)
    service.repository = MagicMock()
    service.repository.get_floor_sketches_by_job.return_value = [
        SimpleNamespace(
            floor_label="1st Floor", floor_order=1,
            overlay_data={"demolition_zones": zones}, demolition_zones=zones,
            equipment_placements=[], containment_zones=[], floor_protections=[],
            content_protections=[], content_manipulations=[],
        ),
    ]
    response = service.generate_scope_from_sketch(uuid4(), GenerateScopeRequest())
    added = [call.args[0] for call in db.add.call_args_list]
    return [obj for obj in added if hasattr(obj, "item_type")], response.warnings


def test_each_light_adds_one_ea_to_a_single_scope_item():
    items, _ = generate([light(), light(), light()])
    item = next(i for i in items if i.name == "Recessed Light Detach")
    assert item.item_type == "demolition"
    assert item.unit == "EA"
    assert float(item.quantity) == 3
    assert sum(i.name == "Recessed Light Detach" for i in items) == 1


def test_detached_lights_are_not_debris():
    # They come out whole and go back in, so they must not add debris weight
    # or a "no material weight" warning to every sketch that has them
    items, warnings = generate([light()])
    item = next(i for i in items if i.name == "Recessed Light Detach")
    assert item.include_in_debris is False
    assert item.material_weight_id is None
    assert not any("Recessed Light" in w for w in warnings)


def test_lights_alone_do_not_trigger_antimicrobial():
    items, _ = generate([light()])
    assert not any(i.name == "Antimicrobial Application" for i in items)


def test_ceiling_demo_next_to_lights_stays_debris():
    items, _ = generate([
        light(),
        {"id": "c1", "material_type": "ceiling", "surface": "ceiling", "calculated_sqft": 40,
         "dimension1_ft": 8, "dimension2_ft": 5},
    ])
    ceiling = next(i for i in items if i.name == "Ceiling")
    assert ceiling.include_in_debris is True


def test_pdf_prints_a_round_labelled_marker():
    svg = "".join(SketchPdfService(None)._render_demo_zone_from_dict(light(), 20))
    assert svg.startswith('<g transform="translate(100.0,200.0)">')
    assert '<circle cx="14.0" cy="14.0" r="14.0"' in svg
    assert ">RL</text>" in svg
    assert "<rect" not in svg


def load_migration():
    spec = importlib.util.spec_from_file_location("recessed_light_migration", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def catalog_engine():
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
    return engine


def run(engine, step):
    module = load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def rows(engine, sql):
    with engine.connect() as conn:
        return conn.execute(sa.text(sql)).mappings().all()


def test_migration_seeds_a_priced_item_mapped_from_the_sketch_name():
    engine = catalog_engine()
    run(engine, "upgrade")

    item = rows(engine, "SELECT * FROM line_items")[0]
    assert (item["cat"], item["item"], item["unit"]) == ("WTR", "WTRRLD", "EA")
    assert float(item["untaxed_unit_price"]) == 80.00
    assert item["is_active"]

    standard = rows(engine, "SELECT * FROM wm_standard_scope_items")[0]
    assert standard["item_type"] == "demolition"
    assert standard["line_item_id"] == item["id"]
    assert standard["default_include_in_debris"] == 0
    assert standard["company_id"] is None
    # Invoice mapping looks the scope item up by this name, lower-cased
    assert standard["name"] == SketchService._MATERIAL_TYPE_NAMES["recessed_light_detach"]


def test_migration_can_rerun_without_duplicates():
    # Nothing unique on line_items, so ON CONFLICT would not have stopped this
    engine = catalog_engine()
    run(engine, "upgrade")
    run(engine, "upgrade")
    assert len(rows(engine, "SELECT id FROM line_items")) == 1
    assert len(rows(engine, "SELECT id FROM wm_standard_scope_items")) == 1


def test_migration_downgrade_removes_both_rows():
    engine = catalog_engine()
    run(engine, "upgrade")
    run(engine, "downgrade")
    assert rows(engine, "SELECT id FROM line_items") == []
    assert rows(engine, "SELECT id FROM wm_standard_scope_items") == []
