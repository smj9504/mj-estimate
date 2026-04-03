"""
Filter PDF text lines so only plausible insurance estimate rows become line items.

Headers, contact blocks, and numeric junk (PO boxes, zips mistaken for qty) are dropped.
"""

import re
from decimal import Decimal
from typing import List, Optional

# Cover letter, carrier branding, legal boilerplate — not scope line items
_NOISE_LINE = re.compile(
    r"(?i)"
    r"state\s+farm|allstate(\s+insurance)?|farmers(\s+insurance)?|"
    r"travelers(\.com)?|liberty\s+mutual|"
    r"geico|usaa|nationwide|"
    r"p\.?\s*o\.?\s*box|"
    r"@[a-z0-9._-]+\.[a-z]{2,}|"
    r"\bfax\b|\btel\.?\b|\bphone\b|\bcall\b\s+\d|"
    r"https?://|www\.|"
    r"\.com\b|\.org\b|"
    r"cannot\s+authorize|your\s+policy|policyholder|"
    r"customer\s+copy|important\s+information|"
    r"repairs\s+should\s+be|contractor\s+to\s+proceed|"
    r"^\s*\d{3}-\d{3}-\d{4}\s*$|"
    r"^\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\s*$"
)

# Lines that are clearly address / city-state-zip fragments
_ADDRESS_JUNK = re.compile(
    r"(?i)"
    r"^\s*[A-Z][a-z]+(\s+[A-Z][a-z]+)*,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\s*$|"
    r"^\s*Atlanta,?\s*GA\s*$|"
    r"^\s*GA\s+\d{5}\s*$"
)


def line_looks_like_contact_or_header(line: str) -> bool:
    if not line or len(line.strip()) < 2:
        return True
    s = line.strip()
    if _NOISE_LINE.search(s):
        return True
    if _ADDRESS_JUNK.match(s):
        return True
    return False


# Construction / scope verbs — if absent, a line is often room dimensions only (SF/LF sketch rows)
_WORK_VERB = re.compile(
    r"(?i)\b("
    r"paint|primer|remove|replac|install|uninstall|detach|reset|demo|demolit|"
    r"drywall|sheetrock|tape|mud|float|texture|sand|clean|extract|mitigat|"
    r"baseboard|crown|trim|mold|flooring|carpet|vinyl|tile|linoleum|"
    r"cabinet|counter|hvac|insulation|vapor|barrier|caulk|seal|patch|repair|"
    r"scrape|cover|mask|plastic|dumpster|debris|disposal|hung|hang|nail|"
    r"bid\s+item|lump\s+sum|agreed\s+price|content\s+manipulation|manipulation\s+charge"
    r")\b"
)


def line_looks_like_room_measurement_sketch_line(line: str) -> bool:
    """
    Xactimate / carrier PDF room blocks: SF Floor, LF Perimeter, wall openings, page headers.
    These are not billable line items; generic text parsing must not treat them as scope rows.
    """
    s = line.strip()
    if len(s) < 8:
        return False

    if re.search(r"\bHeight:\s*[\d'\"\s]", s):
        return True
    if re.search(r"\bQUANTITY\s+UNIT(?:\s+PRICE)?\b", s) and re.search(
        r"\b(TAX|GCO&P|O&P|RCV|ACV)\b", s, re.I
    ):
        return True
    if re.search(r"\bOpens\s+into\b", s, re.I):
        return True
    if re.search(r"\bMissing\s+Wall\b", s, re.I):
        return True
    if re.search(r"\bFloor\s+Perimeter\b", s, re.I) and not _WORK_VERB.search(s):
        return True
    if re.search(r"\bCeil(?:ing)?\.?\s*Perimeter\b", s, re.I) and not _WORK_VERB.search(s):
        return True
    if re.search(r"\bDate:\s*\d{1,2}/\d{1,2}/\d{4}.+\bPage:\s*\d+", s, re.I):
        return True
    if re.search(r"\bPage:\s*\d+\b.+\bCONTINUED\b", s, re.I):
        return True

    if not _WORK_VERB.search(s):
        if re.search(
            r"(?i)\d[\d,]*\.?\d*\s+SF\s+Floor\b",
            s,
        ):
            return True
        if re.search(
            r"(?i)\d[\d,]*\.?\d*\s+SF\s+Ceil(?:ing)?\b",
            s,
        ):
            return True
        if re.search(r"(?i)\bWalls?\s*&\s*Ceil(?:ing)?\b.+\d[\d,]*\.?\d*\s+LF\b", s):
            return True
        if re.search(r"(?i)\d[\d,]*\.?\d*\s+LF\s+Ceil", s):
            return True

    return False


