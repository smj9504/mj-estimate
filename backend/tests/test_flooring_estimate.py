"""A flooring estimate is priced room by room from its sketch. Every
quantity is measured from the rooms (interior, wall to wall); the work that
comes with a new floor (base trim, toilets, toe kicks, transitions...) is
offered on every room, starts on only where the sketch makes it plain, and
is the estimator's to switch, size and price. What the estimator chose
lives in the scope, so it survives every recalculation. On a throwaway
SQLite database where a database is needed."""

import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import uuid

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.core.database_factory import SQLAlchemySession, get_db_session  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.flooring_estimate import pricing  # noqa: E402
from app.domains.flooring_estimate.calculator import build_takeoff, calculate_estimate  # noqa: E402
from app.domains.flooring_estimate.geometry import measure_sketch  # noqa: E402
from app.domains.flooring_estimate.models import (  # noqa: E402
    FlooringEstimate, FlooringEstimateHistory, FlooringEstimateLineItem,
)
from app.domains.flooring_estimate.schemas import (  # noqa: E402
    FlooringEstimateCreate, FlooringEstimateUpdate, FlooringSketch, JobScope, RoomScope,
)
from app.domains.flooring_estimate.service import FlooringEstimateService  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
from app.domains.unit_prices.models import PriceBook, UnitPriceChange, UnitPriceOverride  # noqa: E402
from app.domains.unit_prices.service import UnitPriceService  # noqa: E402
from app.domains.unit_prices.tables import use_prices  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


# ── A small house: living room, L-shaped kitchen, hall, two bedrooms, a
# closet and a bathroom, with 4.5" walls between them ──

def P(*pts):
    return [{"x": x, "y": y} for x, y in pts]


def house(**level_extra):
    level = {
        "id": "main", "name": "Main Level",
        "rooms": [
            {"id": "living", "name": "Living Room", "points": P((0, 0), (15, 0), (15, 14.1667), (0, 14.1667))},
            {"id": "kitchen", "name": "Kitchen", "points": P(
                (15.375, 0), (29.375, 0), (29.375, 8), (25.375, 8), (25.375, 11.5), (15.375, 11.5))},
            {"id": "hall", "name": "Hallway", "points": P((15.375, 11.875), (19.375, 11.875), (19.375, 24.0417), (15.375, 24.0417))},
            {"id": "bed1", "name": "Bedroom 1", "points": P((0, 14.5417), (15, 14.5417), (15, 26.0417), (0, 26.0417))},
            {"id": "closet", "name": "Closet", "subroom_of": "bed1",
             "points": P((9.5, 26.4167), (15, 26.4167), (15, 28.4167), (9.5, 28.4167))},
            {"id": "bed2", "name": "Bedroom 2", "points": P((19.75, 11.875), (29.375, 11.875), (29.375, 24.0417), (19.75, 24.0417))},
            {"id": "bath", "name": "Bathroom", "points": P((15.375, 24.4167), (23.375, 24.4167), (23.375, 29.4167), (15.375, 29.4167))},
        ],
        "openings": [
            {"id": "o1", "kind": "opening", "rooms": ["living", "kitchen"], "a": {"x": 15, "y": 2}, "b": {"x": 15, "y": 8}},
            {"id": "o2", "kind": "exterior_door", "rooms": ["living", None], "a": {"x": 5, "y": 0}, "b": {"x": 8, "y": 0},
             "swing": "living"},
            {"id": "o3", "kind": "opening", "rooms": ["hall", "kitchen"], "a": {"x": 15.875, "y": 11.875}, "b": {"x": 18.875, "y": 11.875}},
            {"id": "o4", "kind": "door", "rooms": ["hall", "bed1"], "a": {"x": 15.375, "y": 16}, "b": {"x": 15.375, "y": 18.5},
             "swing": "bed1"},
            {"id": "o5", "kind": "door", "rooms": ["hall", "bed2"], "a": {"x": 19.375, "y": 19}, "b": {"x": 19.375, "y": 21.5},
             "swing": "bed2"},
            {"id": "o6", "kind": "door", "rooms": ["hall", "bath"], "a": {"x": 16, "y": 24.0417}, "b": {"x": 18.5, "y": 24.0417},
             "swing": "bath"},
            {"id": "o7", "kind": "bifold", "rooms": ["bed1", "closet"], "a": {"x": 10, "y": 26.0417}, "b": {"x": 14.5, "y": 26.0417},
             "swing": "closet"},
        ],
        "cabinet_runs": [{"id": "c1", "room_id": "kitchen", "a": {"x": 15.375, "y": 0}, "b": {"x": 29.375, "y": 0}}],
        "fixtures": [
            {"id": "f1", "type": "refrigerator", "x": 28, "y": 3, "w": 3, "h": 3},
            {"id": "f2", "type": "range", "x": 22, "y": 1.2, "w": 2.5, "h": 2.2},
            {"id": "f3", "type": "toilet", "x": 17, "y": 28, "w": 1.6, "h": 2.4},
        ],
    }
    level.update(level_extra)
    return {"version": 1, "units": "ft", "levels": [level]}


def scopes(**changes):
    base = {
        "living": {"new_material": "lvp", "existing_material": "carpet"},
        "kitchen": {"new_material": "lvp", "existing_material": "sheet_vinyl"},
        "hall": {"new_material": "lvp", "existing_material": "carpet"},
        "bed1": {"new_material": "carpet", "existing_material": "carpet"},
        "closet": {"new_material": "carpet", "existing_material": "carpet"},
        "bed2": {"included": False, "existing_material": "carpet"},
        "bath": {"included": False, "existing_material": "ceramic_tile"},
    }
    for room, scope in changes.items():
        base[room] = {**base.get(room, {}), **scope}
    return base


def estimate(sketch=None, room_scopes=None, job_scope=None, **fields):
    values = {
        "sketch_data": house() if sketch is None else sketch,
        "room_scopes": scopes() if room_scopes is None else room_scopes,
        "job_scope": job_scope or {},
        "state": "VA", "zip_code": "22030",
        "include_overhead_profit": False, "overhead_pct": 0.10, "profit_pct": 0.10,
    }
    values.update(fields)
    return SimpleNamespace(**values)


def measured(sketch=None):
    return {m.room_id: m for m in measure_sketch(sketch or house())}


def lines_of(result, room_name):
    return {li["item_key"]: li for li in result["line_items"] if li["room_name"] == room_name}


def row(estimate_, room_id, key):
    t = build_takeoff(estimate_)
    return next(r for r in t.rows[room_id] if r.key == key)


# ── Measuring ──

def test_a_room_is_measured_wall_to_wall_from_its_outline():
    rooms = measured()
    assert rooms["living"].floor_sf == pytest.approx(212.50, abs=0.01)
    assert rooms["living"].perimeter_lf == pytest.approx(58.33, abs=0.01)
    assert rooms["living"].floor_sy == pytest.approx(23.61, abs=0.01)
    # The L-shaped kitchen: 14 x 8 plus 10 x 3'6"
    assert rooms["kitchen"].floor_sf == pytest.approx(147.0)
    assert rooms["kitchen"].perimeter_lf == pytest.approx(51.0)
    assert rooms["living"].wall_sf == pytest.approx(58.33 * 8, abs=0.1)


def test_baseboard_runs_the_perimeter_less_doorways_and_cabinets():
    rooms = measured()
    # Living room: a 6' opening to the kitchen and a 3' front door
    assert rooms["living"].base_lf == pytest.approx(58.33 - 9, abs=0.01)
    # Kitchen: those, the 3' opening to the hall, and 14' of base cabinets
    assert rooms["kitchen"].base_lf == pytest.approx(51 - 6 - 3 - 14)
    assert rooms["kitchen"].toe_kick_lf == pytest.approx(14)
    assert rooms["hall"].base_lf == pytest.approx(32.33 - 3 - 2.5 * 3, abs=0.01)


def test_a_door_belongs_to_the_room_it_swings_into():
    rooms = measured()
    assert (rooms["living"].door_count, rooms["living"].exterior_door_count) == (1, 1)
    assert rooms["hall"].door_count == 0
    assert rooms["bed1"].door_count == 1
    assert rooms["closet"].door_count == 1


