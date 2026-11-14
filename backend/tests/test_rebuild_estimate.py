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
from app.domains.rebuild_estimate.models import RebuildEstimate, RebuildWording
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
                  RebuildEstimate, RebuildWording, XactimateCategory, XactimateItem):
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
    living = rooms["Living Room"]["measures"]
    assert living["floor_sf"] == pytest.approx(212.5)
    assert living["perimeter_lf"] == pytest.approx(58.33)
    # The walls less the 6' opening to the kitchen and the 3' front door, 6' 8" high
    assert living["wall_sf"] == pytest.approx(58.33 * 8 - 9 * 6.6667, abs=0.05)
    # The outside walls: the front and the left side, less the front door
    assert living["exterior_wall_sf"] == pytest.approx((15 + 14.1667) * 8 - 3 * 6.6667, abs=0.05)

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


def test_the_walls_are_measured_less_their_doors_and_the_outside_walls_apart():
    from app.domains.flooring_estimate.geometry import measure_sketch

    m = {r.room_id: r for r in measure_sketch(house())}
    # Kitchen: 51 LF x 8', less the 6' opening and the 3' one to the hall at 6' 8"
    assert m["kitchen"].wall_net_sf == pytest.approx(408 - 9 * 6.6667, abs=0.05)
    # Its outside walls: the back 14', the right 8', the L's 4' and 3' 6"
    assert m["kitchen"].exterior_wall_lf == pytest.approx(29.5, abs=0.01)
    # A hall between rooms has none; the gaps where inside walls meet don't count
    assert m["hall"].exterior_wall_lf == 0
    # An open wall takes the whole height out
    sketch = house()
    sketch["levels"][0]["openings"][0]["kind"] = "open_wall"
    assert {r.room_id: r for r in measure_sketch(sketch)}["kitchen"].wall_net_sf == pytest.approx(
        408 - 6 * 8 - 3 * 6.6667, abs=0.05)


def test_a_flood_cut_takes_the_lower_part_of_the_walls_and_the_rest_is_painted_to_match(session, service):
    est = new(service)
    measures = {"floor_sf": 147, "wall_sf": 348, "exterior_wall_sf": 236, "perimeter_lf": 51, "height_ft": 8}
    common = {"room_id": "k", "section": "wall", "unit": "SF", "unit_price": 1}
    est = service.update(est["id"], RebuildEstimateUpdate(
        rooms=[{"id": "k", "name": "Kitchen", "measures": measures}],
        lines=[
            {**common, "id": "dry", "description": "Drywall", "basis": "wall_sf", "cut_height_ft": 2},
            {**common, "id": "ins", "description": "Insulation", "basis": "exterior_wall_sf", "cut_height_ft": 2},
            {**common, "id": "top", "description": "Paint the rest", "basis": "wall_sf", "cut_height_ft": 2,
             "cut_part": "above"},
            {**common, "id": "all", "description": "Paint", "basis": "wall_sf"},
            {**common, "id": "ceil", "section": "ceiling", "description": "Ceiling", "basis": "ceiling_sf",
             "cut_height_ft": 2},
        ],
    ))
    lines = {li["id"]: li for s in lines_of(est, "Kitchen").values() for li in s}
    assert {k: li["quantity"] for k, li in lines.items()} == {
        "dry": 87.0, "ins": 59.0, "top": 261.0, "all": 348.0, "ceil": 147.0}
    # Said on the estimate
    assert (lines["dry"]["notes"], lines["ins"]["notes"], lines["top"]["notes"], lines["all"]["notes"]) == (
        "Lower 2' of the walls", "Lower 2' of the outside walls", "The walls above 2'", None)


# ── Our words, not Xactimate's ──