def line_looks_like_bogus_all_caps_room(line: str) -> bool:
    """ALL CAPS 'room' pattern often matches carrier names / section titles."""
    s = line.strip()
    if not s.isupper() or len(s) < 4:
        return False
    bogus = re.compile(
        r"(?i)STATE\s+FARM|ALLSTATE|FARMERS|CLAIMS|INSURANCE|"
        r"COVERAGE|POLICY|SUMMARY|DWELLING\s+ONLY|PAGE\s+\d|"
        r"CONTENTS|LOSS|ESTIMATE\s+NO"
    )
    return bool(bogus.search(s))


# ALL CAPS "room" lines shorter than this are often OCR fragments (e.g. "ALLS" from "WALLS")
_MIN_ALL_CAPS_ROOM_LEN = 5
_ALLOWED_SHORT_ALL_CAPS_ROOMS = frozenset(
    {"HALL", "BATH", "DEN", "DECK", "PORCH", "ATTIC", "GARAGE", "FOYER", "ENTRY", "LAUNDRY"}
)


def all_caps_room_candidate_is_plausible(candidate: str) -> bool:
    c = candidate.strip()
    if len(c) < 4:
        return False
    if len(c) < _MIN_ALL_CAPS_ROOM_LEN and c not in _ALLOWED_SHORT_ALL_CAPS_ROOMS:
        return False
    if c in {"ALLS", "CEIL", "INGS", "ROOM", "AREA"}:
        return False
    return True


def quantity_unit_price_implausible_duplicate_area(
    quantity: Optional[Decimal], unit_price: Optional[Decimal], unit: Optional[str]
) -> bool:
    """Same value as qty and $/unit for area units is almost always a misparsed dimension row."""
    if quantity is None or unit_price is None or unit is None:
        return False
    u = unit.upper()
    if u not in ("SF", "LF", "SY"):
        return False
    return quantity == unit_price


def quantity_unit_pair_implausible(quantity: Optional[Decimal], unit: Optional[str]) -> bool:
    """
    Drop obvious misparses: PO box / ZIP pulled as SF qty, etc.
    """
    if quantity is None or unit is None:
        return False
    u = unit.upper()
    q = quantity
    if u in ("SF", "LF", "SY", "CF"):
        if q > Decimal("200000"):
            return True
        if q == q.to_integral_value() and q > Decimal("25000"):
            return True
    if u == "EA":
        if q > Decimal("5000"):
            return True
        if q == q.to_integral_value() and q > Decimal("500") and q % 1000 == 0:
            return True
    if u in ("HR", "DAY", "MO"):
        if q > Decimal("10000"):
            return True
    return False


_STATE_FARM_BODY_START = re.compile(
    r"(?i)"
    r"summary\s+for\s+coverage|"
    r"room\s*/\s*location|"
    r"line\s+item\s+description|"
    r"estimate\s+detail|"
    r"repair\s+estimate|"
    r"dwelling\s*[-–]\s*repair|"
    r"construction\s+subtotal"
)


def trim_leading_pages_before_estimate_body(pages: List[str], carrier: Optional[str]) -> List[str]:
    """
    Skip cover letter / TOC pages that precede the tabular estimate.
    Conservative: only applies to known carriers with predictable layout.
    """
    if carrier != "state_farm":
        return pages
    for i, page in enumerate(pages):
        if _STATE_FARM_BODY_START.search(page or ""):
            return pages[i:]
    return pages