def test_fixtures_count_in_the_room_they_stand_in_and_an_island_takes_its_floor():
    sketch = house()
    sketch["levels"][0]["fixtures"].append({"id": "f4", "type": "island", "x": 20, "y": 5, "w": 6, "h": 3})
    rooms = measured(sketch)
    assert rooms["kitchen"].appliance_count == 2
    assert rooms["bath"].toilet_count == 1
    assert rooms["kitchen"].floor_sf == pytest.approx(147 - 18)
    assert rooms["kitchen"].toe_kick_lf == pytest.approx(14 + 18)

    sketch["levels"][0]["fixtures"][-1]["floor_under"] = True
    assert measured(sketch)["kitchen"].floor_sf == pytest.approx(147)


def test_a_wall_built_out_from_a_wall_takes_baseboard_on_its_faces_and_its_end():
    sketch = house()
    level = sketch["levels"][0]
    # A 4' wall end out of the living room's back wall, 4.5" thick, stopping in the room
    level["walls"] = [{"id": "w1", "room_id": "living", "a": {"x": 6, "y": 14.1667}, "b": {"x": 6, "y": 10.1667},
                       "thickness": 0.375}]
    FlooringSketch.model_validate(sketch)
    living = measured(sketch)["living"]
    # Its two faces and its end, less the 4.5" of the back wall it stands against
    assert living.perimeter_lf == pytest.approx(58.33 + 2 * 4 + 0.375 - 0.375, abs=0.01)
    assert living.base_lf == pytest.approx(58.33 - 9 + 8, abs=0.01)
    assert living.floor_sf == pytest.approx(212.5 - 4 * 0.375, abs=0.01)

    # Run across the room from wall to wall, it has no end showing
    level["walls"][0]["b"] = {"x": 6, "y": 0}
    across = measured(sketch)["living"]
    assert across.perimeter_lf == pytest.approx(58.33 + 2 * 14.1667 - 2 * 0.375, abs=0.01)

    level["walls"][0]["room_id"] = "garage"
    with pytest.raises(ValidationError, match="isn't drawn"):
        FlooringSketch.model_validate(sketch)


def test_a_closet_comes_right_after_its_room():
    order = [m.room_id for m in measure_sketch(house())]
    assert order.index("closet") == order.index("bed1") + 1


# ── The room's own floor ──

def test_new_floor_takes_waste_and_says_how_many_boxes():
    living = lines_of(calculate_estimate(estimate()), "Living Room")
    lvp = living["install"]
    assert lvp["quantity"] == pytest.approx(233.75)
    assert lvp["notes"] == "Incl. 10% waste · order 12 boxes @ 20 SF"
    assert living["removal"]["description"] == "Remove carpet & pad"
    assert living["removal"]["quantity"] == pytest.approx(212.5)


def test_a_pattern_adds_waste_and_labor():
    est = estimate(room_scopes=scopes(living={"pattern": "herringbone"}))
    lvp = row(est, "living", "install")
    assert lvp.qty == pytest.approx(212.5 * 1.20, abs=0.01)
    assert "herringbone" in lvp.label
    material, labor = pricing.FLOORING_MATERIAL["lvp"], pricing.FLOORING_INSTALL_LABOR["lvp"]
    assert lvp.unit_price == pytest.approx(material + labor * 1.40)


def test_carpet_wide_enough_for_the_roll_is_priced_by_its_cut_and_a_closet_by_waste():
    result = calculate_estimate(estimate())
    bedroom = lines_of(result, "Bedroom 1")["install"]
    # 11'6" across fits one 12' drop; 15' + 3" trim long
    assert bedroom["unit"] == "SY"
    assert bedroom["quantity"] == pytest.approx(15.25 * 12 / 9, abs=0.01)
    assert bedroom["notes"] == "12' roll · 1 cut 15' 3\" incl. trim · no seam"
    closet = lines_of(result, "Closet")["install"]
    assert closet["quantity"] == pytest.approx(11 * 1.15 / 9, abs=0.01)
    assert "remnant" in closet["notes"]
    assert lines_of(result, "Bedroom 1")["pad"]["quantity"] == pytest.approx(172.5 * 1.05 / 9, abs=0.01)


def test_a_room_can_be_torn_out_without_a_new_floor():
    est = estimate(room_scopes=scopes(hall={"items": {"install": {"on": False}}}))
    result = calculate_estimate(est)
    hall = lines_of(result, "Hallway")
    assert "install" not in hall and "removal" in hall
    assert not any("Hallway" in w for w in result["warning_flags"])


def test_a_room_with_no_floor_picked_is_flagged():
    est = estimate(room_scopes=scopes(hall={"new_material": None}))
    est.room_scopes["hall"].pop("new_material")
    assert any(w.startswith("Hallway:") for w in calculate_estimate(est)["warning_flags"])


def test_the_job_default_floor_fills_rooms_that_have_none():
    est = estimate(
        room_scopes={"bed2": {"included": False}, "bath": {"included": False}},
        job_scope={"defaults": {"new_material": "laminate", "existing_material": "carpet"}},
    )
    living = lines_of(calculate_estimate(est), "Living Room")
    assert living["install"]["description"].startswith("Laminate")
    # Laminate floats over an underlayment roll: that starts on
    assert "underlayment" in living


# ── The work that comes with it ──

def test_items_start_on_only_where_the_sketch_makes_it_plain():
    t = build_takeoff(estimate())
    on = {room: {r.key for r in rows if r.on} for room, rows in t.rows.items()}
    assert {"baseboard_paint", "shoe_molding_remove", "shoe_molding"} <= on["living"]   # new LVP
    assert "tack_strip" in on["bed1"]                         # new carpet
    assert "shoe_molding" not in on["bed1"]
    assert {"refrigerator_detach_reset", "range_detach_reset"} <= on["kitchen"]   # fridge and range drawn
    assert "transition" in on["hall"]
    for situational in ("baseboard_detach_reset", "baseboard_remove", "quarter_round", "toe_kick_detach_reset",
                        "toe_kick_reskin", "door_undercut", "vanity_detach_reset", "register_replace",
                        "appliance_detach_reset", "dishwasher_detach_reset", "range_gas_detach_reset",
                        "contents_move", "self_leveling"):
        assert not any(situational in keys for keys in on.values()), situational


def test_a_toilet_drawn_in_a_room_brings_its_detach_and_reset():
    est = estimate(room_scopes=scopes(bath={"included": True, "new_material": "porcelain_tile"}))
    bath = lines_of(calculate_estimate(est), "Bathroom")
    assert bath["toilet_detach_reset"]["quantity"] == 1
    assert "cement_board" in bath


def test_trim_and_toe_kicks_are_measured_from_the_sketch():
    est = estimate(room_scopes=scopes(kitchen={"items": {
        "toe_kick_detach_reset": {"on": True}, "shoe_molding": {"on": True},
        "baseboard_detach_reset": {"on": False},
    }}))
    kitchen = lines_of(calculate_estimate(est), "Kitchen")
    assert kitchen["toe_kick_detach_reset"]["quantity"] == pytest.approx(14)
    # The baseboard's 28' and the 14' of cabinet front; the run's ends are against walls
    assert kitchen["shoe_molding"]["quantity"] == pytest.approx(28 + 14)
    assert "baseboard_detach_reset" not in kitchen


def test_a_room_choice_beats_the_job_choice_beats_the_default():
    est = estimate(
        room_scopes=scopes(hall={"items": {"shoe_molding": {"on": False}}}),
        job_scope={"room_items": {"shoe_molding": {"on": True}, "baseboard_paint": {"on": False}}},
    )
    t = build_takeoff(est)
    shoe = {room: next(r for r in rows if r.key == "shoe_molding") for room, rows in t.rows.items()}
    assert (shoe["living"].on, shoe["living"].on_source) == (True, "job")
    assert (shoe["hall"].on, shoe["hall"].on_source) == (False, "room")
    assert (shoe["bed1"].on, shoe["bed1"].default_on, shoe["bed1"].on_source) == (True, False, "job")
    base = next(r for r in t.rows["living"] if r.key == "baseboard_paint")
    assert (base.on, base.default_on, base.on_source) == (False, True, "job")


