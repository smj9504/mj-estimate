"""
Xactimate reference parser — adapted from reference/xactimate_parser/xactimate_parser.py v2.

Hierarchy: standalone_sections + Level > Room(+subrooms merged) > {dimensions, line_items, totals}
Text-based regex parsing (robust) — no coordinate dependence.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from app.domains.insurance_extraction.interfaces import ParsedItemDTO

# ──────────────────────────────────────────────────────────────────────
# Constants / Patterns
# ──────────────────────────────────────────────────────────────────────

LEVEL_MARKERS = re.compile(
    r"^(Main Level|First Floor|1st Floor|Second Floor|2nd Floor|"
    r"Third Floor|3rd Floor|Basement|Lower Level|Upper Level|"
    r"Attic|Garage|Exterior|Level\s*\d+)$",
    re.IGNORECASE,
)

APPENDIX_MARKERS = re.compile(
    r"^(Debris Removal|Miscellaneous|Labor Minimums Applied|General|"
    r"Solar Panels|Water Mitigation)$",
    re.IGNORECASE,
)

ROOM_HEIGHT_RE = re.compile(
    r"^(?:Subroom:\s*)?(.+?)\s+Height:\s*([\d'\"]+)", re.IGNORECASE
)
SUBROOM_RE = re.compile(
    r"^Subroom:\s*(.+?)\s+Height:\s*([\d'\"]+)", re.IGNORECASE
)
CONTINUED_RE = re.compile(r"^CONTINUED\s*[-\u2013]\s*(.+)$", re.IGNORECASE)

# 5-group totals: tax op rcv dep acv
TOTALS_RE = re.compile(
    r"^Totals?:\s*.+?\s+"
    r"([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+"
    r"\(?([\d,]+\.\d+)\)?\s+([\d,]+\.\d+)$"
)
# 3-group totals (5-col PDFs): op rcv acv
TOTALS_3COL_RE = re.compile(
    r"^Totals?:\s*.+?\s+"
    r"([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)$"
)
TOTAL_LEVEL_RE = re.compile(
    r"^Total:\s+.+?\s+"
    r"([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+"
    r"\(?([\d,]+\.\d+)\)?\s+([\d,]+\.\d+)$"
)

LAYOUT_A_INLINE_RE = re.compile(
    r"^(\d+)\.\s+"
    r"(.+?)\s+"
    r"([\d,]+\.?\d*)\s*(EA|SF|LF|HR|SY|SQ|DA|WK|LB|BX|RL|GL|TB|SH)\s+"
    r"([\d,]+\.?\d*)\s+"
    r"([\d,]+\.?\d*)\s+"
    r"([\d,]+\.?\d*)\s+"
    r"([\d,]+\.?\d*)\s+"
    r"\(?([\d,]+\.?\d*)\)?\s+"
    r"([\d,]+\.?\d*)$"
)

# 5-column variant: qty UNIT price op rcv dep acv  (no tax column)
LAYOUT_A_5COL_RE = re.compile(
    r"^(\d+)\.\s+"
    r"(.+?)\s+"
    r"([\d,]+\.?\d*)\s*(EA|SF|LF|HR|SY|SQ|DA|WK|LB|BX|RL|GL|TB|SH)\s+"
    r"([\d,]+\.?\d*)\s+"
    r"([\d,]+\.?\d*)\s+"
    r"([\d,]+\.?\d*)\s+"
    r"\(?([\d,]+\.?\d*)\)?\s+"
    r"([\d,]+\.?\d*)$"
)

AGE_LIFE_RE = re.compile(r"\b\d+/(?:\d+|NA)\s*yrs?\b|\b0/NA\b", re.IGNORECASE)

LAYOUT_B_DATA_START = re.compile(
    r"^([\d,]+\.?\d*)\s*(EA|SF|LF|HR|SY|SQ|DA|WK|LB|BX|RL|GL|TB|SH)"
)
COND_DEP_LINE = re.compile(
    r"^(Avg\.?|Good|Fair|Poor)\s+[\d.]+%?$", re.IGNORECASE
)

HEADER_A = re.compile(r"DESCRIPTION\s+QUANTITY\s+UNIT\s+PRICE", re.IGNORECASE)
HEADER_B = re.compile(
    r"QUANTITY\s+UNIT(?:\s+PRICE)?\s+TAX\s+(?:GC)?O.P\s+RCV\s+AGE",
    re.IGNORECASE,
)
HEADER_B2 = re.compile(r"^CONDITION\s+DEP\s*%", re.IGNORECASE)

DIM_PATTERNS = {
    "sf_walls": re.compile(
        r"([\d,]+\.?\d*)\s+SF\s+Walls?(?!\s*(?:and|&|\s*Ceil))"
    ),
    "sf_ceiling": re.compile(
        r"([\d,]+\.?\d*)\s+SF\s+Ceil(?:ing)?(?!\s*Perim)"
    ),
    "sf_floor": re.compile(
        r"([\d,]+\.?\d*)\s+SF\s+Floor(?!\s*Perim)"
    ),
    "sf_walls_ceiling": re.compile(
        r"([\d,]+\.?\d*)\s+SF\s+Walls?\s+(?:and|&)\s+Ceiling"
    ),
    "lf_floor_perimeter": re.compile(
        r"([\d,]+\.?\d*)\s+LF\s+Floor\s+Peri"
    ),
    "lf_ceil_perimeter": re.compile(
        r"([\d,]+\.?\d*)\s+LF\s+Ceil[.\s]+Peri"
    ),
    "sy_flooring": re.compile(r"([\d,]+\.?\d*)\s+SY\s+Flooring"),
}

UNITS = r"(EA|SF|LF|HR|SY|SQ|DA|WK|LB|BX|RL|GL|TB|SH)"


# ──────────────────────────────────────────────────────────────────────
# Utilities
# ──────────────────────────────────────────────────────────────────────


def parse_num(s: Any) -> float:
    if s is None:
        return 0.0
    s = str(s).strip()
    neg = s.startswith("(") and s.endswith(")")
    s = re.sub(r"[(),$]", "", s).replace(",", "").strip()
    try:
        v = float(s)
        return -v if neg else v
    except Exception:
        return 0.0


def parse_height(s: str) -> Optional[float]:
    m = re.search(r"(\d+)'(?:\s*(\d+)\")?", s)
    if m:
        return round(
            int(m.group(1)) + (int(m.group(2)) if m.group(2) else 0) / 12, 2
        )
    return None


def is_garbled(line: str) -> bool:
    if len(line) < 6:
        return False
    doubled = sum(1 for i in range(0, len(line) - 1, 2) if line[i] == line[i + 1])
    return doubled > len(line) // 3


def is_junk(line: str) -> bool:
    line = line.strip()
    if not line:
        return True
    if re.match(r"^\d+$", line):
        return True
    if is_garbled(line):
        return True
    if re.match(r"^CONDITION\s+DEP\s*%$", line, re.IGNORECASE):
        return True
    if (
        line.isupper()
        and 1 <= len(line.split()) <= 3
        and not any(c.isdigit() for c in line)
        and line not in ("EA", "SF", "LF", "HR", "SY", "SQ", "DA")
    ):
        return True
    if re.match(r"^Avg\.?\s+[\d.]+%?$", line, re.IGNORECASE):
        return True
    junk_pats = [
        r"@",
        r"P\.?O\.?\s+Box",
        r"^\(?\d{3}\)?[\s\-]?\d{3}",
        r"\d{1,2}/\d{1,2}/\d{2,4}\s+.*Page:",
        r"^Date:\s+\d{1,2}/\d{1,2}/\d{2,4}",
        r"Page:\s*\d+\s+of\s+\d+",
        r"^[A-Z][a-z]+,\s+[A-Z]{1,2}[a-z]?\.?\s+\d{5}",  # City, OH 43218 or City, Fl. 34604
        r"^Restoration/Service",
        r"^Dear (Valued|Insured)",
        r"^(Please|Thank|Any person)",
        r"^(Date Contacted|Date of Loss|Date Inspected)",
        # Carrier page headers / claim reference lines
        r"(State Farm|Allstate|Nationwide|USAA|Travelers|Liberty Mutual|Farmers|Ampion)\s+(Claims?|Insurance|Property)",
        r"\bInsurance\s+Compan",
        r"\b\d{2,}-[A-Z0-9]{2,}-[A-Z0-9]{2,}",  # claim ref IDs like "46-97D8-46Q"
    ]
    for p in junk_pats:
        if re.search(p, line):
            return True
    if re.match(r"^[\d'\".\s]+$", line) and len(line) < 20:
        return True
    return False


def clean_desc(s: str) -> str:
    return s.strip().rstrip("*").strip()


def parse_dimensions(text: str) -> dict:
    dims: Dict[str, float] = {}
    for field, pat in DIM_PATTERNS.items():
        m = pat.search(text)
        if m:
            dims[field] = float(m.group(1).replace(",", ""))
    return dims


def merge_dims(base: dict, extra: dict) -> dict:
    merged = dict(base)
    for k, v in extra.items():
        if k in (
            "sf_floor",
            "sf_ceiling",
            "sf_walls",
            "sf_walls_ceiling",
            "sy_flooring",
            "lf_floor_perimeter",
            "lf_ceil_perimeter",
        ):
            merged[k] = merged.get(k, 0) + v
    return merged


def detect_layout(lines: list) -> str:
    for line in lines:
        if HEADER_B.search(line) or HEADER_B2.match(line.strip()):
            return "B"
        if HEADER_A.search(line):
            return "A"
    return "A"


def looks_like_data_b(line: str) -> bool:
    return bool(LAYOUT_B_DATA_START.match(line.strip()))


# ──────────────────────────────────────────────────────────────────────
# Line item parsing
# ──────────────────────────────────────────────────────────────────────


def _make_empty_item(num: int, desc: str) -> dict:
    return {
        "item_number": num,
        "description": desc,
        "quantity": None,
        "unit": None,
        "unit_price": None,
        "tax": None,
        "op": None,
        "rcv": None,
        "depreciation": None,
        "acv": None,
        "note": None,
    }


def parse_item_a(line: str) -> Optional[dict]:
    # Try standard 6-column layout first (price tax op rcv dep acv)
    m = LAYOUT_A_INLINE_RE.match(line)
    if m:
        return {
            "item_number": int(m.group(1)),
            "description": clean_desc(m.group(2)),
            "quantity": parse_num(m.group(3)),
            "unit": m.group(4),
            "unit_price": parse_num(m.group(5)),
            "tax": parse_num(m.group(6)),
            "op": parse_num(m.group(7)),
            "rcv": parse_num(m.group(8)),
            "depreciation": -abs(parse_num(m.group(9))),
            "acv": parse_num(m.group(10)),
            "note": None,
        }
    # Try 5-column variant (price op rcv dep acv — no tax column)
    m5 = LAYOUT_A_5COL_RE.match(line)
    if m5:
        return {
            "item_number": int(m5.group(1)),
            "description": clean_desc(m5.group(2)),
            "quantity": parse_num(m5.group(3)),
            "unit": m5.group(4),
            "unit_price": parse_num(m5.group(5)),
            "tax": 0.0,
            "op": parse_num(m5.group(6)),
            "rcv": parse_num(m5.group(7)),
            "depreciation": -abs(parse_num(m5.group(8))),
            "acv": parse_num(m5.group(9)),
            "note": None,
        }
    return None


def parse_data_b(line: str) -> Optional[dict]:
    line = line.replace("*", "")
    m = LAYOUT_B_DATA_START.match(line.strip())
    if not m:
        return None
    qty = parse_num(m.group(1))
    unit = m.group(2)
    rest = line.strip()[m.end() :].strip()
    nums = re.findall(r"\([\d,]+\.?\d*\)|[\d,]+\.?\d*", rest)
    if len(nums) < 4:
        return None
    return {
        "quantity": qty,
        "unit": unit,
        "unit_price": parse_num(nums[0]),
        "tax": parse_num(nums[1]),
        "op": parse_num(nums[2]),
        "rcv": parse_num(nums[3]),
        "depreciation": -abs(parse_num(nums[-2])),
        "acv": parse_num(nums[-1]),
    }


def is_note(line: str) -> bool:
    ln = line.strip()
    if not ln:
        return False
    if re.match(r"^\d+\.", ln):
        return False
    if looks_like_data_b(ln):
        return False
    if ln.startswith("Totals:") or ln.startswith("Total:"):
        return False
    if ROOM_HEIGHT_RE.match(ln):
        return False
    if LEVEL_MARKERS.match(ln) or APPENDIX_MARKERS.match(ln):
        return False
    nums = sum(1 for t in ln.split() if re.match(r"^[\d,().]+$", t))
    if nums >= 4:
        return False
    # Reject page headers / carrier junk that slipped through is_junk
    if is_junk(ln):
        return False
    return True


# ──────────────────────────────────────────────────────────────────────
# Section parsing helpers (room / standalone common)
# ──────────────────────────────────────────────────────────────────────


def _flush_pending(container: dict) -> None:
    p = container.get("_pending")
    if p:
        container["line_items"].append(p)
        container["_pending"] = None


def _advance_a(lines: list, i: int, container: dict) -> int:
    line = lines[i].strip()

    item = parse_item_a(line)
    if item:
        _flush_pending(container)
        container["line_items"].append(item)
        return i + 1

    m = re.match(r"^(\d+)\.\s+(.+)$", line)
    if m:
        combined = line + " " + (lines[i + 1].strip() if i + 1 < len(lines) else "")
        item = parse_item_a(combined)
        if item:
            _flush_pending(container)
            container["line_items"].append(item)
            return i + 2
        _flush_pending(container)
        container["_pending"] = _make_empty_item(int(m.group(1)), clean_desc(m.group(2)))
        return i + 1

    p = container.get("_pending")
    if p:
        if p["quantity"] is None:
            qm = re.match(r"^([\d,]+\.?\d*)\s*" + UNITS, line)
            if qm:
                rest_line = line[qm.end() :].strip()
                nums = re.findall(r"\([\d,]+\.?\d*\)|[\d,]+\.?\d*", rest_line)
                p["quantity"] = parse_num(qm.group(1))
                p["unit"] = qm.group(2)
                if len(nums) >= 5:
                    p["unit_price"] = parse_num(nums[0])
                    p["tax"] = parse_num(nums[1])
                    p["op"] = parse_num(nums[2])
                    p["rcv"] = parse_num(nums[3])
                    p["depreciation"] = -abs(parse_num(nums[4]))
                    if len(nums) >= 6:
                        p["acv"] = parse_num(nums[5])
                _flush_pending(container)
            else:
                p["description"] += " " + line
        elif is_note(line):
            p["note"] = ((p.get("note") or "") + " " + line).strip()
        return i + 1

    if container["line_items"] and is_note(line):
        last = container["line_items"][-1]
        last["note"] = ((last.get("note") or "") + " " + line).strip()

    return i + 1


def _advance_b(lines: list, i: int, container: dict) -> int:
    line = lines[i].strip()

    if HEADER_B2.match(line) or COND_DEP_LINE.match(line):
        return i + 1
    if re.match(
        r"^(CEILING|WALLS?|FLOOR|SUBFLOOR|C9RY|ITEL)\b", line, re.IGNORECASE
    ):
        return i + 1

    line = re.sub(r"^\*\s*", "", line)
    m = re.match(r"^(\d+)\.\s+(.+)$", line)
    if m and not looks_like_data_b(line):
        _flush_pending(container)
        container["_pending"] = _make_empty_item(int(m.group(1)), clean_desc(m.group(2)))
        return i + 1

    p = container.get("_pending")

    if looks_like_data_b(line) and p:
        data = parse_data_b(line)
        if data:
            p.update(data)
        _flush_pending(container)
        return i + 1

    if is_note(line):
        target = p if p else (container["line_items"][-1] if container["line_items"] else None)
        if target:
            target["note"] = ((target.get("note") or "") + " " + line).strip()

    return i + 1


# ──────────────────────────────────────────────────────────────────────
# Main parser
# ──────────────────────────────────────────────────────────────────────


def _make_room(name: str, height: Optional[float]) -> dict:
    return {
        "name": name,
        "height_ft": height,
        "dimensions": {},
        "line_items": [],
        "totals": None,
        "_dim_text": "",
        "_pending": None,
        "_in_dim": True,
    }


def _make_section(name: str) -> dict:
    return {"name": name, "line_items": [], "totals": None, "_pending": None}


def _finalize(obj: Optional[dict]) -> None:
    if not obj:
        return
    _flush_pending(obj)
    obj.pop("_pending", None)
    if "_dim_text" in obj:
        if obj["_dim_text"] and not obj["dimensions"]:
            obj["dimensions"] = parse_dimensions(obj["_dim_text"])
        obj.pop("_dim_text", None)
        obj.pop("_in_dim", None)


def _is_cid_encoded(text: str) -> bool:
    if not text:
        return False
    cid_count = text.count("(cid:")
    null_count = sum(
        1 for c in text if c != "\x00" and ord(c) < 32 and c not in "\n\r\t"
    )
    null_count += text.count("\x00")
    alpha_count = sum(1 for c in text if c.isalpha())
    return (cid_count > 5) or (null_count > len(text) * 0.3 and alpha_count < 50)


def _ocr_page(pdf_path: str, page_idx: int) -> str:
    try:
        import fitz  # type: ignore
        from PIL import Image  # type: ignore
        import pytesseract  # type: ignore
        import io

        doc = fitz.open(pdf_path)
        page = doc[page_idx]
        pix = page.get_pixmap(dpi=200)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        text = pytesseract.image_to_string(img, config="--psm 6")
        return text
    except Exception:
        return ""


def _extract_text_lines(
    pdf_path: str, max_pages: int = 40
) -> Tuple[List[str], List[str]]:
    """Extract text lines from PDF. Returns (lines, page_texts)."""
    import pdfplumber

    all_lines: List[str] = []
    page_texts: List[str] = []

    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            if i >= max_pages:
                logger.warning(
                    "Truncating PDF at %d pages (total %d)",
                    max_pages, len(pdf.pages),
                )
                break
            t = page.extract_text() or ""
            if _is_cid_encoded(t):
                t = _ocr_page(pdf_path, page.page_number - 1)
            page_texts.append(t)
            if t:
                all_lines.extend(t.split("\n"))

    return all_lines, page_texts


def _parse_header(lines: list) -> dict:
    text = "\n".join(lines[:80])
    r: Dict[str, Any] = {
        "estimate_id": None,
        "insured": None,
        "carrier": None,
        "price_list": None,
        "type_of_loss": None,
        "date_of_loss": None,
        "claim_number": None,
        "deductible": None,
    }
    pats = {
        "insured": r"Insured:\s*(.+?)(?:\s{2,}|\n)",
        "claim_number": r"Claim\s*Number:\s*([^\s\n]+)",
        "price_list": r"Price\s*List:\s*([A-Z0-9_]+)",
        "type_of_loss": r"Type\s*of\s*Loss:\s*(.+?)(?:\s{2,}|\n)",
        "date_of_loss": r"Date\s*of\s*Loss:\s*([\d/]+)",
        "deductible": r"Deductible:\s*\$?([\d,]+\.?\d*)",
        "estimate_id": r"Estimate:\s*([^\s\n]+)",
    }
    for field, pat in pats.items():
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            v = m.group(1).strip()
            r[field] = parse_num(v) if field == "deductible" else v

    for c in [
        "State Farm",
        "Nationwide",
        "Allstate",
        "USAA",
        "Travelers",
        "Liberty Mutual",
        "Farmers",
        "Ampion",
    ]:
        if c.lower() in text.lower():
            r["carrier"] = c
            break
    return r


def _parse_body(lines: list, layout: str) -> dict:
    standalone_sections: List[dict] = []
    levels: List[dict] = []
    appendix_sections: List[dict] = []

    current_level: Optional[dict] = None
    current_room: Optional[dict] = None
    current_section: Optional[dict] = None
    current_appendix: Optional[dict] = None
    in_header_zone = True

    def next_meaningful(idx: int) -> str:
        for j in range(idx + 1, min(idx + 10, len(lines))):
            ln = lines[j].strip()
            if ln and not is_junk(ln):
                return ln
        return ""

    adv = _advance_a if layout == "A" else _advance_b

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        if is_junk(line):
            i += 1
            continue

        # CONTINUED
        m = CONTINUED_RE.match(line)
        if m:
            rname = m.group(1).strip()
            if current_level:
                for r in reversed(current_level["rooms"]):
                    if r["name"].lower() == rname.lower():
                        current_room = r
                        break
            if current_appendix and current_appendix["name"].lower() == rname.lower():
                pass
            i += 1
            continue

        # APPENDIX
        if APPENDIX_MARKERS.match(line):
            _finalize(current_room)
            current_room = None
            _finalize(current_section)
            current_section = None
            _finalize(current_appendix)
            current_appendix = _make_section(line)
            appendix_sections.append(current_appendix)
            i += 1
            continue

        # LEVEL marker
        if LEVEL_MARKERS.match(line):
            _finalize(current_room)
            current_room = None
            _finalize(current_section)
            current_section = None
            # Reuse existing level with the same name instead of creating duplicate
            existing = None
            for lv in levels:
                if lv["name"].lower() == line.lower():
                    existing = lv
                    break
            if existing is not None:
                current_level = existing
            else:
                current_level = {"name": line, "rooms": [], "level_totals": None}
                levels.append(current_level)
            in_header_zone = False
            i += 1
            continue

        # Subroom → merge into parent
        ms = SUBROOM_RE.match(line)
        if ms and current_room is not None:
            sub_dim_text = ""
            j = i + 1
            while j < len(lines):
                sl = lines[j].strip()
                if is_junk(sl):
                    j += 1
                    continue
                if HEADER_A.search(sl) or HEADER_B.search(sl):
                    break
                if re.match(r"^(\d+)\.", sl):
                    break
                if ROOM_HEIGHT_RE.match(sl) and not SUBROOM_RE.match(sl):
                    break
                sub_dim_text += " " + sl
                j += 1
            extra_dims = parse_dimensions(sub_dim_text)
            current_room["dimensions"] = merge_dims(
                current_room["dimensions"], extra_dims
            )
            i = j
            continue

        # Room Height
        mh = ROOM_HEIGHT_RE.match(line)
        if mh:
            raw_name = mh.group(1).strip()
            room_name = re.sub(r"^[\d'\"\s.]+", "", raw_name).strip() or raw_name
            height = parse_height(mh.group(2))

            _finalize(current_room)
            _finalize(current_section)
            current_section = None

            if current_level is None:
                current_level = {"name": "Main Level", "rooms": [], "level_totals": None}
                levels.append(current_level)

            current_room = _make_room(room_name, height)
            current_level["rooms"].append(current_room)
            in_header_zone = False
            i += 1
            continue

        # Column header
        if HEADER_A.search(line) or HEADER_B.search(line) or HEADER_B2.match(line):
            if current_room and current_room.get("_dim_text"):
                d = parse_dimensions(current_room["_dim_text"])
                current_room["dimensions"] = {**d, **current_room["dimensions"]}
                current_room["_in_dim"] = False
            if current_room:
                current_room["_in_dim"] = False
            i += 1
            continue

        # Dimension collection (room dim zone)
        if current_room and current_room.get("_in_dim"):
            current_room["_dim_text"] += " " + line
            i += 1
            continue

        # Totals row (5-col or 3-col)
        mt = TOTALS_RE.match(line)
        if mt:
            tots = {
                "tax": parse_num(mt.group(1)),
                "op": parse_num(mt.group(2)),
                "rcv": parse_num(mt.group(3)),
                "depreciation": -abs(parse_num(mt.group(4))),
                "acv": parse_num(mt.group(5)),
            }
        else:
            mt3 = TOTALS_3COL_RE.match(line)
            if mt3:
                tots = {
                    "tax": 0.0,
                    "op": parse_num(mt3.group(1)),
                    "rcv": parse_num(mt3.group(2)),
                    "depreciation": 0.0,
                    "acv": parse_num(mt3.group(3)),
                }
            else:
                tots = None
        if tots is not None:
            if current_appendix and not current_room:
                _finalize(current_appendix)
                current_appendix["totals"] = tots
                current_appendix = None
            elif current_room:
                _finalize(current_room)
                current_room["totals"] = tots
                current_room = None
            elif current_section:
                _finalize(current_section)
                current_section["totals"] = tots
                current_section = None
            i += 1
            continue

        # Total: Level
        ml = TOTAL_LEVEL_RE.match(line)
        if ml and current_level:
            current_level["level_totals"] = {
                "tax": parse_num(ml.group(1)),
                "op": parse_num(ml.group(2)),
                "rcv": parse_num(ml.group(3)),
                "depreciation": -abs(parse_num(ml.group(4))),
                "acv": parse_num(ml.group(5)),
            }
            i += 1
            continue

        # Standalone section detection
        nxt = next_meaningful(i)
        is_section_name = (
            not re.match(r"^\d+\.", line)
            and not LEVEL_MARKERS.match(line)
            and not APPENDIX_MARKERS.match(line)
            and not ROOM_HEIGHT_RE.match(line)
            and not looks_like_data_b(line)
            and len(line.split()) <= 5
            and re.search(r"[A-Za-z]", line)
            and "," not in line
            and not re.search(r"\d{4,}", line)
            and current_appendix is None
            and (HEADER_A.search(nxt) or HEADER_B.search(nxt))
            and current_room is None
        )
        if is_section_name:
            _finalize(current_section)
            current_section = _make_section(line)
            standalone_sections.append(current_section)
            i += 1
            continue

        # Skip unmatched Totals rows (e.g. unusual column count)
        if line.startswith("Totals:") or line.startswith("Total:"):
            _finalize(current_room)
            current_room = None
            i += 1
            continue

        # Line items
        target = current_appendix or current_room or current_section
        if target:
            i = adv(lines, i, target)
            continue

        i += 1

    _finalize(current_room)
    _finalize(current_section)
    _finalize(current_appendix)

    # Filter out empty levels (no rooms, no totals) that appear
    # from repeated level names in appendix/diagram pages.
    levels = [lv for lv in levels if lv["rooms"] or lv.get("level_totals")]

    return {
        "standalone_sections": standalone_sections,
        "levels": levels,
        "appendix_sections": appendix_sections,
    }


def _parse_summary(lines: list) -> dict:
    text = "\n".join(lines)
    s: Dict[str, Any] = {
        "line_item_total": None,
        "material_sales_tax": None,
        "gc_overhead": None,
        "gc_profit": None,
        "rcv": None,
        "depreciation": None,
        "acv": None,
        "deductible": None,
        "net_claim": None,
    }
    pats = {
        "line_item_total": r"Line\s+Item\s+Total\s+([\d,]+\.?\d*)",
        "material_sales_tax": r"Material\s+Sales\s+Tax\s+([\d,]+\.?\d*)",
        "gc_overhead": r"(?:General\s+Contractor\s+Overhead|Overhead)\s+([\d,]+\.?\d*)",
        "gc_profit": r"(?:General\s+Contractor\s+Profit|Profit)\s+([\d,]+\.?\d*)",
        "rcv": r"Replacement\s+Cost\s+Value\s+\$?([\d,]+\.?\d*)",
        "depreciation": r"Less\s+Depreciation\s+\(?([\d,]+\.?\d*)\)?",
        "acv": r"Actual\s+Cash\s+Value\s+\$?([\d,]+\.?\d*)",
        "deductible": r"Less\s+Deductible\s+\(?([\d,]+\.?\d*)\)?",
        "net_claim": r"Net\s+Claim\s+\$?([\d,]+\.?\d*)",
    }
    for field, pat in pats.items():
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            s[field] = parse_num(m.group(1))
    if s["depreciation"] and s["depreciation"] > 0:
        s["depreciation"] = -s["depreciation"]
    m = re.search(
        r"Line\s+Item\s+Totals?:\s*\S+\s+[\d,]+\.\d+\s+[\d,]+\.\d+\s+([\d,]+\.\d+)",
        text,
        re.IGNORECASE,
    )
    if m:
        s["grand_total_rcv"] = parse_num(m.group(1))
    else:
        s["grand_total_rcv"] = s["rcv"]
    return s


def _collect_page_header_lines(page_texts: List[str]) -> set:
    """Detect repeating page-header lines by finding text that appears on 3+ pages."""
    from collections import Counter

    line_counts: Counter = Counter()
    for page in page_texts:
        # Only check the first ~8 non-empty lines of each page (header zone)
        seen_on_page: set = set()
        count = 0
        for raw_line in (page or "").split("\n"):
            ln = raw_line.strip()
            if not ln:
                continue
            count += 1
            if count > 8:
                break
            # Normalize whitespace for matching
            norm = re.sub(r"\s+", " ", ln).strip()
            if norm and norm not in seen_on_page:
                seen_on_page.add(norm)
                line_counts[norm] += 1

    # Lines appearing on 3+ pages are page headers
    return {ln for ln, c in line_counts.items() if c >= 3}


def _clean_notes_with_header(body: dict, header_lines: set) -> None:
    """Remove notes that match page-header text."""
    if not header_lines:
        return

    def _is_header_junk(note: str) -> bool:
        norm = re.sub(r"\s+", " ", note).strip()
        # Exact match
        if norm in header_lines:
            return True
        # Note is a substring of a header line or vice versa
        for hl in header_lines:
            if norm in hl or hl in norm:
                return True
        return False

    def _clean_note(note: Optional[str]) -> Optional[str]:
        if not note:
            return None
        # Split concatenated note parts and filter each
        parts = [p.strip() for p in note.split("  ") if p.strip()]
        if len(parts) <= 1:
            parts = [note.strip()]
        cleaned = [p for p in parts if not _is_header_junk(p)]
        return " ".join(cleaned).strip() or None

    for sec in body.get("standalone_sections", []) + body.get("appendix_sections", []):
        for item in sec.get("line_items", []):
            item["note"] = _clean_note(item.get("note"))

    for lv in body.get("levels", []):
        for rm in lv.get("rooms", []):
            for item in rm.get("line_items", []):
                item["note"] = _clean_note(item.get("note"))


def parse_estimate(pdf_path: str, max_pages: int = 40) -> dict:
    """Main entry point — parse a Xactimate PDF and return structured result."""
    all_lines, page_texts = _extract_text_lines(pdf_path, max_pages)
    layout = detect_layout(all_lines)
    header = _parse_header(all_lines)
    body = _parse_body(all_lines, layout)
    summary = _parse_summary(all_lines)

    # Debug: count total line items across all containers
    total_items = 0
    for sec in body.get("standalone_sections", []):
        total_items += len(sec.get("line_items", []))
    for lv in body.get("levels", []):
        for rm in lv.get("rooms", []):
            total_items += len(rm.get("line_items", []))
    for sec in body.get("appendix_sections", []):
        total_items += len(sec.get("line_items", []))

    logger.info(
        "reference_parser result: layout=%s, levels=%d, rooms=%d, appendix=%d, total_items=%d, lines=%d",
        layout,
        len(body.get("levels", [])),
        sum(len(lv.get("rooms", [])) for lv in body.get("levels", [])),
        len(body.get("appendix_sections", [])),
        total_items,
        len(all_lines),
    )
    if total_items == 0 and all_lines:
        # Log sample lines for debugging parse failures
        sample = [l for l in all_lines[:200] if l.strip() and not is_junk(l)][:30]
        logger.warning(
            "reference_parser: 0 items extracted. Sample non-junk lines:\n%s",
            "\n".join(f"  [{i}] {l}" for i, l in enumerate(sample)),
        )

    # Post-process: remove page-header text that leaked into notes
    header_lines = _collect_page_header_lines(page_texts)
    _clean_notes_with_header(body, header_lines)

    return {**header, "layout": layout, **body, "summary": summary, "_page_texts": page_texts}


# ──────────────────────────────────────────────────────────────────────
# Adapter: Convert structured result → pipeline-compatible output
# ──────────────────────────────────────────────────────────────────────


def _dec(x: Any) -> Optional[Decimal]:
    if x is None:
        return None
    try:
        return Decimal(str(x))
    except Exception:
        return None


def _item_to_dto(
    item: dict,
    room_name: Optional[str],
    section_type: str,
    room_meta: Optional[dict] = None,
    is_first_in_room: bool = False,
) -> ParsedItemDTO:
    """Convert a reference parser line item dict to ParsedItemDTO."""
    xact: Dict[str, Any] = {}
    if item.get("item_number") is not None:
        xact["item_number"] = item["item_number"]
    for k in ("tax", "op", "rcv", "depreciation", "acv"):
        if item.get(k) is not None:
            xact[k] = item[k]
    xact["section_type"] = section_type

    if is_first_in_room and room_meta:
        xact["room_measurements"] = {
            "dimensions": room_meta.get("dimensions", {}),
            "height_ft": room_meta.get("height_ft"),
        }

    token_offsets: Dict[str, Any] = {}
    if xact:
        token_offsets["xactimate"] = xact

    return ParsedItemDTO(
        line_item=(item.get("description") or "").strip() or "(no description)",
        room=room_name,
        notes=item.get("note"),
        unit_price=_dec(item.get("unit_price")),
        quantity=_dec(item.get("quantity")),
        unit=item.get("unit"),
        confidence=Decimal("0.92"),
        raw_line=None,
        token_offsets=token_offsets,
        validation_flags=["quantity_invalid"] if item.get("quantity") is None else [],
        item_number=item.get("item_number"),
        tax=_dec(item.get("tax")),
        op=_dec(item.get("op")),
        rcv=_dec(item.get("rcv")),
        depreciation=_dec(item.get("depreciation")),
        acv=_dec(item.get("acv")),
    )


def _build_hierarchy_from_result(
    parsed: dict, item_offset_map: Dict[int, int]
) -> Dict[str, Any]:
    """Build hierarchy metadata from structured parse result.

    item_offset_map: maps (flat_index) → sort_order in the final DTO list.
    """
    levels_out: List[Dict[str, Any]] = []
    sections_out: List[Dict[str, Any]] = []

    flat_idx = 0

    # Standalone sections
    for sec in parsed.get("standalone_sections", []):
        indices = list(range(flat_idx, flat_idx + len(sec["line_items"])))
        sections_out.append({
            "name": sec["name"],
            "item_indices": indices,
            "kind": "standalone",
            "totals": sec.get("totals") or {},
        })
        flat_idx += len(sec["line_items"])

    # Levels
    for lv in parsed.get("levels", []):
        rooms_out: List[Dict[str, Any]] = []
        for rm in lv.get("rooms", []):
            indices = list(range(flat_idx, flat_idx + len(rm["line_items"])))
            rooms_out.append({
                "name": rm["name"],
                "item_indices": indices,
                "dimensions": rm.get("dimensions", {}),
                "height_ft": rm.get("height_ft"),
                "totals": rm.get("totals") or {},
            })
            flat_idx += len(rm["line_items"])
        levels_out.append({
            "name": lv["name"],
            "rooms": rooms_out,
            "level_totals": lv.get("level_totals") or {},
        })

    # Appendix sections
    for sec in parsed.get("appendix_sections", []):
        indices = list(range(flat_idx, flat_idx + len(sec["line_items"])))
        sections_out.append({
            "name": sec["name"],
            "item_indices": indices,
            "kind": "appendix",
            "totals": sec.get("totals") or {},
        })
        flat_idx += len(sec["line_items"])

    return {
        "levels": levels_out,
        "sections": sections_out,
        "unassigned_item_indices": [],
    }


def parse_with_reference(
    pdf_path: str, max_pages: int = 40,
) -> Tuple[List[ParsedItemDTO], List[str], Dict[str, Any]]:
    """Parse PDF with reference parser and return pipeline-compatible output.

    Returns: (items, page_texts, diagnostics_with_hierarchy)
    """
    diagnostics: Dict[str, Any] = {"strategy": "xactimate_reference"}

    try:
        result = parse_estimate(pdf_path, max_pages=max_pages)
    except Exception as e:
        diagnostics["reference_error"] = str(e)
        return [], [], diagnostics

    page_texts: List[str] = result.pop("_page_texts", [])

    # Flatten all line items into DTOs
    items: List[ParsedItemDTO] = []

    # 1. Standalone sections
    for sec in result.get("standalone_sections", []):
        for i, li in enumerate(sec.get("line_items", [])):
            items.append(_item_to_dto(li, room_name=sec["name"], section_type="standalone"))

    # 2. Levels → Rooms
    for lv in result.get("levels", []):
        for rm in lv.get("rooms", []):
            room_meta = {
                "dimensions": rm.get("dimensions", {}),
                "height_ft": rm.get("height_ft"),
            }
            for i, li in enumerate(rm.get("line_items", [])):
                items.append(
                    _item_to_dto(
                        li,
                        room_name=rm["name"],
                        section_type="room",
                        room_meta=room_meta,
                        is_first_in_room=(i == 0),
                    )
                )

    # 3. Appendix sections
    for sec in result.get("appendix_sections", []):
        for li in sec.get("line_items", []):
            items.append(_item_to_dto(li, room_name=sec["name"], section_type="appendix"))

    if not items:
        diagnostics["reference_skipped"] = "no_items_extracted"
        return [], page_texts, diagnostics

    # Build hierarchy from structured result
    offset_map = {i: i for i in range(len(items))}
    hierarchy = _build_hierarchy_from_result(result, offset_map)

    diagnostics["xactimate_item_count"] = len(items)
    diagnostics["hierarchy"] = hierarchy
    diagnostics["header"] = {
        k: v
        for k, v in result.items()
        if k
        in (
            "estimate_id",
            "insured",
            "carrier",
            "price_list",
            "type_of_loss",
            "date_of_loss",
            "claim_number",
            "deductible",
            "layout",
        )
    }
    diagnostics["summary"] = result.get("summary", {})

    return items, page_texts, diagnostics
