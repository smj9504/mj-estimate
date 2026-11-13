"""A rebuild estimate is one estimate for a claim's rebuild: the flooring,
bathroom and kitchen cabinet estimates imported into it line by line, and
the repairs none of them covers (drywall, insulation, paint on the walls and
ceilings) added room by room, priced from the Xactimate price list (owner,
2026-11-13). Rooms read like a contractor's estimate: floor, cabinets, a
bathroom's phases, wall, ceiling. On a throwaway SQLite database."""

import importlib.util
from pathlib import Path
import uuid

import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker

import app.main  # noqa: F401
from app.core.database_factory import SQLAlchemySession
from app.domains.bathroom_estimate.models import BathroomEstimate, BathroomEstimateHistory, BathroomEstimateLineItem
from app.domains.cabinet_estimate.models import (
    CabinetBox, CabinetEstimate, CabinetEstimateHistory, CabinetEstimateLineItem,
)
from app.domains.client.models import Claim, Client
from app.domains.company.models import Company
from app.domains.flooring_estimate.models import FlooringEstimate, FlooringEstimateHistory, FlooringEstimateLineItem
from app.domains.flooring_estimate.schemas import FlooringEstimateCreate, FlooringEstimateUpdate
from app.domains.flooring_estimate.service import FlooringEstimateService
from app.domains.rebuild_estimate.assemble import assemble, tax_rate
from app.domains.rebuild_estimate.models import RebuildEstimate
from app.domains.rebuild_estimate.schemas import (
    ImportRequest, RebuildEstimateCreate, RebuildEstimateUpdate, SourceRoomRequest,
)
from app.domains.rebuild_estimate.service import RebuildEstimateService
from app.domains.unit_prices.models import PriceBook, UnitPriceChange, UnitPriceOverride
from app.domains.unit_prices.xactimate import xact
from app.domains.xactimate.models import XactimateCategory, XactimateItem

from test_flooring_estimate import house, scopes  # noqa: E402  (also lets SQLite take JSONB)


@pytest.fixture
def session(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'rebuild.db'}")
    for model in (PriceBook, UnitPriceOverride, UnitPriceChange, Company, Client, Claim,
                  FlooringEstimate, FlooringEstimateLineItem, FlooringEstimateHistory,
                  BathroomEstimate, BathroomEstimateLineItem, BathroomEstimateHistory,
                  CabinetEstimate, CabinetBox, CabinetEstimateLineItem, CabinetEstimateHistory,
                  RebuildEstimate, XactimateCategory, XactimateItem):
        model.__table__.create(engine)
    s = SQLAlchemySession(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)())
    yield s
    s.close()


@pytest.fixture
def service(session):
    return RebuildEstimateService(session)


ADDRESS = dict(property_address="123 Example St", city="Anytown", state="VA", zip_code="22030")


def flooring(session, **fields):
    floors = FlooringEstimateService(session)
    est = floors.create_estimate(FlooringEstimateCreate(**ADDRESS, sketch_data=house(), room_scopes=scopes(), **fields))
    floors.calculate(est["id"])
    return est["id"]


def bathroom(session, **fields):
    est = BathroomEstimate(id=str(uuid.uuid4()), designation="master", length_ft=8, width_ft=5, height_ft=8,
                           floor_sf=40, wall_sf=180, status="calculated", **ADDRESS, **fields)
    session.add(est)
    for i, (phase, description, qty, unit, price) in enumerate([
        (1, "Demo tile floor and walls", 1, "LS", 950.0),
        (4, "Porcelain floor tile - install", 40, "SF", 14.5),
        (6, "Paint walls and ceiling", 1, "LS", 420.0),
    ]):
        session.add(BathroomEstimateLineItem(estimate_id=est.id, phase=phase, description=description, quantity=qty,
                                             unit=unit, unit_price=price, total=round(qty * price, 2), display_order=i))
    session.flush()
    return str(est.id)


def cabinets(session, **fields):
    est = CabinetEstimate(id=str(uuid.uuid4()), status="calculated", overhead_pct=0.15, profit_pct=0.15,
                          property_address=ADDRESS["property_address"], zip_code=ADDRESS["zip_code"], **fields)
    session.add(est)
    for i, (description, qty, unit, price) in enumerate([
        ("Base cabinets - supply", 14, "LF", 310.0),
        ("Base cabinets - install", 14, "LF", 62.0),
    ]):
        session.add(CabinetEstimateLineItem(estimate_id=est.id, description=description, quantity=qty, unit=unit,
                                            unit_price=price, total=round(qty * price, 2), display_order=i))
    session.flush()
    return str(est.id)