def test_tile_and_lvp_keep_the_base_and_paint_it_a_wood_floor_replaces_it():
    def trim_on(material):
        t = build_takeoff(estimate(room_scopes=scopes(living={"new_material": material})))
        return {r.key for r in t.rows["living"] if r.on and r.category == "trim"}

    keeps = {"baseboard_paint", "shoe_molding_remove", "shoe_molding"}
    for material in ("lvp", "laminate", "ceramic_tile", "porcelain_tile"):
        assert trim_on(material) == keeps, material
    replaced = {"baseboard_remove", "baseboard_install", "shoe_molding"}
    for material in ("engineered_hardwood", "solid_hardwood"):
        assert trim_on(material) == replaced, material
    assert trim_on("carpet") == {"tack_strip"}


# A kitchen 14' x 12' (x right, y down) with an L of base cabinets on its top
# and right walls, a fridge on the left wall, and an island
def kitchen_sketch(**island):
    return {"version": 1, "units": "ft", "levels": [{
        "id": "main", "name": "Main Level",
        "rooms": [{"id": "k", "name": "Kitchen", "points": P((0, 0), (14, 0), (14, 12), (0, 12))}],
        "openings": [],
        "cabinet_runs": [
            # Top wall from 4' in to the corner, right wall from the corner 8' down
            {"id": "top", "room_id": "k", "a": {"x": 4, "y": 0}, "b": {"x": 14, "y": 0}},
            {"id": "right", "room_id": "k", "a": {"x": 14, "y": 0}, "b": {"x": 14, "y": 8}},
        ],
        "fixtures": [{"id": "isl", "type": "island", "x": 7, "y": 7, "w": 6, "h": 3, **island}],
    }]}


def test_cabinets_take_shoe_molding_on_their_fronts_and_showing_sides_not_against_the_wall():
    from app.domains.flooring_estimate.geometry import cabinet_layout

    k = measured(kitchen_sketch())["k"]
    # The L's fronts, less the 2' square where the runs meet at the corner
    assert k.cabinet_front_lf == pytest.approx((10 - 2) + (8 - 2), abs=0.06)
    # Both runs stop in the open at one end: the top run 4' from the left
    # wall, the right run 8' down; the corner ends are against each other
    assert k.cabinet_side_lf == pytest.approx(2 + 2)
    perimeter = 52
    assert k.base_lf == pytest.approx(perimeter - 18)
    assert k.shoe_lf == pytest.approx(perimeter - 18 + 14 + 4 + 18, abs=0.06)
    assert k.toe_kick_lf == pytest.approx(14 + 18, abs=0.06)

    # A fridge beside the top run's end hides that side; one set on the run is taken as set
    sketch = kitchen_sketch()
    level = sketch["levels"][0]
    level["fixtures"].append({"id": "f", "type": "refrigerator", "x": 2.5, "y": 1.25, "w": 3, "h": 2.5})
    layout = {r["id"]: r for r in cabinet_layout(level["cabinet_runs"], [(0, 0), (14, 0), (14, 12), (0, 12)],
                                                  level["fixtures"])}
    assert (layout["top"]["side_a"], layout["top"]["side_b"]) == (False, False)
    assert (layout["right"]["side_a"], layout["right"]["side_b"]) == (False, True)
    level["cabinet_runs"][1]["side_b"] = False
    assert measured(sketch)["k"].cabinet_side_lf == 0


def test_a_wall_built_out_beside_a_cabinet_run_hides_its_side():
    sketch = kitchen_sketch()
    level = sketch["levels"][0]
    # A 4" wall 2' 2" out from the top wall, against the top run's open end
    level["walls"] = [{"id": "stub", "room_id": "k", "a": {"x": 4 - 1 / 6, "y": 0},
                       "b": {"x": 4 - 1 / 6, "y": 2 + 1 / 6}, "thickness": 1 / 3}]
    assert measured(sketch)["k"].cabinet_side_lf == pytest.approx(2)  # the right run's end only
    # A wall further off leaves the side showing
    level["walls"][0]["a"]["x"] = level["walls"][0]["b"]["x"] = 2
    assert measured(sketch)["k"].cabinet_side_lf == pytest.approx(4)


def test_shoe_molding_goes_behind_the_cabinets_only_when_they_come_out():
    est = estimate(sketch=kitchen_sketch(), room_scopes={"k": {"new_material": "lvp", "existing_material": "lvp"}})
    staying = lines_of(calculate_estimate(est), "Kitchen")
    assert "base_cabinet_detach_reset" not in staying
    est.room_scopes["k"]["items"] = {"base_cabinet_detach_reset": {"on": True}}
    out = lines_of(calculate_estimate(est), "Kitchen")
    assert out["base_cabinet_detach_reset"]["quantity"] == pytest.approx(18)
    assert out["base_cabinet_detach_reset"]["unit_price"] == pricing.CABINET_RATES["base_detach_reset_per_lf"]
    assert out["shoe_molding"]["quantity"] == pytest.approx(staying["shoe_molding"]["quantity"] + 18)
    assert out["shoe_molding_remove"]["quantity"] == pytest.approx(out["shoe_molding"]["quantity"])


def test_an_island_takes_shoe_molding_all_round_and_comes_out_when_the_floor_runs_under_it():
    around = {"k": {"new_material": "lvp", "existing_material": "lvp"}}
    left = lines_of(calculate_estimate(estimate(sketch=kitchen_sketch(), room_scopes=around)), "Kitchen")
    assert "island_detach_reset" not in left                      # the floor goes round it
    under = lines_of(calculate_estimate(estimate(sketch=kitchen_sketch(floor_under=True), room_scopes=around)),
                     "Kitchen")
    assert under["island_detach_reset"]["quantity"] == pytest.approx(6)
    assert under["shoe_molding"]["quantity"] == pytest.approx(left["shoe_molding"]["quantity"])
    assert "island_panel_detach_reset" not in under               # only when asked for
    est = estimate(sketch=kitchen_sketch(floor_under=True),
                   room_scopes={"k": {**around["k"], "items": {"island_panel_detach_reset": {"on": True}}}})
    panels = lines_of(calculate_estimate(est), "Kitchen")["island_panel_detach_reset"]
    assert panels["quantity"] == pytest.approx((6 + 2 * 3) * 2.875)
    assert panels["unit"] == "SF"


def test_a_vanity_drawn_brings_its_detach_and_reset():
    sketch = house()
    sketch["levels"][0]["fixtures"].append({"id": "v", "type": "vanity", "x": 21, "y": 25.3, "w": 2.5, "h": 1.75})
    est = estimate(sketch=sketch, room_scopes=scopes(bath={"included": True, "new_material": "porcelain_tile"}))
    assert lines_of(calculate_estimate(est), "Bathroom")["vanity_detach_reset"]["quantity"] == 1


def test_tear_out_extras_are_offered_and_priced_over_xactimate():
    est = estimate(room_scopes=scopes(bath={
        "included": True, "new_material": "porcelain_tile",
        "items": {"mortar_bed_removal": {"on": True}, "tile_on_slab_removal": {"on": True}},
    }))
    bath = lines_of(calculate_estimate(est), "Bathroom")
    assert bath["mortar_bed_removal"]["quantity"] == pytest.approx(40)
    assert bath["mortar_bed_removal"]["unit_price"] == pytest.approx(round(1.66 * pricing.XACTIMATE_MARKUP, 2))
    assert bath["tile_on_slab_removal"]["unit_price"] == pytest.approx(round(2.13 * pricing.XACTIMATE_MARKUP, 2))
    for key in ("glue_down_removal_concrete", "glue_down_removal_wood", "vinyl_extra_layer_removal"):
        assert key not in bath                                    # only when switched on
    assert 1.10 <= pricing.XACTIMATE_MARKUP <= 1.15


