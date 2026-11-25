"""Rough scope of work from a parsed carrier estimate (rebuild/scope_summary.py)"""

from app.domains.rebuild.scope_summary import split_action, summarize_estimate, trade_of  # noqa: F401


def _items(*descs):
    return [{"description": d} for d in descs]


def test_split_action():
    assert split_action('R&R Baseboard - 3 1/4"') == ("replace", "Baseboard")
    assert split_action("Detach & Reset - Mirror") == ("detach", "Mirror")
    assert split_action("Light fixture - Detach & reset") == ("detach", "Light fixture")
    assert split_action("Remove Vinyl floor covering (sheet goods)") == ("remove", "Vinyl floor covering")
    assert split_action("Carpet pad") == ("install", "Carpet pad")


def test_trades():
    assert trade_of('R&R 1/2" drywall - hung, taped, floated, ready for paint') == "Drywall"
    assert trade_of("Seal/prime then paint the walls twice (3 coats)") == "Paint"
    assert trade_of("Paint baseboard - two coats") == "Paint"
    assert trade_of("Floor protection - plastic and tape - 10 mil") == "Protection"
    assert trade_of("Final cleaning - construction - Residential") == "Cleaning"
    assert trade_of("Detach & Reset Toilet") == "Plumbing"
    assert trade_of("Taxes, insurance, permits & fees (Bid Item)") == "General"


def test_summarize_estimate():
    parsed = {
        "standalone_sections": [],
        "levels": [
            {"name": "Main Level", "rooms": [
                {"name": "Kitchen", "line_items": _items(
                    'R&R 1/2" drywall - hung, taped, floated, ready for paint',
                    "Texture drywall - light hand texture",
                    "Seal/prime then paint the walls twice (3 coats)",
                    "Paint the ceiling - two coats",
                    'R&R Baseboard - 3 1/4"',
                    "Paint baseboard - two coats",
                    "Remove Vinyl floor covering (sheet goods)",
                    "Vinyl floor covering (sheet goods)",
                    "Floor protection - plastic and tape - 10 mil",
                    "Dehumidifier (per 24 hour period) - XLarge",
                    "Air mover (per 24 hour period)",
                    "Detach & Reset Range - electric",
                )},
            ]},
            {"name": "Basement", "rooms": [
                {"name": "Family Room", "line_items": _items(
                    "Carpet", "Carpet pad", "Remove Carpet", "Remove Carpet pad",
                    "Tear out wet drywall, cleanup, bag, per LF - up to 2' tall",
                )},
            ]},
        ],
        "appendix_sections": [
            {"name": "Debris Removal", "line_items": _items("Haul debris - per pickup truck load")},
            {"name": "Labor Minimums Applied", "line_items": _items("Drywall labor minimum")},
        ],
    }
    result = summarize_estimate(parsed)
    kitchen = {t["trade"]: t["items"] for t in result["areas"][0]["trades"]}
    # The board once, whatever its thickness, with its finish
    assert kitchen["Drywall"] == ["Replace drywall"]
    assert kitchen["Paint"] == ["walls", "ceiling", "baseboard"]
    # The baseboard is painted: Paint lists it, Trim doesn't again
    assert "Trim" not in kitchen
    assert kitchen["Flooring"] == ["Replace vinyl flooring"]
    assert kitchen["Appliances"] == ["D&R range"]
    # Floor protection: every rebuild has it
    assert "Protection" not in kitchen
    assert list(kitchen)[0] == "Drywall"

    family = {t["trade"]: t["items"] for t in result["areas"][1]["trades"]}
    assert family == {"Flooring": ["Replace carpet"]}

    # Debris Removal: hauling is what every job has, so the area has nothing to list
    assert [a["name"] for a in result["areas"]] == ["Kitchen", "Family Room"]
    # 2 drying lines, the wet tear-out, the labor minimum, the floor protection
    # and the haul
    assert result["skipped_count"] == 6
    assert result["line_count"] == 19
    assert result["text"].startswith("[Main Level]\nKitchen\nReplace drywall, Paint walls & ceiling")
    assert "[Basement]\nFamily Room\nReplace carpet" in result["text"]


