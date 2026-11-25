"""
A rough scope of work from the carrier's estimate, for a rebuild project's
completion paperwork (COC, the completion package for the carrier).

The estimate PDF is read into rooms and their lines
(insurance_extraction/parsers/xactimate_reference_parser.parse_estimate).
Each room's lines are sorted into trades and each line is cut down to what
is done to what ("Replace baseboard", "Paint: walls, ceiling"), so a room
reads in a few lines:

    Main Level
    Kitchen
    - Drywall: Replace 1/2" drywall, Texture drywall
    - Paint: walls, ceiling, baseboard
    - Flooring: Replace vinyl floor covering

It is a draft: the office reads it against the PDF and edits it before it
is saved on the project. Water mitigation lines (drying equipment, wet
tear-out) and labor minimums are left out; they are not rebuild work.
"""

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Trades in the order the work is done; a line goes to the first that
# matches its description
TRADES: List[Tuple[str, re.Pattern]] = [(name, re.compile(rx, re.IGNORECASE)) for name, rx in [
    ("Contents", r"\bcontents?\b|content manipulation|pack[- ]?out|move out"),
    ("Protection", r"\bprotect|\bmask\b|\bmasking\b"),
    ("Demolition & debris", r"\bdebris\b|\bhaul\b|dumpster|\bdemolition\b|\bdemo\b|tear ?out"),
    ("Cleaning", r"\bclean"),
    ("Framing & subfloor", r"\bfram(e|ing)\b|\bstuds?\b|\bjoists?\b|subfloor|sheathing|\bosb\b|plywood|\bheader\b"),
    ("Insulation", r"insulation|\bbatts?\b|vapor barrier"),
    # Before Paint: drywall lines read "... ready for paint"
    ("Drywall", r"drywall|sheetrock|gypsum|\btexture\b|plaster|tape joint|acoustic ceiling|popcorn"),
    ("Paint", r"\bpaint|\bseal\b|\bseal/|\bprime\b|\bprimer\b|\bstain\b"),
    ("Cabinets & countertops", r"cabinet|vanit|countertop|\bcounter\b|backsplash|\bisland\b"),
    # Before Plumbing and Electrical: "Range - electric", "Dishwasher - supply line"
    ("Appliances", r"appliance|refrigerator|dishwasher|\brange\b|microwave|\boven\b|cooktop|washer|dryer|range hood"),
    ("Flooring", r"floor|carpet|\bpad\b|laminate|hardwood|\bvinyl\b|\blvp\b|\blvt\b|\bplank\b|underlayment"
                 r"|transition strip|\bthreshold\b|\bstair tread|\bstair riser"),
    ("Tile", r"\btile\b|\bgrout\b|mortar bed"),
    ("Trim", r"baseboard|\bbase shoe\b|quarter round|\bcasing\b|\bcrown\b|\bmolding\b|\bmoulding\b|\btrim\b|chair rail"),
    ("Doors", r"\bdoors?\b|\bjamb\b|\bbifold\b|\bhinge|\blockset|\bdoor knob"),
    ("Windows & coverings", r"\bwindow|\bblinds?\b|\bshades?\b|\bshutters?\b|curtain|drapery|\bscreen\b"),
    ("Plumbing", r"plumb|toilet|\bsink\b|faucet|\btub\b|bathtub|shower|water heater|supply line|p-trap|\bdrain\b"
                 r"|garbage disposal|angle stop"),
    ("Electrical", r"electric|outlet|receptacle|\bswitch|light fixture|\blight\b|\bfixture\b|smoke detector|ceiling fan"
                   r"|\bgfci\b|\bwiring\b|\bbreaker\b|exhaust fan|bath fan"),
    ("HVAC", r"\bhvac\b|\bduct|\bregister\b|\bvent\b|furnace|air handler|\bheat|\bthermostat|\bgrille\b"),
    ("Mirrors & accessories", r"mirror|towel|toilet paper holder|medicine cabinet|shower rod|\bhook\b|grab bar"),
    ("Roofing & exterior", r"\broof|shingle|gutter|downspout|siding|soffit|fascia|flashing"),
]]
GENERAL = "General"

# How a room reads: the order the work is done in, which is not always the
# order a line is matched in (an appliance line is matched before Electrical)
DISPLAY_ORDER = [
    "Contents", "Protection", "Demolition & debris", "Framing & subfloor", "Insulation",
    "Drywall", "Paint", "Cabinets & countertops", "Flooring", "Tile", "Trim", "Doors",
    "Windows & coverings", "Plumbing", "Electrical", "HVAC", "Appliances",
    "Mirrors & accessories", "Roofing & exterior", GENERAL, "Cleaning",
]