def test_registers_and_sinks_drawn_on_the_floor_bring_their_detach_and_reset():
    sketch = house()
    sketch["levels"][0]["fixtures"] += [
        {"id": "r1", "type": "floor_register", "x": 3, "y": 13, "w": 1, "h": 0.45},
        {"id": "r2", "type": "floor_register", "x": 12, "y": 13, "w": 1, "h": 0.45},
        {"id": "s1", "type": "pedestal_sink", "x": 21, "y": 25.3, "w": 1.75, "h": 1.5},
        {"id": "s2", "type": "utility_sink", "x": 17.5, "y": 22, "w": 2, "h": 2},
    ]
    FlooringSketch.model_validate(sketch)
    rooms = measured(sketch)
    assert rooms["living"].register_count == 2
    assert rooms["bath"].pedestal_sink_count == 1
    assert rooms["hall"].utility_sink_count == 1

    est = estimate(sketch=sketch, room_scopes=scopes(bath={"included": True, "new_material": "porcelain_tile"}))
    result = calculate_estimate(est)
    living, bath, hall = (lines_of(result, name) for name in ("Living Room", "Bathroom", "Hallway"))
    register = living["register_detach_reset"]
    assert (register["quantity"], register["unit_price"]) == (2, pricing.HVAC_RATES["floor_register_detach_reset"])
    assert "register_replace" not in living                   # only when the old one won't do
    assert bath["pedestal_sink_detach_reset"]["quantity"] == 1
    assert bath["toilet_detach_reset"]["quantity"] == 1
    assert hall["utility_sink_detach_reset"]["quantity"] == 1
    assert "pedestal_sink_detach_reset" not in living


def test_each_appliance_is_detached_and_reset_at_its_own_price_gas_or_electric():
    sketch = house()
    fixtures = sketch["levels"][0]["fixtures"]
    fixtures[1]["gas"] = True                                  # the range is on gas
    fixtures += [
        {"id": "f5", "type": "dishwasher", "x": 18, "y": 1, "w": 2, "h": 2},
        {"id": "f6", "type": "washer", "x": 17, "y": 14, "w": 2, "h": 2},
        {"id": "f7", "type": "dryer", "x": 17, "y": 17, "w": 2, "h": 2, "gas": True},
    ]
    rooms = measured(sketch)
    kitchen = rooms["kitchen"]
    assert (kitchen.appliance_count, kitchen.refrigerator_count, kitchen.range_count, kitchen.range_gas_count,
            kitchen.dishwasher_count) == (3, 1, 0, 1, 1)
    assert (rooms["hall"].washer_count, rooms["hall"].dryer_gas_count, rooms["hall"].dryer_count) == (1, 1, 0)

    result = calculate_estimate(estimate(sketch=sketch))
    lines = lines_of(result, "Kitchen")
    rates = pricing.DETACH_RESET_RATES
    for key, rate in (("refrigerator", "refrigerator"), ("range_gas", "range_gas"), ("dishwasher", "dishwasher")):
        line = lines[f"{key}_detach_reset"]
        assert (line["quantity"], line["unit_price"]) == (1, rates[rate]), key
    assert lines["range_gas_detach_reset"]["description"] == "Range - gas - detach & reset"
    assert "range_detach_reset" not in lines and "appliance_detach_reset" not in lines
    hall = lines_of(result, "Hallway")
    assert hall["dryer_gas_detach_reset"]["unit_price"] == rates["dryer_gas"]
    assert hall["washer_detach_reset"]["quantity"] == 1
    # Gas costs more to move than electric
    assert rates["range_gas"] > rates["range"] and rates["dryer_gas"] > rates["dryer"]


def test_a_toe_kick_can_be_reskinned_along_the_cabinets_and_island():
    sketch = house()
    sketch["levels"][0]["fixtures"].append({"id": "i1", "type": "island", "x": 20, "y": 5, "w": 6, "h": 3,
                                            "floor_under": True})
    est = estimate(sketch=sketch, room_scopes=scopes(kitchen={"items": {"toe_kick_reskin": {"on": True}}}))
    reskin = lines_of(calculate_estimate(est), "Kitchen")["toe_kick_reskin"]
    assert reskin["quantity"] == pytest.approx(14 + 18)
    assert reskin["description"] == "Cabinet toe kick - reskin"


def test_an_open_wall_is_a_side_with_no_wall_measured_like_a_doorway():
    sketch = house()
    openings = sketch["levels"][0]["openings"]
    # The living room open to the kitchen along the whole of the kitchen's side
    openings[0] = {"id": "o1", "kind": "open_wall", "rooms": ["living", "kitchen"],
                   "a": {"x": 15, "y": 0}, "b": {"x": 15, "y": 11.5}}
    FlooringSketch.model_validate(sketch)
    rooms = measured(sketch)
    assert rooms["living"].base_lf == pytest.approx(58.33 - 11.5 - 3, abs=0.01)
    assert rooms["kitchen"].base_lf == pytest.approx(51 - 11.5 - 3 - 14)
    assert rooms["living"].door_count == 1                    # the front door only
    # Where the floor changes across it, it takes a transition
    est = estimate(sketch=sketch, room_scopes=scopes(kitchen={"new_material": "porcelain_tile"}))
    assert lines_of(calculate_estimate(est), "Living Room")["transition"]["notes"] == "To Kitchen (porcelain)"


def test_transitions_go_where_the_floor_changes():
    result = calculate_estimate(estimate())
    hall = lines_of(result, "Hallway")["transition"]
    assert hall["quantity"] == 3
    assert hall["notes"] == "To Bedroom 1 (carpet), Bedroom 2 (carpet - existing), Bathroom (ceramic - existing)"
    # LVP to LVP needs none, and a front door takes a threshold, not a transition
    assert "transition" not in lines_of(result, "Living Room")
    assert "transition" not in lines_of(result, "Kitchen")


def test_rooms_left_out_have_no_lines():
    rooms = {li["room_name"] for li in calculate_estimate(estimate())["line_items"]}
    assert {"Bedroom 2", "Bathroom"}.isdisjoint(rooms)


def test_the_general_section_covers_the_job():
    result = calculate_estimate(estimate())
    general = lines_of(result, "General")
    assert general["haul_debris"]["quantity"] == 1
    floored = 212.5 + 147 + 48.6668 + 172.5 + 11
    assert general["final_clean"]["quantity"] == pytest.approx(floored, abs=0.01)
    assert "dumpster" not in general


# ── Prices ──

def test_a_typed_quantity_and_price_are_used_as_entered():
    est = estimate(
        room_scopes=scopes(living={"items": {"baseboard_paint": {"qty": 40, "unit_price": 3.10, "note": "Front wall only"}}}),
        include_overhead_profit=True,
    )
    base = lines_of(calculate_estimate(est), "Living Room")["baseboard_paint"]
    assert (base["quantity"], base["unit_price"], base["total"]) == (40, 3.10, 124.0)
    assert base["notes"] == "Front wall only"


def test_catalog_prices_carry_material_tax_and_op_folded_in():
    plain = lines_of(calculate_estimate(estimate()), "Living Room")["install"]
    material, labor = pricing.FLOORING_MATERIAL["lvp"], pricing.FLOORING_INSTALL_LABOR["lvp"]
    # Northern Virginia: 6% on the material part only
    assert plain["unit_price"] == pytest.approx(round(material * 1.06 + labor, 2))
    with_op = lines_of(calculate_estimate(estimate(include_overhead_profit=True)), "Living Room")["install"]
    assert with_op["unit_price"] == pytest.approx(round((material * 1.06 + labor) * 1.21, 2))
    removal = lines_of(calculate_estimate(estimate()), "Living Room")["removal"]
    assert removal["unit_price"] == pytest.approx(pricing.REMOVAL_RATES["carpet"])  # labor: no tax


def test_custom_items_on_a_room_and_on_the_job():
    est = estimate(
        room_scopes=scopes(kitchen={"custom_items": [
            {"id": "c1", "description": "Detach & reset island countertop", "quantity": 1, "unit": "EA", "unit_price": 350},
            {"id": "c2", "description": "Floor leveling - pantry", "quantity": 12, "unit": "SF",
             "price_key": "PREP_RATES.self_leveling_per_sf"},
            {"id": "c3", "description": "Ask the adjuster", "quantity": 1},
        ]}),
        job_scope={"custom_items": [{"description": "Permit allowance", "quantity": 1, "unit_price": 150}]},
    )
    result = calculate_estimate(est)
    kitchen = lines_of(result, "Kitchen")
    assert (kitchen["c1"]["total"], kitchen["c1"]["source"]) == (350, "custom")
    leveling = pricing.PREP_RATES["self_leveling_per_sf"]
    share = 0.40
    assert kitchen["c2"]["unit_price"] == pytest.approx(round(leveling * (1 + share * 0.06), 2))
    assert '"Ask the adjuster" has no price' in " ".join(result["warning_flags"])
    assert lines_of(result, "General")["custom_1"]["total"] == 150