def test_single_level_has_no_level_heading():
    parsed = {"levels": [{"name": "Main Level", "rooms": [
        {"name": "Bathroom", "line_items": _items("Detach & Reset Toilet")},
    ]}]}
    assert summarize_estimate(parsed)["text"] == "Bathroom\nD&R toilet"


def _room(*descs):
    from app.domains.rebuild.scope_summary import summarize_room
    return {t["trade"]: t["items"] for t in summarize_room(descs)}


def test_what_goes_in_with_a_new_floor_reads_on_its_flooring_line():
    room = _room(
        "R&R Vapor barrier - 6 mil poly",
        "Paint baseboard - two coats",
        "R&R Pre-finished solid wood flooring",
        'R&R Quarter round - 3/4" - hardwood',
    )
    assert room == {
        "Flooring": ["Replace solid wood flooring"],
    }


def test_wall_paint_stays_a_line_of_its_own():
    room = _room(
        "Remove Carpet", "Carpet", "Remove Carpet pad", "Carpet pad", "Transition strip",
        "Seal/prime then paint the walls (2 coats)", "Paint baseboard - two coats",
        'R&R Baseboard - 3 1/4"',
    )
    assert room["Flooring"] == ["Replace carpet"]
    assert room["Paint"] == ["walls", "baseboard"]
    assert "Trim" not in room  # painted, so the Paint line says it


def test_without_a_new_floor_nothing_is_folded():
    room = _room('R&R Quarter round - 3/4"', "Paint quarter round", "R&R Vapor barrier - 6 mil poly")
    assert room == {"Insulation": ["Replace vapor barrier"], "Paint": ["trim"]}


def test_paint_reads_as_its_surfaces_and_painted_baseboard_is_not_listed_again():
    room = _room(
        "Seal/prime (1 coat) then paint (1 coat) the surface area",
        "Paint part of the ceiling - two coats",
        "Paint part of the walls - two coats",
        "Seal & paint baseboard - two coats",
        "Paint baseboard - two coats",
        'R&R Baseboard - 3 1/4"',
    )
    assert room == {"Paint": ["walls", "ceiling", "baseboard"]}


def test_appliances_detached_and_reset_read_as_one():
    room = _room(
        "Detach & Reset Microwave oven - over range",
        "Refrigerator - Remove & reset",
        "Detach & Reset Range - electric",
        "Detach & Reset Dishwasher",
    )
    assert room == {"Appliances": ["D&R appliances"]}


def test_plumbing_reads_as_one_line():
    room = _room(
        "Sink - double basin",
        "Detach & Reset Sink faucet - Kitchen",
        "Detach & Reset Garbage disposal / disposer",
        "Detach & Reset P-trap assembly - ABS (plastic)",
        "R&R Angle stop valve",
    )
    assert room == {"Plumbing": ["Replace sink & angle stop valve", "D&R plumbing fixtures"]}


def test_a_single_fixture_keeps_its_name():
    assert _room("Detach & Reset Toilet") == {"Plumbing": ["D&R toilet"]}


def test_electrical_reads_as_one_line():
    room = _room(
        "Detach & Reset Outlet or switch cover",
        "Detach & Reset Light fixture",
        "Detach & Reset Ceiling fan & light",
        "R&R Outlet",
        "R&R Smoke detector",
    )
    assert room == {"Electrical": ["Replace outlet & smoke detector", "D&R electrical fixtures"]}


