"""Rough scope of work from a parsed carrier estimate (rebuild/scope_summary.py)"""

from app.domains.rebuild.scope_summary import split_action, summarize_estimate, trade_of


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
    assert kitchen["Drywall"] == ['Replace 1/2" drywall', "Texture drywall"]
    assert kitchen["Paint"] == ["walls", "ceiling", "baseboard"]
    assert kitchen["Trim"] == ["Replace baseboard"]
    assert kitchen["Flooring"] == ["Replace vinyl floor covering"]
    assert kitchen["Appliances"] == ["Detach & reset range"]
    assert list(kitchen)[0] == "Protection"

    family = {t["trade"]: t["items"] for t in result["areas"][1]["trades"]}
    assert family == {"Flooring": ["Replace carpet", "Replace carpet pad"]}

    assert [a["name"] for a in result["areas"]] == ["Kitchen", "Family Room", "Debris Removal"]
    # 2 drying lines, the wet tear-out and the labor minimum
    assert result["skipped_count"] == 4
    assert result["line_count"] == 19
    assert result["text"].startswith("[Main Level]\nKitchen\n- Protection:")
    assert "[Basement]\nFamily Room\n- Flooring: Replace carpet, Replace carpet pad" in result["text"]


def test_single_level_has_no_level_heading():
    parsed = {"levels": [{"name": "Main Level", "rooms": [
        {"name": "Bathroom", "line_items": _items("Detach & Reset Toilet")},
    ]}]}
    assert summarize_estimate(parsed)["text"] == "Bathroom\n- Plumbing: Detach & reset toilet"