def test_a_price_book_prices_the_estimate():
    with use_prices({"FLOORING_MATERIAL.lvp": [6.00, 0], "TRIM_RATES.baseboard_paint_per_lf": [0, 3.00]}):
        living = lines_of(calculate_estimate(estimate()), "Living Room")
    assert living["install"]["unit_price"] == pytest.approx(round(6.00 * 1.06 + pricing.FLOORING_INSTALL_LABOR["lvp"], 2))
    assert living["baseboard_paint"]["unit_price"] == 3.00


def test_the_total_is_the_sum_of_lines_each_qty_times_price():
    result = calculate_estimate(estimate(include_overhead_profit=True))
    assert result["total"] == pytest.approx(sum(li["total"] for li in result["line_items"]), abs=0.005)
    for li in result["line_items"]:
        assert li["total"] == pytest.approx(round(li["quantity"] * li["unit_price"], 2), abs=0.005)
    room_totals = sum(r["total"] for r in result["rooms"]) + result["general_total"]
    assert room_totals == pytest.approx(result["total"], abs=0.01)


# ── What the estimator may send ──

def test_a_sketch_has_to_hang_together():
    FlooringSketch.model_validate(house())
    bad_opening = house()
    bad_opening["levels"][0]["openings"].append(
        {"id": "o9", "kind": "door", "rooms": ["living", "garage"], "a": {"x": 0, "y": 1}, "b": {"x": 0, "y": 4}})
    with pytest.raises(ValidationError, match="isn't drawn"):
        FlooringSketch.model_validate(bad_opening)
    two_points = house()
    two_points["levels"][0]["rooms"][0]["points"] = P((0, 0), (1, 1))
    with pytest.raises(ValidationError):
        FlooringSketch.model_validate(two_points)


def test_unknown_items_and_floors_are_refused():
    with pytest.raises(ValidationError, match="Unknown room item"):
        RoomScope.model_validate({"items": {"shoe_moulding": {"on": True}}})
    with pytest.raises(ValidationError, match="Unknown floor"):
        RoomScope.model_validate({"new_material": "bamboo"})
    with pytest.raises(ValidationError, match="Unknown general item"):
        JobScope.model_validate({"items": {"tack_strip": {"on": True}}})
    with pytest.raises(ValidationError, match="set on the room"):
        JobScope.model_validate({"room_items": {"shoe_molding": {"qty": 20}}})


# ── Saved estimates ──

@pytest.fixture
def session(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'floor.db'}")
    for model in (PriceBook, UnitPriceOverride, UnitPriceChange, Company, Client, Claim,
                  FlooringEstimate, FlooringEstimateLineItem, FlooringEstimateHistory):
        model.__table__.create(engine)
    s = SQLAlchemySession(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)())
    yield s
    s.close()


@pytest.fixture
def service(session):
    return FlooringEstimateService(session)


def new_estimate(service, **fields):
    return service.create_estimate(FlooringEstimateCreate(
        property_address="123 Example St", city="Anytown", state="VA", zip_code="22030",
        sketch_data=house(), room_scopes=scopes(), **fields,
    ))


def test_an_estimate_shows_every_room_and_item_before_it_is_calculated(service):
    est = new_estimate(service)
    assert est["status"] == "draft" and est["kind"] == "restore" and est["group_id"] == est["id"]
    rooms = {r["room_id"]: r for r in est["takeoff"]["rooms"]}
    assert rooms["living"]["floor_sf"] == pytest.approx(212.5)
    keys = [item["key"] for item in rooms["living"]["items"]]
    assert {"install", "removal", "shoe_molding", "toilet_detach_reset", "toe_kick_detach_reset"} <= set(keys)
    shoe = next(item for item in rooms["living"]["items"] if item["key"] == "shoe_molding")
    assert (shoe["on"], shoe["auto_qty"]) == (True, pytest.approx(49.33, abs=0.01))
    assert shoe["estimated_total"] > 0
    reskin = next(item for item in rooms["kitchen"]["items"] if item["key"] == "toe_kick_reskin")
    assert (reskin["on"], reskin["auto_qty"], reskin["estimated_total"]) == (False, pytest.approx(14), 0.0)


def test_choices_survive_recalculation(service):
    est = new_estimate(service)
    first = service.calculate(est["id"])
    assert first["status"] == "calculated"
    assert first["total"] == pytest.approx(sum(li["total"] for li in first["line_items"]), abs=0.01)
    assert {r["room_id"] for r in first["calculated_rooms"]} == {"living", "kitchen", "hall", "bed1", "closet"}

    service.update_estimate(est["id"], FlooringEstimateUpdate(room_scopes=scopes(kitchen={
        "items": {"toe_kick_detach_reset": {"on": True}},
        "custom_items": [{"id": "c1", "description": "Detach & reset island countertop", "unit_price": 350}],
    })))
    second = service.calculate(est["id"])
    third = service.calculate(est["id"])
    for result in (second, third):
        kitchen = {li["item_key"] for li in result["line_items"] if li["room_name"] == "Kitchen"}
        assert {"toe_kick_detach_reset", "c1"} <= kitchen
    assert third["total"] == pytest.approx(second["total"])
    assert len(service.get_history(est["id"])) == 3


def test_the_sketch_saves_on_its_own_and_the_quantities_follow_it(service):
    est = new_estimate(service)
    bigger = house()
    bigger["levels"][0]["rooms"][0]["points"] = P((0, 0), (16, 0), (16, 14.1667), (0, 14.1667))
    saved = service.save_sketch(est["id"], FlooringSketch.model_validate(bigger))
    living = next(r for r in saved["takeoff"]["rooms"] if r["room_id"] == "living")
    assert living["floor_sf"] == pytest.approx(16 * 14.1667, abs=0.01)
    assert saved["room_scopes"]["living"]["new_material"] == "lvp"


def test_an_estimate_keeps_its_prices_until_asked_to_move(service, session):
    company = Company(name="Sample Co")
    session.add(company)
    session.flush()
    est = new_estimate(service, company_id=str(company.id))
    first = service.calculate(est["id"])
    lvp_price = lines_of(first, "Living Room")["install"]["unit_price"]

    UnitPriceService(session).save("flooring", str(company.id), {"FLOORING_MATERIAL.lvp": {"material": 7.00}})
    again = service.calculate(est["id"])
    assert lines_of(again, "Living Room")["install"]["unit_price"] == lvp_price
    assert again["price_book"]["is_current"] is False

    moved = service.use_current_prices(est["id"])
    labor = pricing.FLOORING_INSTALL_LABOR["lvp"]
    assert lines_of(moved, "Living Room")["install"]["unit_price"] == pytest.approx(round(7.00 * 1.06 + labor, 2))
    assert moved["price_book"]["is_current"] is True


def test_a_clone_is_a_new_draft_with_the_same_scope_priced_afresh(service):
    est = new_estimate(service)
    service.calculate(est["id"])
    clone = service.clone_estimate(est["id"])
    assert clone["id"] != est["id"] and clone["group_id"] == clone["id"]
    assert clone["status"] == "draft"
    assert clone["room_scopes"] == service.get_estimate(est["id"])["room_scopes"]
    assert len(clone["line_items"]) == len(service.get_estimate(est["id"])["line_items"])
    assert clone["price_book"] is None