# Not rebuild work: drying equipment, wet tear-out, monitoring
_MITIGATION = re.compile(
    r"dehumidif|air mover|air scrubber|negative air|anti-?microbial|moisture (?:meter|mapping|reading)|"
    r"water extraction|extract water|\bextraction\b|equipment setup|\bmonitoring\b|"
    r"(?:tear ?out|remove|cut)\b.*\bwet\b|\bdrying\b|hepa vacuum|mold remediation",
    re.IGNORECASE,
)
_LABOR_MIN = re.compile(r"labor minimum|minimum charge", re.IGNORECASE)

# Appendix sections that are not rebuild work
_SKIP_SECTIONS = re.compile(r"^(labor minimums applied|water mitigation)$", re.IGNORECASE)

# What is done, at the front ("R&R Baseboard") or the end ("Mirror - Detach & reset")
_ACTIONS = [
    ("replace", r"r\s*&\s*r|remove\s*(?:&|and)\s*replace|replace"),
    ("detach", r"detach\s*(?:&|and)\s*reset"),
    ("remove", r"remove|tear\s*out"),
    ("install", r"install|material only|labor only"),
]
_PREFIX = [(key, re.compile(rf"^(?:{rx})\b[\s\-:]*", re.IGNORECASE)) for key, rx in _ACTIONS]
_SUFFIX = [(key, re.compile(rf"\s*-\s*(?:{rx})\s*$", re.IGNORECASE)) for key, rx in _ACTIONS]
_VERB = {"replace": "Replace", "detach": "Detach & reset", "remove": "Remove", "install": ""}

_PAINT_VERB = re.compile(
    r"^\s*(?:(?:seal|primer|prime|paint|stain|finish|then|and|the)\b|[&/\-])\s*", re.IGNORECASE)
_COATS = re.compile(r"\b(?:once|twice|one coat|two coats|three coats|\d+\s*coats?)\b", re.IGNORECASE)


def _tidy(text: str) -> str:
    text = re.sub(r"\([^)]*\)", " ", text)       # (sheet goods), (per LF)
    text = text.replace("*", " ")
    text = re.sub(r"\s+", " ", text).strip(" -,;:.")
    return text


def _lower_first(text: str) -> str:
    """'Baseboard' -> 'baseboard', but 'LVP' and '1/2" drywall' stay"""
    if len(text) > 1 and text[0].isupper() and text[1].islower():
        return text[0].lower() + text[1:]
    return text


def _cap_first(text: str) -> str:
    return text[:1].upper() + text[1:] if text else text


def split_action(description: str) -> Tuple[str, str]:
    """(action, object) of an estimate line: 'R&R Baseboard - 3 1/4"' ->
    ('replace', 'Baseboard'). action is replace | detach | remove | install,
    install when the line names none (a new item)."""
    desc = re.sub(r"\s+", " ", description or "").strip()
    action = "install"
    for key, rx in _PREFIX:
        m = rx.match(desc)
        if m:
            action, desc = key, desc[m.end():]
            break
    else:
        for key, rx in _SUFFIX:
            m = rx.search(desc)
            if m:
                action, desc = key, desc[:m.start()]
                break
    # The item, without its size and grade: 'Baseboard - 3 1/4"' -> 'Baseboard'
    obj = _tidy(re.split(r"\s+-\s+|\s+–\s+", desc, maxsplit=1)[0])
    return action, obj


def trade_of(description: str) -> str:
    for name, rx in TRADES:
        if rx.search(description or ""):
            return name
    return GENERAL


def is_rebuild_line(description: str) -> bool:
    desc = description or ""
    return bool(desc.strip()) and not _MITIGATION.search(desc) and not _LABOR_MIN.search(desc)


def _paint_surface(description: str) -> str:
    """'Seal/prime then paint the walls twice (3 coats)' -> 'walls'"""
    desc = re.split(r"\s+-\s+", re.sub(r"\s+", " ", description or "").strip(), maxsplit=1)[0]
    obj = desc
    while True:
        m = _PAINT_VERB.match(obj)
        if not m or not m.end():
            break
        obj = obj[m.end():]
    obj = _COATS.sub(" ", obj)
    obj = re.sub(r"\bonly\b", " ", obj, flags=re.IGNORECASE)
    obj = _tidy(obj)
    return _lower_first(obj) if obj else ""