def test_a_line_is_worded_our_way_the_companys_words_first():
    from app.domains.rebuild_estimate.wording import built_in, wording_for

    assert built_in("DRY1/2", "&") == 'Drywall 1/2" - tear out, hang new, tape & finish'
    assert built_in("INSBTF4+", "&") == "Insulation R-13 faced batt (2x4 wall) - remove & replace"
    assert built_in("INSBTF4+", "M") == "Insulation R-13 faced batt (2x4 wall) - material only"
    assert built_in("PNTSP", "+") == "{S} - seal/prime & paint, 1 coat each"
    assert built_in("PNTB", "I") == "Baseboard - paint, 1 coat - labor only"
    assert built_in("FCWLAM", "&") is None
    saved = {("DRY1/2", "&"): 'Drywall 1/2" - new, taped & finished'}
    assert wording_for("DRY1/2", "&", saved) == 'Drywall 1/2" - new, taped & finished'
    assert wording_for("DRY1/2", "-", saved) == 'Drywall 1/2" - tear out'


def test_a_company_keeps_its_own_words(session):
    from app.domains.rebuild_estimate.wording import save_wording, saved_wordings

    mine, theirs = str(uuid.uuid4()), str(uuid.uuid4())
    save_wording(session, None, "FCWLAM", "&", "Laminate floor - replace")
    save_wording(session, mine, "FCWLAM", "&", "Laminate - tear out & lay new")
    save_wording(session, mine, "FCWLAM", "&", "Laminate - remove & lay new")    # changed, not added
    assert saved_wordings(session, mine)[("FCWLAM", "&")] == "Laminate - remove & lay new"
    assert saved_wordings(session, theirs)[("FCWLAM", "&")] == "Laminate floor - replace"
    assert session.query(RebuildWording).count() == 2


def test_a_line_left_in_xactimates_words_is_pointed_out(session, service):
    est = new(service)
    est = service.update(est["id"], RebuildEstimateUpdate(lines=[
        {"id": "a", "description": "Snaplock Laminate - simulated wood flooring", "unit": "SF", "quantity": 10,
         "code": "FCWLAM", "activity": "&", "activities": [{"activity": "&", "price": 7.70, "material_share": 0.43}],
         "xact_words": True},
    ]))
    assert any("Xactimate's words" in w for w in est["assembled"]["warnings"])


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
    # In our words
    assert acts["&"]["wording"] == 'Drywall 1/2" - tear out, hang new, tape & finish' and found[0]["ours"]


def test_the_plain_item_comes_before_its_variants_and_ours_before_the_rest(session):
    from app.domains.rebuild_estimate.xactimate_search import search

    session.add(XactimateCategory(category_code="DRY", category_name="Drywall"))
    for code, words in (("DRY1/2FT", "hung & fire taped only"), ("DRY1/4", "hung, taped, floated, ready for paint"),
                        ("DRY1/2", "hung, taped, floated, ready for paint")):
        session.add(XactimateItem(item_code=code, category_code="DRY", description=f"drywall - {words}", unit="SF",
                                  activity="+", untaxed_unit_price=3, price_year=2026, price_month=11))
    session.flush()
    assert [m["code"] for m in search(session, "drywall hung")] == ["DRY1/2", "DRY1/4", "DRY1/2FT"]
    assert [m["ours"] for m in search(session, "drywall hung")] == [True, False, False]


def _price_list(session, *codes):
    rows = {
        "DRY1/2": ("DRY", "&", 3.80, 3.26, 0.54, 0.76), "PNTSP": ("PNT", "+", 1.38, None, None, 0.23),
        "PNTP": ("PNT", "+", 0.96, None, None, 0.17), "INSBTF4+": ("INS", "&", 1.63, 1.32, 0.31, 0.80),
    }
    for cat in {rows[c][0] for c in codes}:
        session.add(XactimateCategory(category_code=cat, category_name=cat))
    for code in codes:
        cat, act, price, rep_price, rem, mat = rows[code]
        session.add(XactimateItem(item_code=code, category_code=cat, description=f"{code} item {{V}}", unit="SF",
                                  activity=act, untaxed_unit_price=price, replace_price=rep_price, remove_price=rem,
                                  material_cost=mat, price_year=2026, price_month=11, price_list="NOV26"))
    session.flush()