def test_the_api_creates_calculates_and_lists(session):
    from fastapi.testclient import TestClient

    def use_db():
        yield session

    app.main.app.dependency_overrides[get_db_session] = use_db
    app.main.app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(
        id=str(uuid.uuid4()), role=StaffRole.admin,
    )
    try:
        client = TestClient(app.main.app)
        created = client.post("/api/flooring-estimates", json={
            "property_address": "123 Example St", "state": "VA", "zip_code": "22030",
            "sketch_data": house(), "room_scopes": scopes(),
        })
        assert created.status_code == 200, created.text
        estimate_id = created.json()["id"]

        refused = client.put(f"/api/flooring-estimates/{estimate_id}",
                             json={"room_scopes": {"living": {"items": {"nope": {"on": True}}}}})
        assert refused.status_code == 422

        calculated = client.post(f"/api/flooring-estimates/{estimate_id}/calculate")
        assert calculated.status_code == 200, calculated.text
        assert calculated.json()["line_items"]

        info = client.get("/api/flooring-estimates/pricing-info", params={"estimate_id": estimate_id})
        assert info.status_code == 200
        assert {m["key"] for m in info.json()["materials"]} == set(pricing.MATERIALS)
        shoe = next(p for p in info.json()["price_list"] if p["key"] == "TRIM_RATES.shoe_molding_per_lf")
        assert (shoe["unit"], shoe["unit_price"]) == ("LF", pricing.TRIM_RATES["shoe_molding_per_lf"])

        listed = client.get("/api/flooring-estimates")
        assert [e["id"] for e in listed.json()["items"]] == [estimate_id]
    finally:
        app.main.app.dependency_overrides.pop(get_db_session, None)
        app.main.app.dependency_overrides.pop(get_current_staff, None)


# ── The PDF ──

def _pdf_text(pdf) -> str:
    from pypdf import PdfReader
    return "\n".join(page.extract_text() for page in PdfReader(pdf).pages)


def test_the_pdf_prints_each_room_as_a_card_with_its_lines_under_work_heads_then_the_plan(service):
    from app.domains.flooring_estimate.export_service import FlooringExportService

    est = new_estimate(service)
    service.calculate(est["id"])
    text = _pdf_text(FlooringExportService().generate_pdf(service.get_estimate(est["id"])))
    assert "FLOORING ESTIMATE" in text
    for room in ("Living Room", "Kitchen", "Hallway", "Bedroom 1", "Closet"):
        assert room in text, room
    # Each room's measurements in a line beside its sketch, its lines under work heads
    assert "SF floor" in text and "LF baseboard" in text and "Doorways:" in text
    for head in ("TEAR OUT", "FLOOR", "TRIM", "Trim subtotal"):
        assert head in text, head
    assert "15' 0\"" in text and "14' 2\"" in text
    # None of the Xactimate block: no wall and ceiling figures, no "Totals:" rows
    assert "SF Walls" not in text and "Totals:" not in text
    assert "Whole job" in text and "Grand total" in text
    # The plan, with the rooms left out marked
    assert "Floor Plan" in text and "Main Level" in text
    assert "Not in scope" in text
    assert "Bedroom 2" in text


def test_the_pdf_by_trade_and_as_a_proposal(service):
    from app.domains.flooring_estimate.export_service import FlooringExportService

    est = new_estimate(service)
    service.calculate(est["id"])
    estimate = service.get_estimate(est["id"])
    total = f"${float(estimate['total']):,.2f}"

    trades = _pdf_text(FlooringExportService().generate_pdf(estimate, layout="trades"))
    assert "Project Summary" in trades and total in trades
    # Each kind of work once, the rooms within it
    for head in ("Tear out", "Floor", "Trim", "Other work"):
        assert head in trades, head
    assert "Floor Plan" in trades

    proposal = _pdf_text(FlooringExportService().generate_pdf(estimate, layout="proposal"))
    assert "FLOORING PROPOSAL" in proposal and "Scope of Work" in proposal
    assert "Living Room" in proposal and total in proposal
    # The quantities at the back, after the plan
    assert "Itemized Quantities" in proposal
    assert proposal.index("Floor Plan") < proposal.index("Itemized Quantities")

    # An unknown layout falls back to room cards
    cards = _pdf_text(FlooringExportService().generate_pdf(estimate, layout="xactimate"))
    assert "Doorways:" in cards


def test_a_room_drawing_is_cropped_to_the_room_and_labelled(service):
    from app.domains.flooring_estimate.floorplan_drawing import room_thumbnail

    level = house()["levels"][0]
    kitchen = next(r for r in level["rooms"] if r["id"] == "kitchen")
    drawing = room_thumbnail(level, kitchen, 148, 124, "lvp")
    assert (drawing.width, drawing.height) == (148, 124)

    texts = []

    def walk(node):
        for child in getattr(node, "contents", []):
            if hasattr(child, "text"):
                texts.append(child.text)
            walk(child)

    walk(drawing)
    assert "Kitchen" in texts
    # Every wall of the L, the short ones too
    for length in ("14' 0\"", "8' 0\"", "4' 0\"", "3' 6\"", "10' 0\"", "11' 6\""):
        assert length in texts, length


def test_the_plan_draws_open_walls_registers_and_sinks():
    from app.domains.flooring_estimate.floorplan_drawing import level_plan, room_thumbnail

    level = house()["levels"][0]
    level["openings"][0] = {"id": "o1", "kind": "open_wall", "rooms": ["living", "kitchen"],
                            "a": {"x": 15, "y": 0}, "b": {"x": 15, "y": 11.5}}
    level["walls"] = [{"id": "w1", "room_id": "living", "a": {"x": 6, "y": 14.1667}, "b": {"x": 6, "y": 10.1667}}]
    level["fixtures"] += [
        {"id": "r1", "type": "floor_register", "x": 3, "y": 13, "w": 1, "h": 0.45, "rotation": 90},
        {"id": "s1", "type": "pedestal_sink", "x": 21, "y": 25.3, "w": 1.75, "h": 1.5},
        {"id": "s2", "type": "utility_sink", "x": 17.5, "y": 22, "w": 2, "h": 2},
    ]
    ids = [r["id"] for r in level["rooms"]]
    plan = level_plan(level, 500, 400, {i: "lvp" for i in ids}, ids)
    thumb = room_thumbnail(level, level["rooms"][0], 148, 124, "lvp")

    def dashed(node, found):
        for child in getattr(node, "contents", []):
            if getattr(child, "strokeDashArray", None) == [2, 1.5]:
                found.append(child)
            dashed(child, found)
        return found

    # A dashed line where the open wall would stand, drawn from each room's side
    assert len(dashed(plan, [])) == 2
    assert len(dashed(thumb, [])) == 1

    def wall_polygons(node, found):
        for child in getattr(node, "contents", []):
            if type(child).__name__ == "Polygon" and len(child.points) == 8:
                found.append(child.points)
            wall_polygons(child, found)
        return found

    # The built-out wall: 4' by 4.5" at the plan's scale
    sizes = []
    for pts in wall_polygons(thumb, []):
        xs, ys = pts[0::2], pts[1::2]
        sizes.append((round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)))
    scale = min((148 - 30) / (15 + 0.75), (124 - 30) / (14.1667 + 0.75), 12.0)
    assert (round(0.375 * scale, 1), round(4 * scale, 1)) in sizes


def test_every_fixture_kind_says_how_it_meets_the_new_floor_and_the_frontend_agrees():
    import re
    from app.domains.flooring_estimate.geometry import FIXTURE_KINDS, FIXTURE_TYPES, FLOOR_FITS

    assert set(FIXTURE_KINDS) == FIXTURE_TYPES
    assert all(kind.floor_fit in FLOOR_FITS for kind in FIXTURE_KINDS.values())
    ops = Path(__file__).resolve().parents[2] / "frontend/src/components/flooring-estimate/sketch/utils/sketchOps.ts"
    if not ops.exists():
        pytest.skip("no frontend next to the backend")
    table = re.search(r"FIXTURE_FLOOR_FIT: Record<FixtureType, FloorFit> = \{(.*?)\n\};",
                      ops.read_text(encoding="utf-8"), re.S).group(1)
    frontend = dict(re.findall(r"^\s*(\w+): '(\w+)',", table, re.M))
    assert frontend == {key: kind.floor_fit for key, kind in FIXTURE_KINDS.items()}


def test_a_fixture_goes_on_top_of_the_new_floor_or_the_floor_is_cut_to_fit_it():
    from app.domains.flooring_estimate.geometry import floor_fit_of

    # A hole in the floor for its flange or duct
    assert floor_fit_of({"type": "toilet"}) == "cut_to_fit"
    assert floor_fit_of({"type": "floor_register"}) == "cut_to_fit"
    # Set on top; a dishwasher goes with the cabinets
    assert floor_fit_of({"type": "refrigerator"}) == "on_top"
    assert floor_fit_of({"type": "dishwasher"}) == "on_top"
    # A fixture's own say over its kind's
    assert floor_fit_of({"type": "dishwasher", "floor_fit": "cut_to_fit"}) == "cut_to_fit"
    assert floor_fit_of({"type": "vanity", "floor_fit": "cut_to_fit"}) == "cut_to_fit"
    assert floor_fit_of({"type": "vanity", "floor_fit": None}) == "on_top"
    # An island detached and reset goes on top; left in place the floor stops at it
    assert floor_fit_of({"type": "island", "floor_under": True}) == "on_top"
    assert floor_fit_of({"type": "island", "floor_fit": "on_top"}) is None
    with pytest.raises(ValidationError):
        FlooringSketch.model_validate(house(fixtures=[
            {"id": "f1", "type": "toilet", "x": 17, "y": 28, "floor_fit": "floating"},
        ]))