def new(service, **fields):
    return service.create(RebuildEstimateCreate(**{**ADDRESS, **fields}))


def lines_of(est, room_name):
    room = next(r for r in est["assembled"]["rooms"] if r["name"] == room_name)
    return {s["key"]: s["lines"] for s in room["sections"]}


# ── Importing ──

def test_a_flooring_estimate_comes_in_room_by_room_with_every_line(session, service):
    floor_id = flooring(session)
    floor = FlooringEstimateService(session).get_estimate(floor_id)
    est = new(service)
    est = service.import_source(est["id"], ImportRequest(kind="flooring", estimate_id=floor_id))

    # Its rooms, with what the sketch measured (the bedroom 2 and bathroom left out of it aren't)
    rooms = {r["name"]: r for r in est["rooms"]}
    assert set(rooms) == {"Living Room", "Kitchen", "Hallway", "Bedroom 1", "Closet"}
    assert rooms["Living Room"]["measures"]["floor_sf"] == pytest.approx(212.5)
    assert rooms["Living Room"]["measures"]["wall_sf"] > 0
    assert rooms["Living Room"]["measures"]["perimeter_lf"] == pytest.approx(58.33)

    # Every line, priced as it was, under Floor; the whole-job lines in General
    living = floor["line_items"]
    kept = lines_of(est, "Living Room")["floor"]
    assert [li["description"] for li in kept] == [li["description"] for li in living if li["room_name"] == "Living Room"]
    assert [li["unit_price"] for li in kept] == [li["unit_price"] for li in living if li["room_name"] == "Living Room"]
    general = next(r for r in est["assembled"]["rooms"] if r["id"] is None)
    assert general["name"] == "General" and general["total"] > 0
    assert est["total"] == pytest.approx(floor["total"], abs=0.01)
    # Numbered through the estimate
    numbers = [li["n"] for r in est["assembled"]["rooms"] for s in r["sections"] for li in s["lines"]]
    assert numbers == list(range(1, len(floor["line_items"]) + 1))
    source = est["sources"][0]
    assert (source["label"], source["state"], source["path"]) == (
        "Flooring estimate", "current", f"/flooring-estimates/{floor_id}")

    # The same estimate twice: no
    with pytest.raises(HTTPException, match="already in"):
        service.import_source(est["id"], ImportRequest(kind="flooring", estimate_id=floor_id))


def test_the_original_recalculated_says_so_and_refresh_takes_it_again(session, service):
    floor_id = flooring(session)
    est = new(service)
    est = service.import_source(est["id"], ImportRequest(kind="flooring", estimate_id=floor_id))
    kitchen_id = next(r["id"] for r in est["rooms"] if r["name"] == "Kitchen")
    before = est["total"]

    floors = FlooringEstimateService(session)
    floors.update_estimate(floor_id, FlooringEstimateUpdate(room_scopes=scopes(kitchen={"new_material": "ceramic_tile"})))
    floors.calculate(floor_id)
    est = service.get(est["id"])
    assert est["sources"][0]["state"] == "changed"
    assert est["total"] == before  # kept as imported until refreshed

    est = service.refresh_source(est["id"], est["sources"][0]["id"])
    assert est["sources"][0]["state"] == "current"
    assert est["total"] == pytest.approx(floors.get_estimate(floor_id)["total"], abs=0.01)
    # The rooms are the same rooms
    assert next(r["id"] for r in est["rooms"] if r["name"] == "Kitchen") == kitchen_id
    assert any("Ceramic" in li["description"] for li in lines_of(est, "Kitchen")["floor"])