def _trade_phrases(trade: str, descriptions: Iterable[str]) -> List[str]:
    """What is done in a trade, each item once, in the estimate's order.
    An item both removed and put in new reads as replaced."""
    if trade == "Paint":
        out: List[str] = []
        for d in descriptions:
            surface = _paint_surface(d)
            if surface and surface.lower() not in {s.lower() for s in out}:
                out.append(surface)
        return out

    order: List[str] = []
    actions: Dict[str, set] = {}
    names: Dict[str, str] = {}
    for d in descriptions:
        action, obj = split_action(d)
        if not obj:
            continue
        key = obj.lower()
        if key not in actions:
            order.append(key)
            actions[key] = set()
            names[key] = obj
        actions[key].add(action)

    out = []
    for key in order:
        acts = actions[key]
        if "replace" in acts or ("remove" in acts and "install" in acts):
            verbs = ["replace"]
        else:
            verbs = [a for a in ("detach", "remove", "install") if a in acts]
        for verb in verbs:
            word = _VERB[verb]
            obj = names[key]
            out.append(_cap_first(f"{word} {_lower_first(obj)}" if word else obj))
    return out


def summarize_room(descriptions: Iterable[str]) -> List[Dict[str, Any]]:
    """[{trade, items: [phrase]}] for one room's line descriptions, trades in
    the order the work is done"""
    by_trade: Dict[str, List[str]] = {}
    for d in descriptions:
        if is_rebuild_line(d):
            by_trade.setdefault(trade_of(d), []).append(d)
    rank = {name: i for i, name in enumerate(DISPLAY_ORDER)}
    result = []
    for trade in sorted(by_trade, key=lambda t: rank.get(t, len(rank))):
        items = _trade_phrases(trade, by_trade[trade])
        if items:
            result.append({"trade": trade, "items": items})
    return result


def _descriptions(container: Dict[str, Any]) -> List[str]:
    return [(li.get("description") or "").strip() for li in container.get("line_items") or []]


def _count_skipped(descriptions: Iterable[str]) -> int:
    return sum(1 for d in descriptions if d and not is_rebuild_line(d))


def summarize_estimate(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """The rough scope of a parsed estimate (parse_estimate's result).

    Returns {areas: [{level, name, trades: [{trade, items}]}], text,
    line_count, skipped_count}: line_count is how many lines were read,
    skipped_count how many were left out as mitigation or labor minimums."""
    areas: List[Dict[str, Any]] = []
    line_count = 0
    skipped = 0

    def add(level: Optional[str], name: str, descriptions: List[str]) -> None:
        nonlocal line_count, skipped
        line_count += len([d for d in descriptions if d])
        skipped += _count_skipped(descriptions)
        trades = summarize_room(descriptions)
        if trades:
            areas.append({"level": level, "name": name, "trades": trades})

    for sec in parsed.get("standalone_sections") or []:
        if not _SKIP_SECTIONS.match((sec.get("name") or "").strip()):
            add(None, sec.get("name") or GENERAL, _descriptions(sec))
        else:
            skipped += len(_descriptions(sec))
            line_count += len(_descriptions(sec))
    for lv in parsed.get("levels") or []:
        for rm in lv.get("rooms") or []:
            add(lv.get("name"), rm.get("name") or "Room", _descriptions(rm))
    for sec in parsed.get("appendix_sections") or []:
        descs = _descriptions(sec)
        if _SKIP_SECTIONS.match((sec.get("name") or "").strip()):
            skipped += len([d for d in descs if d])
            line_count += len([d for d in descs if d])
        else:
            add(None, sec.get("name") or GENERAL, descs)

    return {
        "areas": areas,
        "text": format_scope(areas),
        "line_count": line_count,
        "skipped_count": skipped,
    }


def format_scope(areas: List[Dict[str, Any]]) -> str:
    """The scope as plain text: a level heading when the estimate has more
    than one level, each area's name, then a line per trade"""
    levels = {a["level"] for a in areas if a.get("level")}
    show_levels = len(levels) > 1
    blocks: List[str] = []
    current_level = None
    for area in areas:
        lines: List[str] = []
        level = area.get("level")
        if show_levels and level and level != current_level:
            lines.append(f"[{level}]")
            current_level = level
        lines.append(area["name"])
        for t in area["trades"]:
            lines.append(f"- {t['trade']}: {', '.join(t['items'])}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)