def test_cabinet_parts_read_as_cabinets_and_the_countertop_once():
    room = _room(
        "R&R Cabinetry - lower (base) units",
        "R&R Cabinet panels - side, end, or back",
        "Cabinet knob or pull",
        "Detach & Reset Countertop - flat laid plastic laminate",
        "Countertop - flat laid plastic laminate - end cap",
    )
    assert room == {"Cabinets & countertops": ["Replace cabinets", "D&R countertop"]}


def test_a_vanity_and_its_top_read_as_two():
    room = _room("R&R Vanity", "R&R Vanity top - one sink - cultured marble")
    assert room == {"Cabinets & countertops": ["Replace vanity", "Replace countertop"]}


def test_contents_moved_out_and_back_are_not_listed():
    room = _room(
        "Contents - move out then reset - Large room",
        "Content Manipulation charge - per hour",
        "Paint the walls - two coats",
    )
    assert room == {"Paint": ["walls"]}
    assert _room("Contents - move out then reset") == {}


def test_protection_is_not_listed():
    room = _room(
        "Floor protection - plastic and tape - 10 mil",
        "Mask and prep for paint - plastic, paper, tape (per LF)",
        "Paint the walls - two coats",
    )
    assert room == {"Paint": ["walls"]}


def test_cleaning_is_not_listed():
    room = _room(
        "Final cleaning - construction - Residential",
        "Clean floor",
        "Paint the walls - two coats",
    )
    assert room == {"Paint": ["walls"]}


def test_what_every_job_has_is_not_listed():
    room = _room(
        "Haul debris - per pickup truck load - including dump fees",
        "Dumpster load - Approx. 20 yards, 4 tons of debris",
        "General Demolition - per hour",
        "Tear out baseboard and bag for disposal",
        "Residential Supervision / Project Management - per hour",
        "Taxes, insurance, permits & fees (Bid Item)",
        "Temporary toilet (per month)",
        "Storage container - 20' long (per month)",
        "Paint the walls - two coats",
    )
    assert room == {"Paint": ["walls"]}


def test_ordinary_work_is_still_listed():
    room = _room(
        'R&R 1/2" drywall - hung, taped, floated, ready for paint',
        "R&R Interior door unit",
        "R&R Light fixture",
        "R&R Toilet",
        "R&R Overhead door - 16' x 7'",
    )
    assert set(room) == {"Drywall", "Doors", "Electrical", "Plumbing"}
    assert room["Doors"] == ["Replace interior door unit & overhead door"]


def test_trim_reads_as_one_line():
    room = _room(
        'R&R Casing - 2 1/4"',
        'R&R Crown molding - 3 1/4"',
        "Chair rail - 2 1/2\"",
        "Detach & Reset Shoe molding",
        "Detach & Reset Window stool & apron",
        "Detach & Reset Baseboard - 3 1/4\"",
    )
    assert room == {"Trim": ["Replace casing, crown molding & chair rail", "D&R trim"]}


def test_doors_read_as_one_line():
    room = _room(
        "R&R Interior door unit",
        "R&R Door lockset - interior",
        "Detach & Reset Bifold door set - Double",
        "Detach & Reset Door stop - wall or floor mounted",
    )
    assert room == {"Doors": ["Replace interior door unit & door lockset", "D&R doors"]}


def test_windows_read_as_one_line():
    room = _room(
        "R&R Vinyl window - double hung, 9-12 sf",
        "R&R Window screen, 1 - 9 SF",
        "Detach & Reset Window blind - horizontal or vertical",
        "Detach & Reset Curtain rod",
        "Detach & Reset Window drapery - hardware",
    )
    assert room == {"Windows & coverings": ["Replace vinyl window & window screen", "D&R window coverings"]}


def test_tile_reads_as_one_line():
    room = _room(
        "R&R Ceramic tile - wall",
        "R&R Cement board - 1/2\"",
        "Tile edge trim - bullnose",
        "Regrout tile - wall",
        "Detach & Reset Tile soap dish",
        "Detach & Reset Tile towel bar",
    )
    assert room == {"Tile": [
        "Replace ceramic tile, cement board & tile edge trim",
        "Regrout tile",
        "D&R tile",
    ]}