def test_a_set_brings_its_lines_in_our_words_and_leaves_out_what_the_list_lacks(session):
    from app.domains.rebuild_estimate.assemblies import assemblies

    _price_list(session, "DRY1/2", "PNTSP", "PNTP")
    sets = {a["key"]: a for a in assemblies(session, {})}
    walls = sets["walls_drywall"]
    assert walls["asks_cut"] is True
    assert [(i["code"], i["activity"], i["basis"], i["cut_part"], i["only_with_cut"]) for i in walls["items"]] == [
        ("DRY1/2", "&", "wall_sf", "below", False), ("PNTSP", "+", "wall_sf", "below", False),
        ("PNTP", "+", "wall_sf", "above", True),
    ]
    assert walls["items"][1]["match"]["activities"][0]["wording"] == "{S} - seal/prime & paint, 1 coat each"
    # No insulation in this price list: the set comes without it; none of the
    # masking, film or cleaning lines: those sets aren't offered
    assert [i["code"] for i in sets["walls_drywall_insulation"]["items"]] == ["DRY1/2", "PNTSP", "PNTP"]
    assert "paint_prep" not in sets and "final_clean" not in sets


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


# ── Its own sketch ──

def _drawn(est):
    return {r["name"]: r for r in est["rooms"] if r.get("sketch_room_id")}


def test_each_room_drawn_is_a_room_measured_from_the_drawing(session, service):
    from app.domains.flooring_estimate.geometry import measure_sketch

    est = new(service)
    est = service.save_sketch(est["id"], house())
    rooms = _drawn(est)
    assert set(rooms) == {"Living Room", "Kitchen", "Hallway", "Bedroom 1", "Closet", "Bedroom 2", "Bathroom"}
    kitchen = {m.room_id: m for m in measure_sketch(house())}["kitchen"]
    assert rooms["Kitchen"]["measures"] == {
        "floor_sf": pytest.approx(kitchen.floor_sf, abs=0.01), "ceiling_sf": pytest.approx(kitchen.ceiling_sf, abs=0.01),
        "wall_sf": pytest.approx(kitchen.wall_net_sf, abs=0.01),
        "exterior_wall_sf": pytest.approx(kitchen.exterior_wall_sf, abs=0.01),
        "perimeter_lf": pytest.approx(kitchen.perimeter_lf, abs=0.01), "height_ft": 8.0,
    }
    assert rooms["Kitchen"]["level_name"] == "Main Level" and rooms["Kitchen"]["id"] == "sk-kitchen"

    # Renamed and made taller on the sketch, the room follows
    sketch = house()
    sketch["levels"][0]["rooms"][1].update(name="Kitchen / Dining", height_ft=9)
    est = service.save_sketch(est["id"], sketch)
    rooms = _drawn(est)
    assert "Kitchen" not in rooms and rooms["Kitchen / Dining"]["measures"]["height_ft"] == 9
    assert rooms["Kitchen / Dining"]["id"] == "sk-kitchen"


def test_a_room_taken_off_the_sketch_goes_unless_it_holds_lines(session, service):
    est = new(service)
    est = service.save_sketch(est["id"], house())
    est = service.update(est["id"], RebuildEstimateUpdate(lines=[
        {"id": "a", "room_id": "sk-bed2", "section": "wall", "description": "Paint the walls - one coat", "unit": "SF",
         "basis": "wall_sf", "code": "PNTP", "activity": "+", "activities": [PAINT]},
    ]))
    sketch = house()
    level = sketch["levels"][0]
    level["rooms"] = [r for r in level["rooms"] if r["id"] not in ("bed2", "bath")]
    level["openings"] = [o for o in level["openings"] if not {"bed2", "bath"} & set(o["rooms"])]
    est = service.save_sketch(est["id"], sketch)
    rooms = {r["name"]: r for r in est["rooms"]}
    # The empty bathroom is gone; bedroom 2 stays with its repair, as last measured, no longer drawn
    assert "Bathroom" not in rooms
    assert rooms["Bedroom 2"]["sketch_room_id"] is None and rooms["Bedroom 2"]["measures"]["floor_sf"] > 100
    assert lines_of(est, "Bedroom 2")["wall"][0]["description"] == "Paint the walls - one coat"

    # Drawn again (an undo), it is the same room again
    est = service.save_sketch(est["id"], house())
    assert _drawn(est)["Bedroom 2"]["id"] == "sk-bed2" and _drawn(est)["Bathroom"]["id"] == "sk-bath"