def test_a_tile_or_wood_floor_cut_to_fit_fixtures_carries_that_labor_in_its_own_line():
    sketch = house()
    sketch["levels"][0]["fixtures"] += [
        {"id": "f4", "type": "dishwasher", "x": 18, "y": 1, "w": 2, "h": 2},
        {"id": "f5", "type": "island", "x": 20, "y": 5, "w": 6, "h": 3},
        {"id": "f6", "type": "floor_register", "x": 20, "y": 26, "w": 1, "h": 0.45},
    ]
    rooms = measured(sketch)
    assert rooms["bath"].cut_to_fit == ["toilet", "floor_register"]
    assert rooms["kitchen"].cut_to_fit == []

    def bath_install(floor, **choice):
        return row(estimate(sketch, scopes(bath={"included": True, "new_material": floor, **choice})), "bath", "install")

    wood = bath_install("engineered_hardwood")
    per_sf = pricing.FLOORING_MATERIAL["engineered_hardwood"] + pricing.FLOORING_INSTALL_LABOR["engineered_hardwood"]
    assert pricing.CUT_TO_FIT_RATES["wood_per_fixture"] == pytest.approx(39.18)
    assert wood.qty * wood.unit_price == pytest.approx(wood.qty * per_sf + 2 * 39.18)
    assert "cut to fit toilet, floor register" in wood.notes

    tile = bath_install("porcelain_tile")
    assert pricing.CUT_TO_FIT_RATES["tile_per_fixture"] == pytest.approx(70.74)
    assert tile.qty * (tile.unit_price - pricing.FLOORING_MATERIAL["porcelain_tile"]
                       - pricing.FLOORING_INSTALL_LABOR["porcelain_tile"]) == pytest.approx(2 * 70.74)

    # Not a line of its own
    t = build_takeoff(estimate(sketch, scopes(bath={"included": True, "new_material": "porcelain_tile"})))
    assert not [r for r in t.rows["bath"] if "cut_to_fit" in r.key or "cut to fit" in r.label.lower()]

    # LVP, or a price typed in: nothing added
    lvp = bath_install("lvp")
    assert lvp.unit_price == pytest.approx(pricing.FLOORING_MATERIAL["lvp"] + pricing.FLOORING_INSTALL_LABOR["lvp"])
    assert "cut to fit" not in (lvp.notes or "")
    assert bath_install("porcelain_tile", items={"install": {"unit_price": 20}}).unit_price == 20


def test_the_pdf_notes_which_fixtures_go_on_top_of_a_new_tile_or_wood_floor_and_which_it_is_cut_to_fit(service):
    from app.domains.flooring_estimate.export_service import FlooringExportService, fixture_floor_notes

    sketch = house()
    sketch["levels"][0]["fixtures"] += [
        {"id": "f4", "type": "dishwasher", "x": 18, "y": 1, "w": 2, "h": 2},
        # Left in place: the floor stops at it, in neither list
        {"id": "f5", "type": "island", "x": 20, "y": 5, "w": 6, "h": 3},
        {"id": "f6", "type": "floor_register", "x": 20, "y": 26, "w": 1, "h": 0.45},
        {"id": "f7", "type": "floor_register", "x": 22, "y": 26, "w": 1, "h": 0.45},
        {"id": "f8", "type": "vanity", "x": 21, "y": 28.5, "w": 2.5, "h": 1.75, "floor_fit": "cut_to_fit"},
        # In the living room, getting LVP: not in the note
        {"id": "f9", "type": "washer", "x": 5, "y": 5, "w": 2.25, "h": 2.25},
    ]
    est = service.create_estimate(FlooringEstimateCreate(
        property_address="123 Example St", city="Anytown", state="VA", zip_code="22030", sketch_data=sketch,
        room_scopes=scopes(kitchen={"new_material": "engineered_hardwood"},
                           bath={"included": True, "new_material": "porcelain_tile"}),
    ))
    service.calculate(est["id"])
    calculated = service.get_estimate(est["id"])
    assert fixture_floor_notes(calculated) == [
        "<b>Fixtures on the new tile and wood floors</b>",
        "• Set back on top of the new floor: Kitchen — refrigerator, range, dishwasher.",
        "• The new floor is cut to fit these (a hole for the flange or duct), which takes more labor; it is "
        "included in each room's new floor line: Bathroom — toilet, 2 floor registers, vanity.",
    ]
    text = _pdf_text(FlooringExportService().generate_pdf(calculated))
    assert "Fixtures on the new tile and wood floors" in text
    assert "Set back on top of the new floor" in text
    assert "cut to fit these" in text

    # No tile or wood going in: nothing to note
    plain = new_estimate(service)
    service.calculate(plain["id"])
    assert fixture_floor_notes(service.get_estimate(plain["id"])) == []


# ── Sanding a hardwood floor in place of a new one ──

def _on(rows):
    return {key: r for key, r in rows.items() if r.billed}


def test_a_sanded_hardwood_room_has_no_tear_out_or_new_floor_but_its_sanding_and_trim():
    t = build_takeoff(estimate(room_scopes=scopes(living={"work": "refinish", "existing_material": "solid_hardwood"})))
    rows = {r.key: r for r in t.rows["living"]}
    on = _on(rows)
    assert "removal" not in rows and "install" not in rows
    sand = rows["refinish"]
    assert sand.label == "Sand & finish wood floor (natural finish)"
    assert (sand.qty, sand.unit) == (pytest.approx(212.5, abs=0.01), "SF")
    assert sand.unit_price == pytest.approx(4.60)  # FCW FIN 4.18 + 10%
    assert "2 coats of finish" in sand.notes
    # Quarter round replaced, the baseboard painted and masked along it
    living = measured()["living"]
    for key in ("quarter_round", "shoe_molding_remove", "baseboard_paint", "refinish_mask"):
        assert key in on, key
    assert on["quarter_round"].qty == pytest.approx(living.shoe_lf)
    assert on["refinish_mask"].qty == pytest.approx(living.shoe_lf)
    assert on["refinish_mask"].unit_price == pytest.approx(0.69)  # FCW MASKLF
    for key in ("shoe_molding", "baseboard_remove", "baseboard_install", "underlayment", "door_undercut"):
        assert key not in on, key
    # The extras start off, ready to switch on
    for key in ("refinish_pre_stain", "refinish_extra_coat", "refinish_dustless", "refinish_board_replace",
                "refinish_lace_in", "refinish_minimum", "stairs_refinish"):
        assert key in rows and key not in on, key


def test_a_sanded_kitchen_leaves_the_dishwasher_and_island_and_covers_the_cabinets():
    sketch = house()
    sketch["levels"][0]["fixtures"] += [
        {"id": "f4", "type": "dishwasher", "x": 18, "y": 1, "w": 2, "h": 2},
        {"id": "f5", "type": "island", "x": 20, "y": 5, "w": 6, "h": 3, "floor_under": True},
    ]
    sanded = scopes(kitchen={"work": "refinish", "finish": "stain", "existing_material": "engineered_hardwood"})
    rows = {r.key: r for r in build_takeoff(estimate(sketch, sanded)).rows["kitchen"]}
    on = _on(rows)
    assert rows["refinish"].label == "Sand, stain, and finish wood floor"
    assert rows["refinish"].unit_price == pytest.approx(5.53)  # FCW FIN+ 5.03 + 10%
    assert "refrigerator_detach_reset" in on and "range_detach_reset" in on
    assert "dishwasher_detach_reset" not in on and "island_detach_reset" not in on
    # The cabinet fronts and the island all round, cabinet high
    kitchen = measured(sketch)["kitchen"]
    assert on["refinish_cover"].qty == pytest.approx(kitchen.toe_kick_lf * 2.875)
    # Replaced instead, the dishwasher and the island come out as before
    replaced = {r.key: r for r in build_takeoff(estimate(sketch)).rows["kitchen"] if r.billed}
    assert "dishwasher_detach_reset" in replaced and "island_detach_reset" in replaced


