"""An island with cabinets on both sides: kept with the estimate and copied
with it, and priced with no back panel or seating overhang. The calculator on
its own, then the service on a throwaway SQLite database."""

from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401
from app.domains.unit_prices.models import PriceBook, UnitPriceOverride  # noqa: E402
from app.core.database_factory import SQLAlchemySession  # noqa: E402
from app.domains.cabinet_estimate.calculator import BoxInput, calculate_estimate  # noqa: E402
from app.domains.cabinet_estimate.models import (  # noqa: E402
    CabinetBox,
    CabinetEstimate,
    CabinetEstimateHistory,
    CabinetEstimateLineItem,
)
from app.domains.cabinet_estimate.schemas import (  # noqa: E402
    CabinetBoxCreate,
    CabinetEstimateCreate,
    CabinetEstimateUpdate,
)
from app.domains.cabinet_estimate.service import CabinetEstimateService  # noqa: E402
from app.domains.cabinet_estimate.sketch_models import CabinetSketch  # noqa: E402
from app.domains.cabinet_estimate.sketch_schemas import CabinetSketchOverlayData  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.product_library.models import Product  # noqa: E402


# ── The calculator ──

def _island(**kw):
    box = BoxInput(
        code="B36", cab_type="base", location="island", width_inches=36,
        height_inches=34.5, is_specialty=False, specialty_type=None,
        has_glass_door=False, qty=4,
    )
    return calculate_estimate(
        [box], "Stock", "22030", include_demo=False, include_delivery=False,
        include_countertop=True, island_countertop_sqft=40,
        island_countertop_material="Granite",
        island_end_panel_sqft=23, island_back_panel_sqft=34.5, **kw,
    )


def _names(result):
    return [li.description for li in result.line_items]


def test_one_sided_island_bills_its_back_panel():
    names = _names(_island())
    assert any(n.startswith("Island Back Panel") for n in names)
    assert any(n.startswith("Island End Panel") for n in names)


def test_two_sided_island_has_no_back_panel_but_keeps_its_ends():
    r = _island(island_two_sided=True)
    names = _names(r)
    assert not any("Back Panel" in n for n in names)
    assert [li.quantity for li in r.line_items if li.description.startswith("Island End Panel")] == [23, 23]
    assert "cabinets on both sides" in r.methodology_notes


def test_two_sided_island_has_no_seating_overhang_or_its_supports():
    # A 12" overhang on granite (which carries 10") with supports billed, one-sided ...
    one = _island(island_seating_overhang_in=12, countertop_support_count=3)
    assert any("Overhang Support" in n for n in _names(one))
    # ... and two-sided: neither long side is free for seating, so neither is billed or flagged.
    two = _island(island_seating_overhang_in=12, countertop_support_count=3, island_two_sided=True)
    assert not any("Overhang Support" in n for n in _names(two))
    two_unbilled = _island(island_seating_overhang_in=12, island_two_sided=True)
    assert not any("overhang supports" in w for w in two_unbilled.warning_flags)


def test_the_cabinets_cost_the_same_either_way():
    def cabinets(result):
        return sum(li.total for li in result.line_items if "B36" in li.description)
    assert cabinets(_island()) == cabinets(_island(island_two_sided=True))


# ── Through the service ──

@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


@pytest.fixture
def service(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'kitchen.db'}")
    for model in (PriceBook, UnitPriceOverride, Client, Claim, CabinetEstimate, CabinetBox, CabinetEstimateLineItem,
                  CabinetEstimateHistory, CabinetSketch, Product):
        model.__table__.create(engine)
    s = SQLAlchemySession(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)())
    yield CabinetEstimateService(s)
    s.close()


def new_job(service, **fields):
    data = dict(
        project_type="insurance", property_address="12 Elm St", zip_code="20850",
        tier="Stock", island_back_panel_sqft=34.5,
        boxes=[CabinetBoxCreate(code="B36", cab_type="base", location="island",
                                width_inches=36, height_inches=34.5, qty=4)],
    )
    data.update(fields)
    return service.create_estimate(CabinetEstimateCreate(**data))


def has_back_panel(estimate):
    return any("Back Panel" in li["description"] for li in estimate["line_items"])


def test_an_estimate_starts_one_sided(service):
    job = new_job(service)
    assert job["island_two_sided"] is False
    assert has_back_panel(service.calculate(job["id"]))


def test_saving_both_sides_takes_the_back_panel_off(service):
    job = new_job(service)
    saved = service.update_estimate(job["id"], CabinetEstimateUpdate(island_two_sided=True))
    assert saved["island_two_sided"] is True
    assert not has_back_panel(service.calculate(job["id"]))
    # Turned off again, the back panel entered before is billed again.
    service.update_estimate(job["id"], CabinetEstimateUpdate(island_two_sided=False))
    assert has_back_panel(service.calculate(job["id"]))


def test_an_option_and_a_copy_keep_it(service):
    restore = service.calculate(new_job(service, island_two_sided=True)["id"])
    assert service.add_option(restore["id"])["island_two_sided"] is True
    assert service.clone_estimate(restore["id"])["island_two_sided"] is True


def test_the_sketch_keeps_what_its_island_was_laid_out_for():
    assert CabinetSketchOverlayData(island_two_sided=True).model_dump()["island_two_sided"] is True
    assert CabinetSketchOverlayData().model_dump()["island_two_sided"] is None