def test_a_kitchen_and_a_bathroom_go_into_their_rooms(session, service):
    est = new(service)
    est = service.import_source(est["id"], ImportRequest(kind="flooring", estimate_id=flooring(session)))
    est = service.import_source(est["id"], ImportRequest(kind="cabinet", estimate_id=cabinets(session)))
    est = service.import_source(est["id"], ImportRequest(kind="bathroom", estimate_id=bathroom(session)))

    # The kitchen estimate joins the sketch's kitchen: floor first, then cabinets
    kitchen = next(r for r in est["assembled"]["rooms"] if r["name"] == "Kitchen")
    assert [s["key"] for s in kitchen["sections"]] == ["floor", "cabinets"]
    assert [li["description"] for li in kitchen["sections"][1]["lines"]] == [
        "Base cabinets - supply", "Base cabinets - install"]
    # No room in the flooring estimate is a bathroom: the bathroom estimate brings its own,
    # its lines under its phases, with its measures
    bath = next(r for r in est["rooms"] if r["name"] == "Master Bathroom")
    assert bath["measures"] == {"floor_sf": 40.0, "ceiling_sf": 40.0, "wall_sf": 180.0, "perimeter_lf": 26.0,
                                "height_ft": 8.0}
    assert list(lines_of(est, "Master Bathroom")) == ["bath_1", "bath_4", "bath_6"]
    cab = next(s for s in est["sources"] if s["kind"] == "cabinet")
    assert cab["label"] == "Kitchen cabinet estimate" and cab["op_included"] is True
    # A cabinet estimate has O&P in its prices, the repairs here don't: said
    assert any("Kitchen cabinet estimate is priced with O&P" in w for w in est["assembled"]["warnings"])

    # The bathroom moved onto another room
    bath_src = next(s for s in est["sources"] if s["kind"] == "bathroom")
    hall = next(r for r in est["rooms"] if r["name"] == "Hallway")
    est = service.move_source(est["id"], bath_src["id"], SourceRoomRequest(room_id=hall["id"]))
    assert "bath_1" in lines_of(est, "Hallway")
    # The room it brought stays, empty
    assert lines_of(est, "Master Bathroom") == {}
    est = service.move_source(est["id"], bath_src["id"], SourceRoomRequest(new_room_name="Guest Bath"))
    assert "bath_4" in lines_of(est, "Guest Bath")
    # A flooring estimate is many rooms: it isn't moved as one
    floor_src = next(s for s in est["sources"] if s["kind"] == "flooring")
    with pytest.raises(HTTPException, match="one room"):
        service.move_source(est["id"], floor_src["id"], SourceRoomRequest(room_id=hall["id"]))


def test_a_bathroom_finds_the_one_room_named_for_it(session, service):
    est = new(service)
    est = service.update(est["id"], RebuildEstimateUpdate(rooms=[
        {"id": "r1", "name": "Primary Bath", "measures": {"floor_sf": 55}},
        {"id": "r2", "name": "Den"},
    ]))
    est = service.import_source(est["id"], ImportRequest(kind="bathroom", estimate_id=bathroom(session)))
    assert [r["name"] for r in est["rooms"]] == ["Primary Bath", "Den"]
    # Its own measures stay; the bathroom's lines join it
    assert est["rooms"][0]["measures"]["floor_sf"] == 55
    assert "bath_4" in lines_of(est, "Primary Bath")


def test_removing_an_import_takes_its_lines_and_leaves_the_rooms(session, service):
    est = new(service)
    est = service.import_source(est["id"], ImportRequest(kind="cabinet", estimate_id=cabinets(session)))
    room_id = est["rooms"][0]["id"]
    # A room holding imported lines can't go
    with pytest.raises(HTTPException, match="holds the lines imported"):
        service.update(est["id"], RebuildEstimateUpdate(rooms=[]))
    est = service.remove_source(est["id"], est["sources"][0]["id"])
    assert est["sources"] == [] and est["total"] == 0
    assert [r["id"] for r in est["rooms"]] == [room_id]


def test_only_calculated_estimates_come_in(session, service):
    floors = FlooringEstimateService(session)
    draft = floors.create_estimate(FlooringEstimateCreate(**ADDRESS, sketch_data=house(), room_scopes=scopes()))
    est = new(service)
    with pytest.raises(HTTPException, match="Calculate the flooring estimate first"):
        service.import_source(est["id"], ImportRequest(kind="flooring", estimate_id=draft["id"]))


def test_the_estimates_offered_are_on_its_claim_or_at_its_address(session, service):
    client = Client(id=str(uuid.uuid4()), display_name="Pat Example", owners=[])
    claim = Claim(id=str(uuid.uuid4()), client_id=client.id, claim_number="CLM-1")
    other = Claim(id=str(uuid.uuid4()), client_id=client.id, claim_number="CLM-2")
    for row in (client, claim, other):
        session.add(row)
    session.flush()
    on_claim = flooring(session, claim_id=claim.id)
    loose = cabinets(session)                       # same address, no claim
    elsewhere = bathroom(session, claim_id=other.id)
    est = new(service, claim_id=claim.id)
    staff = type("Staff", (), {"id": "x", "role": "admin"})()
    offered = {(o["kind"], o["estimate_id"]): o for o in service.importable(est["id"], staff)}
    assert set(offered) == {("flooring", on_claim), ("cabinet", loose)}
    assert offered[("flooring", on_claim)]["calculated"] is True
    service.import_source(est["id"], ImportRequest(kind="flooring", estimate_id=on_claim))
    assert service.importable(est["id"], staff)[0]["imported"] is True
    assert elsewhere