def test_every_room_can_be_sanded_from_the_job_and_a_room_can_say_otherwise():
    job = {"defaults": {"work": "refinish", "finish": "water_natural", "existing_material": "solid_hardwood"}}
    t = build_takeoff(estimate(room_scopes=scopes(hall={"work": "replace"}), job_scope=job))
    living = {r.key: r for r in t.rows["living"]}
    hall = {r.key: r for r in t.rows["hall"]}
    assert living["refinish"].unit_price == pytest.approx(4.85)  # FCW FINW 4.41 + 10%
    assert "refinish" not in hall and "install" in hall
    # A sanded floor counts toward the floors cleaned at the end
    clean = next(r for r in t.general if r.key == "final_clean")
    assert clean.qty > measured()["hall"].floor_sf


def test_new_quarter_round_or_shoe_always_brings_the_baseboard_paint_unless_the_baseboard_is_new():
    # Carpet: no shoe or paint, until quarter round goes on by hand
    carpet = {r.key: r for r in build_takeoff(estimate(room_scopes=scopes(
        bed1={"items": {"quarter_round": {"on": True}}}))).rows["bed1"]}
    assert carpet["quarter_round"].billed and carpet["baseboard_paint"].billed
    # A new baseboard is painted already
    wood = {r.key: r for r in build_takeoff(estimate(room_scopes=scopes(
        bed1={"new_material": "solid_hardwood", "items": {"quarter_round": {"on": True}}}))).rows["bed1"]}
    assert wood["baseboard_install"].billed and not wood["baseboard_paint"].billed
    # Switched off by hand: kept off, and the estimate says so
    t = build_takeoff(estimate(room_scopes=scopes(
        living={"work": "refinish", "items": {"baseboard_paint": {"on": False}}})))
    assert not next(r for r in t.rows["living"] if r.key == "baseboard_paint").billed
    assert any("Living Room: quarter round is replaced but the baseboard isn't painted" in w for w in t.warnings)


def test_sanding_warns_on_a_floor_that_isnt_hardwood_and_the_finish_is_checked():
    t = build_takeoff(estimate(room_scopes=scopes(living={"work": "refinish", "existing_material": "ceramic_tile"})))
    assert any("Living Room: only a hardwood floor is sanded" in w for w in t.warnings)
    with pytest.raises(ValidationError):
        RoomScope.model_validate({"work": "refinish", "finish": "lacquer"})
    with pytest.raises(ValidationError):
        RoomScope.model_validate({"work": "sand"})
    assert JobScope.model_validate({"defaults": {"work": "refinish", "finish": "seal"}}).defaults.finish == "seal"


def test_the_pdf_shows_a_sanded_room_as_refinished(service):
    from app.domains.flooring_estimate.export_service import FlooringExportService

    est = service.create_estimate(FlooringEstimateCreate(
        property_address="123 Example St", city="Anytown", state="VA", zip_code="22030", sketch_data=house(),
        room_scopes=scopes(living={"work": "refinish", "existing_material": "solid_hardwood"}),
    ))
    service.calculate(est["id"])
    calculated = service.get_estimate(est["id"])
    living = next(r for r in calculated["calculated_rooms"] if r["room_id"] == "living")
    assert (living["work"], living["finish"]) == ("refinish", "natural")
    lines = {li["item_key"] for li in calculated["line_items"] if li["room_id"] == "living"}
    assert {"refinish", "quarter_round", "baseboard_paint", "refinish_mask"} <= lines
    assert not {"removal", "install"} & lines
    text = _pdf_text(FlooringExportService().generate_pdf(calculated))
    assert "Sand & finish wood floor (natural finish)" in text
    assert "Hardwood · sand & finish wood floor (natural finish)" in text
    assert "Floor sanded: Solid hardwood" in text and "Refinish" in text
    assert "Hardwood - sand & refinish" in text


def test_the_pdf_waits_for_a_calculation(session):
    from fastapi.testclient import TestClient

    def use_db():
        yield session

    app.main.app.dependency_overrides[get_db_session] = use_db
    app.main.app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(
        id=str(uuid.uuid4()), role=StaffRole.admin,
    )
    try:
        client = TestClient(app.main.app)
        estimate_id = client.post("/api/flooring-estimates", json={
            "property_address": "123 Example St", "sketch_data": house(), "room_scopes": scopes(),
        }).json()["id"]
        early = client.get(f"/api/flooring-estimates/{estimate_id}/export/pdf")
        assert early.status_code == 400
        client.post(f"/api/flooring-estimates/{estimate_id}/calculate")
        pdf = client.get(f"/api/flooring-estimates/{estimate_id}/export/pdf")
        assert pdf.status_code == 200
        assert pdf.headers["content-type"] == "application/pdf"
        assert 'filename="flooring_estimate_123_Example_St.pdf"' in pdf.headers["content-disposition"]
        assert pdf.content.startswith(b"%PDF")
        proposal = client.get(f"/api/flooring-estimates/{estimate_id}/export/pdf", params={"layout": "proposal"})
        assert proposal.status_code == 200 and proposal.content.startswith(b"%PDF")
        assert client.get(f"/api/flooring-estimates/{estimate_id}/export/pdf",
                          params={"layout": "xactimate"}).status_code == 422
    finally:
        app.main.app.dependency_overrides.pop(get_db_session, None)
        app.main.app.dependency_overrides.pop(get_current_staff, None)


# ── The migration ──

def test_the_migration_makes_the_tables_the_models_describe(tmp_path):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    from app.domains.staff.models import Staff

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "flr20261112tb01_add_flooring_estimate_tables.py"
    spec = importlib.util.spec_from_file_location("flooring_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'migrate.db'}")
    for model in (PriceBook, Company, Client, Claim, Staff):
        model.__table__.create(engine)
    with engine.begin() as conn:
        migration.op = Operations(MigrationContext.configure(conn))
        migration.upgrade()
        migration.upgrade()  # again: tables the app already made are left alone
        inspector = sa.inspect(conn)
        for model in (FlooringEstimate, FlooringEstimateLineItem, FlooringEstimateHistory):
            made = {c["name"] for c in inspector.get_columns(model.__tablename__)}
            assert made == {c.name for c in model.__table__.columns}, model.__tablename__


def test_people_who_build_bathroom_estimates_can_open_flooring_ones(tmp_path):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    from app.domains.staff.models import RoleScreenAccess

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "flr20261112sc02_flooring_estimates_screen.py"
    spec = importlib.util.spec_from_file_location("flooring_screen_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'screens.db'}")
    RoleScreenAccess.__table__.create(engine)
    # Only what the migration reads of a staff member
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE staff (id VARCHAR(36) PRIMARY KEY, screen_access JSON)")
    roles = sa.table("role_screen_access", sa.column("role"), sa.column("screens", sa.JSON))
    staff = sa.table("staff", sa.column("id"), sa.column("screen_access", sa.JSON))
    with engine.begin() as conn:
        conn.execute(roles.insert(), [
            {"role": "manager", "screens": ["clients", "bathroom_estimates"]},
            {"role": "staff", "screens": ["clients"]},
        ])
        conn.execute(staff.insert(), [{"id": str(uuid.uuid4()), "screen_access": ["bathroom_estimates"]}])
        migration.op = Operations(MigrationContext.configure(conn))
        migration.upgrade()
        migration.upgrade()  # once only
        saved = dict(conn.execute(sa.select(roles.c.role, roles.c.screens)).all())
        assert saved["manager"] == ["clients", "bathroom_estimates", "flooring_estimates"]
        assert saved["staff"] == ["clients"]
        assert conn.execute(sa.select(staff.c.screen_access)).scalar() == ["bathroom_estimates", "flooring_estimates"]
        migration.downgrade()
        assert dict(conn.execute(sa.select(roles.c.role, roles.c.screens)).all())["manager"] == ["clients", "bathroom_estimates"]