def test_a_page_a_save_behind_cannot_change_the_rooms_drawn(session, service):
    est = new(service)
    est = service.save_sketch(est["id"], house())
    stale = [dict(r, measures={"floor_sf": 1}, name="Old name") if r["id"] == "sk-living" else r
             for r in est["rooms"] if r["id"] != "sk-hall"]
    est = service.update(est["id"], RebuildEstimateUpdate(rooms=stale))
    rooms = _drawn(est)
    assert rooms["Living Room"]["measures"]["floor_sf"] == pytest.approx(212.5)
    assert "Hallway" in rooms and "Old name" not in rooms


def test_a_room_drawn_joins_the_room_an_estimate_brought_in(session, service):
    est = new(service)
    est = service.import_source(est["id"], ImportRequest(kind="cabinet", estimate_id=cabinets(session)))
    kitchen_id = next(r["id"] for r in est["rooms"] if r["name"] == "Kitchen")
    # Drawn, then named Kitchen: the kitchen estimate's room is the one drawn, no second kitchen
    sketch = house()
    sketch["levels"][0]["rooms"][1]["name"] = "Room 2"
    est = service.save_sketch(est["id"], sketch)
    assert [r["name"] for r in est["rooms"]].count("Room 2") == 1
    est = service.save_sketch(est["id"], house())
    kitchens = [r for r in est["rooms"] if r["name"] == "Kitchen"]
    assert len(kitchens) == 1 and kitchens[0]["id"] == kitchen_id
    assert kitchens[0]["sketch_room_id"] == "kitchen" and kitchens[0]["measures"]["floor_sf"] > 100
    assert lines_of(est, "Kitchen")["cabinets"]


def test_the_sketch_can_start_from_the_flooring_estimates(session, service):
    floor_id = flooring(session)
    est = new(service)
    est = service.import_source(est["id"], ImportRequest(kind="flooring", estimate_id=floor_id))
    brought = {r["name"]: r["id"] for r in est["rooms"]}
    admin = type("Staff", (), {"id": "x", "role": "admin"})()
    offered = [o for o in service.importable(est["id"], admin) if o["kind"] == "flooring"]
    assert offered[0]["sketch_rooms"] == 7

    est = service.copy_flooring_sketch(est["id"], floor_id)
    rooms = {r["name"]: r for r in est["rooms"]}
    # The rooms it brought in are the rooms drawn; the two it left out are drawn too
    assert len(est["rooms"]) == 7
    for name, room_id in brought.items():
        assert rooms[name]["id"] == room_id and rooms[name]["sketch_room_id"]
    assert rooms["Bedroom 2"]["id"] == "sk-bed2"
    with pytest.raises(HTTPException):
        service.copy_flooring_sketch(est["id"], floor_id)


def test_the_pdf_draws_the_rooms_drawn(session, service):
    from pypdf import PdfReader

    from app.domains.rebuild_estimate.export_service import RebuildExportService

    est = new(service)
    est = service.save_sketch(est["id"], house())
    est = service.update(est["id"], RebuildEstimateUpdate(lines=[
        {"id": "a", "room_id": "sk-kitchen", "section": "wall", "description": "Paint the walls - one coat",
         "unit": "SF", "basis": "wall_sf", "code": "PNTP", "activity": "+", "activities": [PAINT]},
    ]))
    text = "\n".join(p.extract_text() for p in PdfReader(RebuildExportService().generate_pdf(est)).pages)
    # The drawing's wall lengths print beside the room's name
    assert "Kitchen" in text and "Main Level" in text and "14' 0\"" in text