# ── Repairs added here ──

DRYWALL = {"activity": "&", "price": 3.80, "material_share": 0.2}
PAINT = {"activity": "+", "price": 0.96, "material_share": 0.1771}


def test_a_repair_is_priced_from_xactimate_marked_up_with_material_tax(session, service):
    est = new(service)
    est = service.update(est["id"], RebuildEstimateUpdate(
        rooms=[{"id": "k", "name": "Kitchen", "measures": {"floor_sf": 147, "wall_sf": 408, "perimeter_lf": 51}}],
        lines=[
            {"id": "a", "room_id": "k", "section": "wall", "description": '1/2" drywall - hung, taped, floated',
             "unit": "SF", "basis": "wall_sf", "code": "DRY1/2", "activity": "&", "activities": [DRYWALL]},
            {"id": "b", "room_id": "k", "section": "ceiling", "description": "Paint the ceiling - one coat",
             "unit": "SF", "basis": "ceiling_sf", "code": "PNTP", "activity": "+", "activities": [PAINT]},
            {"id": "c", "room_id": "k", "section": "wall", "description": "Patch plaster", "unit": "EA",
             "quantity": 2, "unit_price": 85},
            {"id": "d", "room_id": None, "section": "other", "description": "Haul debris", "unit": "EA",
             "quantity": 1, "unit_price": 185},
        ],
    ))
    tax = tax_rate("VA", "22030")
    wall = lines_of(est, "Kitchen")["wall"]
    drywall = next(li for li in wall if li["id"] == "a")
    # The Xactimate price +10%, material tax on its material share; the walls' SF
    assert drywall["base_price"] == xact(3.80)
    assert drywall["unit_price"] == pytest.approx(round(xact(3.80) * (1 + 0.2 * tax), 2))
    assert (drywall["quantity"], drywall["auto_qty"], drywall["qty_typed"]) == (408, 408, False)
    # The ceiling follows the floor when it isn't measured on its own
    ceiling = lines_of(est, "Kitchen")["ceiling"][0]
    assert ceiling["quantity"] == 147
    # Typed: as typed
    patch = next(li for li in wall if li["id"] == "c")
    assert (patch["unit_price"], patch["total"], patch["price_typed"]) == (85, 170, True)
    general = next(r for r in est["assembled"]["rooms"] if r["id"] is None)
    assert general["total"] == 185
    assert est["total"] == pytest.approx(sum(r["total"] for r in est["assembled"]["rooms"]))

    # O&P on: folded into the repairs' unit prices, not into a typed one
    est = service.update(est["id"], RebuildEstimateUpdate(include_overhead_profit=True))
    drywall_op = next(li for li in lines_of(est, "Kitchen")["wall"] if li["id"] == "a")
    assert drywall_op["unit_price"] == pytest.approx(round(xact(3.80) * (1 + 0.2 * tax) * 1.21, 2))
    assert next(li for li in lines_of(est, "Kitchen")["wall"] if li["id"] == "c")["unit_price"] == 85


def test_a_repair_without_a_quantity_or_a_room_is_said_or_refused(session, service):
    est = new(service)
    est = service.update(est["id"], RebuildEstimateUpdate(
        rooms=[{"id": "d", "name": "Den"}],
        lines=[{"id": "a", "room_id": "d", "section": "wall", "description": "Paint the walls", "unit": "SF",
                "basis": "wall_sf", "code": "PNTP", "activity": "+", "activities": [PAINT]}],
    ))
    assert lines_of(est, "Den")["wall"][0]["quantity"] == 0
    assert any("Den" in w and "no quantity" in w for w in est["assembled"]["warnings"])
    with pytest.raises(HTTPException, match="isn't on the estimate"):
        service.update(est["id"], RebuildEstimateUpdate(lines=[
            {"id": "b", "room_id": "nowhere", "description": "x", "unit": "EA", "quantity": 1, "unit_price": 1}]))
    with pytest.raises(Exception, match="no price for that activity"):
        RebuildEstimateUpdate(lines=[{"id": "b", "description": "x", "activity": "-", "activities": [PAINT]}])


# ── The Xactimate price list ──