FLOOR = (
    "R&R Vapor barrier - 6 mil poly",
    "Paint baseboard - two coats",
    "Pre-finished solid wood flooring",
    'R&R Quarter round - 3/4" - hardwood',
)


def _level(*rooms):
    return {"levels": [{"name": "Main Level", "rooms": [
        {"name": name, "line_items": _items(*descs)} for name, descs in rooms
    ]}]}


def test_rooms_with_the_same_scope_read_once_and_a_subroom_joins_its_room():
    result = summarize_estimate(_level(
        ("Family Room", FLOOR),
        ("Hallway/Living Room", FLOOR),
        ("Subroom: Bay (1)", FLOOR),
        ("Room", FLOOR),
        ("Bathroom", ("Detach & Reset Toilet",)),
    ))
    assert result["text"] == (
        "Family Room, Hallway/Living Room, Room\n"
        "Replace solid wood flooring\n\n"
        "Bathroom\n"
        "D&R toilet"
    )


def test_an_item_put_in_new_reads_as_replaced():
    assert _room("Pre-finished solid wood flooring") == {"Flooring": ["Replace solid wood flooring"]}
    assert _room("Batt insulation - 6 inch - R19 - unfaced batt") == {"Insulation": ["Replace insulation"]}


def test_drywall_reads_once_with_its_finish():
    room = _room(
        'R&R 5/8" drywall - hung, taped, floated, ready for paint',
        "Acoustic ceiling (popcorn) texture",
        'R&R 1/2" drywall - hung, taped, floated, ready for paint',
    )
    assert room == {"Drywall": ["Replace drywall"]}


def test_a_price_added_to_another_item_is_left_out():
    room = _room("R&R Cabinetry - lower (base) units", "Add for lazy susan")
    assert room == {"Cabinets & countertops": ["Replace cabinets"]}


def test_a_room_reads_as_its_name_and_one_line_of_work():
    result = summarize_estimate(_level(("Basement Living Space", (
        "Batt insulation - 6 inch - R19 - unfaced batt",
        'R&R 5/8" drywall - hung, taped, floated, ready for paint',
        "Acoustic ceiling (popcorn) texture",
        'R&R 1/2" drywall - hung, taped, floated, ready for paint',
        "Seal/prime then paint the walls (2 coats)",
        "Paint the ceiling - two coats",
        "Paint baseboard - two coats",
        "Remove Carpet", "Carpet", "Remove Carpet pad", "Carpet pad",
    ))))
    assert result["text"] == (
        "Basement Living Space\n"
        "Replace insulation, Replace drywall, "
        "Paint walls & ceiling, Replace carpet"
    )


def test_paint_reads_as_plain_words():
    from app.domains.rebuild.scope_summary import paint_phrase

    # Baseboard and trim go unsaid when the walls are painted
    assert paint_phrase(["walls", "ceiling", "baseboard"]) == "Paint walls & ceiling"
    assert paint_phrase(["walls", "ceiling", "baseboard", "doors"]) == "Paint walls, ceiling & doors"
    assert paint_phrase(["walls"]) == "Paint walls"
    # Painted alone, they're named
    assert paint_phrase(["baseboard"]) == "Paint baseboard"
    assert paint_phrase(["baseboard", "trim"]) == "Paint baseboard & trim"


def test_electrical_reads_as_its_name_on_the_rooms_line():
    result = summarize_estimate(_level(("Kitchen", (
        "R&R Cabinetry - lower (base) units",
        "Detach & Reset Outlet or switch cover",
        "Detach & Reset Light fixture",
        "R&R Smoke detector",
        "Sink - double basin",
    ))))
    # In the order the work goes: plumbing, then electrical
    assert result["text"] == "Kitchen\nReplace cabinets, Replace sink, Electrical"