def test_searching_the_price_list_finds_the_latest_month_with_each_activity(session):
    from app.domains.rebuild_estimate.xactimate_search import search

    session.add(XactimateCategory(category_code="DRY", category_name="Drywall"))
    common = dict(item_code="DRY1/2", category_code="DRY", description='1/2" drywall - hung, taped, floated, ready for paint',
                  unit="SF", activity="&", untaxed_unit_price=3.80, replace_price=3.26, remove_price=0.54,
                  material_cost=0.76, other_activities="MI", material_only_price=0.76, install_only_price=2.50)
    session.add(XactimateItem(price_year=2026, price_month=10, price_list="OLD", **{**common, "untaxed_unit_price": 3.50}))
    session.add(XactimateItem(price_year=2026, price_month=11, price_list="VAAR8X_NOV26", **common))
    session.flush()
    found = search(session, "drywall hung")
    assert len(found) == 1 and found[0]["price_list"] == "VAAR8X_NOV26"
    acts = {a["activity"]: a for a in found[0]["activities"]}
    assert list(acts) == ["&", "+", "-", "M", "I"]
    assert acts["&"]["price"] == 3.80 and acts["&"]["marked_up"] == xact(3.80)
    assert acts["&"]["material_share"] == pytest.approx(0.76 / 3.80, abs=1e-4)
    assert acts["+"]["material_share"] == pytest.approx(0.76 / 3.26, abs=1e-4)
    assert (acts["-"]["material_share"], acts["M"]["material_share"], acts["I"]["material_share"]) == (0, 1, 0)
    # By its code too
    assert search(session, "dry1/2")[0]["code"] == "DRY1/2"
    assert search(session, "carpet") == []


# ── The PDF ──

def test_the_pdf_prints_each_room_with_its_sections_numbered_through(session, service):
    from pypdf import PdfReader

    from app.domains.rebuild_estimate.export_service import RebuildExportService

    est = new(service)
    est = service.import_source(est["id"], ImportRequest(kind="flooring", estimate_id=flooring(session)))
    est = service.import_source(est["id"], ImportRequest(kind="cabinet", estimate_id=cabinets(session)))
    kitchen = next(r["id"] for r in est["rooms"] if r["name"] == "Kitchen")
    est = service.update(est["id"], RebuildEstimateUpdate(lines=[
        {"id": "a", "room_id": kitchen, "section": "wall", "description": "Paint the walls - one coat", "unit": "SF",
         "basis": "wall_sf", "code": "PNTP", "activity": "+", "activities": [PAINT]},
    ]))
    text = "\n".join(p.extract_text() for p in PdfReader(RebuildExportService().generate_pdf(est)).pages)
    assert "REBUILD ESTIMATE" in text and "Summary" in text and "Grand total" in text
    for words in ("Kitchen", "Living Room", "FLOOR", "CABINETS", "WALL", "Paint the walls - one coat",
                  "Base cabinets - supply", "Floor subtotal", "Flooring estimate", "Kitchen cabinet estimate",
                  "other repairs"):
        assert words in text, words
    import re
    numbers = [int(n) for n in re.findall(r"^\s*(\d+)\.\s*$", text, re.M)]
    count = sum(len(s["lines"]) for r in est["assembled"]["rooms"] for s in r["sections"])
    assert numbers == list(range(1, count + 1))


# ── Its screen ──

def test_people_who_build_flooring_estimates_can_open_rebuild_ones(tmp_path):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    from app.domains.auth.screen_access import SCREEN_KEYS
    from app.domains.staff.models import RoleScreenAccess

    assert "rebuild_estimates" in SCREEN_KEYS
    screens_ts = Path(__file__).resolve().parents[2] / "frontend" / "src" / "constants" / "screens.ts"
    assert "'rebuild_estimates'" in screens_ts.read_text(encoding="utf-8")

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "rbe20261113sc02_rebuild_estimates_screen.py"
    spec = importlib.util.spec_from_file_location("rebuild_screen_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'screens.db'}")
    RoleScreenAccess.__table__.create(engine)
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE staff (id VARCHAR(36) PRIMARY KEY, screen_access JSON)")
    roles = sa.table("role_screen_access", sa.column("role"), sa.column("screens", sa.JSON))
    with engine.begin() as conn:
        conn.execute(roles.insert(), [
            {"role": "manager", "screens": ["clients", "flooring_estimates"]},
            {"role": "staff", "screens": ["clients"]},
        ])
        migration.op = Operations(MigrationContext.configure(conn))
        migration.upgrade()
        migration.upgrade()
        saved = dict(conn.execute(sa.select(roles.c.role, roles.c.screens)).all())
        assert saved == {"manager": ["clients", "flooring_estimates", "rebuild_estimates"], "staff": ["clients"]}


def test_assemble_with_nothing_in_it():
    est = RebuildEstimate(rooms=[], sources=[], lines=[], state="VA", zip_code="22030",
                          include_overhead_profit=False, overhead_pct=0.1, profit_pct=0.1)
    assert assemble(est)["rooms"] == [] and assemble(est)["total"] == 0
