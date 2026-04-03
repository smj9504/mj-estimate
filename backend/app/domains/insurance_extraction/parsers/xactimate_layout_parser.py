"""
Xactimate-style insurance estimate PDF parsing via pdfplumber layout (coordinates).

Strategy follows reference/insurance_estimate/xactimate_parsing_focused.md:
dynamic header column detection, numbered line items, room headers, Totals rows.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from app.domains.insurance_extraction.interfaces import ParsedItemDTO
from app.domains.insurance_extraction.parsers.line_item_gating import (
    line_looks_like_room_measurement_sketch_line,
)

ROOM_START_PATTERN = re.compile(
    r"^(?:Subroom:\s+)?(.+?)\s+Height:\s+([\d'\"\s]+)",
    re.IGNORECASE,
)
SUBROOM_RE = re.compile(r"^Subroom:\s*(.+?)\s+Height:\s*([\d'\"]+)", re.IGNORECASE)

DIMENSION_PATTERNS = {
    "sf_walls": re.compile(
        r"([\d,]+\.?\d*)\s+SF\s+Walls?(?!\s+and|\s+&|\s+Ceil)",
        re.IGNORECASE,
    ),
    "sf_ceiling": re.compile(r"([\d,]+\.?\d*)\s+SF\s+Ceil(?:ing)?", re.IGNORECASE),
    "sf_floor": re.compile(r"([\d,]+\.?\d*)\s+SF\s+Floor", re.IGNORECASE),
    "sf_walls_ceiling": re.compile(
        r"([\d,]+\.?\d*)\s+SF\s+(?:Walls?\s+(?:and|&)\s+Ceiling|Walls?\s+&\s+Ceiling)",
        re.IGNORECASE,
    ),
    "lf_floor_perimeter": re.compile(
        r"([\d,]+\.?\d*)\s+LF\s+Floor\s+Perimeter",
        re.IGNORECASE,
    ),
    "lf_ceil_perimeter": re.compile(
        r"([\d,]+\.?\d*)\s+LF\s+Ceil(?:ing)?\.?\s+Perimeter",
        re.IGNORECASE,
    ),
    "sy_flooring": re.compile(r"([\d,]+\.?\d*)\s+SY\s+Flooring", re.IGNORECASE),
}

HEADER_FIELD_ALIASES: List[Tuple[str, List[str]]] = [
    ("age_life", ["AGE/LIFE"]),
    ("dep_pct", ["DEP %", "DEP%"]),
    ("deprec", ["DEPRECIATION", "DEPREC.", "DEPREC"]),
    ("quantity", ["QUANTITY", "QTY"]),
    ("unit", ["UNIT"]),
    ("unit_price", ["UNIT PRICE", "UNIT_PRICE"]),
    ("unit_price", ["PRICE"]),
    ("tax", ["TAX"]),
    ("op", ["GCO&P", "O&P", "O & P", "O/P"]),
    ("rcv", ["RCV"]),
    ("acv", ["ACV"]),
]

ITEM_START = re.compile(r"^(\d+)\.\s*")
NUMERIC_TOKEN = re.compile(r"^-?[\d,]+\.?\d*$")
MONEYISH_TOKEN = re.compile(r"^[\$\s\(\)\d,\.]+$")
ITEM_INDEX_TOKEN = re.compile(r"^\d+\.$")
HEADER_A = re.compile(r"DESCRIPTION\s+QUANTITY\s+UNIT\s+PRICE", re.IGNORECASE)
HEADER_B = re.compile(
    r"QUANTITY\s+UNIT(?:\s+PRICE)?\s+TAX\s+(?:GC)?O.?P\s+RCV\s+AGE",
    re.IGNORECASE,
)
HEADER_B2 = re.compile(r"^CONDITION\s+DEP\s*%", re.IGNORECASE)
COND_DEP_LINE = re.compile(r"^(Avg\.|Good|Fair|Poor)\s+[\d.]+%?$", re.IGNORECASE)
LAYOUT_B_DATA_START = re.compile(
    r"^([\d,]+\.?\d*)\s*(EA|SF|LF|HR|SY|SQ|DA|WK|LB|BX|RL|GL|TB|SH)\b",
    re.IGNORECASE,
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
    r"([\d,]+\.?\d*)$",
    re.IGNORECASE,
)
CONTINUED_RE = re.compile(r"^CONTINUED\s*[-–]\s*(.+)$", re.IGNORECASE)

NON_OP_PHRASES = (
    "agreed price",
    "bid item",
    "paid invoice",
    "lump sum",
    "per estimate",
    "per invoice",
)


def norm_header(s: str) -> str:
    return re.sub(r"\s+", " ", s.upper().strip())


def parse_number(s: str) -> Optional[Decimal]:
    if not s or not str(s).strip():
        return None
    t = str(s).strip().replace("$", "").replace(" ", "")
    neg = t.startswith("(") and t.endswith(")")
    t = t.replace("(", "").replace(")", "").replace(",", "")
    try:
        v = Decimal(t)
        return -v if neg else v
    except Exception:
        return None


def parse_height(height_str: str) -> Optional[float]:
    m = re.match(r"(\d+)'(?:\s*(\d+)\")?", height_str.strip())
    if not m:
        return None
    feet = int(m.group(1))
    inches = int(m.group(2)) if m.group(2) else 0
    return round(feet + inches / 12, 2)


def parse_room_header(text_block: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "name": None,
        "height_ft": None,
        "level": None,
        "dimensions": {},
    }
    m = ROOM_START_PATTERN.search(text_block)
    if m:
        result["name"] = m.group(1).strip()
        h = parse_height(m.group(2))
        if h is not None:
            result["height_ft"] = h
    for field, pattern in DIMENSION_PATTERNS.items():
        dm = pattern.search(text_block)
        if dm:
            try:
                result["dimensions"][field] = float(dm.group(1).replace(",", ""))
            except ValueError:
                pass
    return result


def group_words_by_line(words: List[dict], tolerance: float = 2.0) -> List[List[dict]]:
    if not words:
        return []
    sorted_w = sorted(words, key=lambda w: (float(w["top"]), float(w["x0"])))
    lines: List[List[dict]] = []
    current: List[dict] = []
    last_top: Optional[float] = None
    for w in sorted_w:
        t = float(w["top"])
        if last_top is None or abs(t - last_top) <= tolerance:
            current.append(w)
            if last_top is None:
                last_top = t
            else:
                last_top = (last_top + t) / 2
        else:
            if current:
                lines.append(current)
            current = [w]
            last_top = t
    if current:
        lines.append(current)
    return lines


def line_text(line_words: List[dict]) -> str:
    return " ".join(w["text"] for w in sorted(line_words, key=lambda w: float(w["x0"])))


def _is_table_header_line(line_words: List[dict]) -> bool:
    parts = {norm_header(w["text"]) for w in line_words}
    joined = norm_header(line_text(line_words))
    has_qty = "QUANTITY" in parts or "QTY" in parts
    has_rest = (
        "RCV" in parts
        or "TAX" in parts
        or "UNIT" in parts
        or "PRICE" in joined
        or "UNIT PRICE" in joined
    )
    return has_qty and has_rest


def _assign_header_fields(header_words: List[dict]) -> Dict[str, Tuple[int, int]]:
    hw = sorted(header_words, key=lambda w: float(w["x0"]))
    n = len(hw)
    col_indices: Dict[str, Tuple[int, int]] = {}
    i = 0
    occupied = set()

    def try_match(start: int) -> Optional[Tuple[str, int]]:
        """Prefer shorter token runs first so UNIT matches before UNIT PRICE consumes two words."""
        max_l = min(6, n - start)
        for L in range(1, max_l + 1):
            chunk = norm_header(" ".join(hw[start + j]["text"] for j in range(L)))
            for field, aliases in HEADER_FIELD_ALIASES:
                if field in col_indices:
                    continue
                for al in aliases:
                    aln = norm_header(al)
                    if chunk == aln or chunk.startswith(aln + " ") or chunk.startswith(aln):
                        return (field, L)
        return None

    while i < n:
        if i in occupied:
            i += 1
            continue
        got = try_match(i)
        if got:
            field, L = got
            if field not in col_indices:
                for j in range(L):
                    occupied.add(i + j)
                col_indices[field] = (i, i + L)
                i += L
                continue
        i += 1
    return col_indices


def find_header_columns(
    header_words: List[dict], page_width: float
) -> Dict[str, Tuple[float, float]]:
    col_indices = _assign_header_fields(header_words)
    hw = sorted(header_words, key=lambda w: float(w["x0"]))
    ordered = sorted(col_indices.items(), key=lambda kv: kv[1][0])
    col_positions: Dict[str, Tuple[float, float]] = {}
    for j, (field, (si, ei)) in enumerate(ordered):
        x0 = float(hw[si]["x0"])
        if j + 1 < len(ordered):
            next_si = ordered[j + 1][1][0]
            x1 = float(hw[next_si]["x0"]) - 2.0
        else:
            x1 = float(page_width)
        col_positions[field] = (x0, x1)

    if "quantity" in col_positions and "unit" not in col_positions:
        col_positions["quantity_unit_combined"] = col_positions.pop("quantity")
    return col_positions


def _word_center_x(w: dict) -> float:
    return (float(w["x0"]) + float(w["x1"])) / 2.0


def column_text(line_words: List[dict], x0: float, x1: float, pad: float = 4.0) -> str:
    parts = [
        w["text"]
        for w in sorted(line_words, key=lambda w: float(w["x0"]))
        if x0 - pad <= _word_center_x(w) <= x1 + pad
    ]
    return " ".join(parts).strip()


def _words_in_column(line_words: List[dict], x0: float, x1: float, pad: float = 4.0) -> List[dict]:
    return [
        w
        for w in sorted(line_words, key=lambda w: float(w["x0"]))
        if x0 - pad <= _word_center_x(w) <= x1 + pad
    ]


def _numeric_words_in_column(line_words: List[dict], x0: float, x1: float) -> List[dict]:
    out: List[dict] = []
    for w in _words_in_column(line_words, x0, x1):
        t = w["text"].replace(",", "")
        if ITEM_INDEX_TOKEN.match(w["text"].strip()):
            continue
        if NUMERIC_TOKEN.match(t) or (MONEYISH_TOKEN.match(w["text"]) and any(c.isdigit() for c in w["text"])):
            out.append(w)
    return out


def _rightmost_numeric_value(line_words: List[dict], x0: float, x1: float) -> Optional[Decimal]:
    nums = _numeric_words_in_column(line_words, x0, x1)
    if not nums:
        return None
    best = max(nums, key=lambda w: float(w["x0"]))
    return parse_number(best["text"])


def _is_note_line(line_text_s: str, line_words: List[dict]) -> bool:
    text = line_text_s.strip()
    if not text:
        return False
    if ITEM_START.match(text):
        return False
    if text.startswith("Totals:") or text.startswith("Total:"):
        return False
    numeric_count = sum(
        1 for w in line_words if NUMERIC_TOKEN.match(w["text"].replace(",", ""))
    )
    if numeric_count >= 4:
        return False
    return True


def _parse_num_loose(s: Optional[str]) -> float:
    if s is None:
        return 0.0
    t = str(s).strip().replace("*", "")
    neg = t.startswith("(") and t.endswith(")")
    t = t.replace("(", "").replace(")", "").replace(",", "").replace("$", "")
    try:
        v = float(t)
        return -v if neg else v
    except Exception:
        return 0.0


def _detect_layout_from_lines(lines: List[str]) -> str:
    for line in lines:
        if HEADER_B.search(line) or HEADER_B2.match(line.strip()):
            return "B"
        if HEADER_A.search(line):
            return "A"
    return "A"


def _looks_like_data_b(line: str) -> bool:
    return bool(LAYOUT_B_DATA_START.match(line.strip()))


def _parse_data_b(line: str) -> Optional[Dict[str, Any]]:
    line = line.replace("*", "")
    m = LAYOUT_B_DATA_START.match(line.strip())
    if not m:
        return None
    qty = _parse_num_loose(m.group(1))
    unit = m.group(2).upper()
    rest = line.strip()[m.end() :].strip()
    nums = re.findall(r"\([\d,]+\.?\d*\)|[\d,]+\.?\d*", rest)
    if len(nums) < 4:
        return None
    return {
        "quantity": qty,
        "unit": unit,
        "unit_price": _parse_num_loose(nums[0]),
        "tax": _parse_num_loose(nums[1]),
        "op": _parse_num_loose(nums[2]),
        "rcv": _parse_num_loose(nums[3]),
        "depreciation": -abs(_parse_num_loose(nums[-2])),
        "acv": _parse_num_loose(nums[-1]),
    }


def _parse_item_a_inline(line: str) -> Optional[Dict[str, Any]]:
    m = LAYOUT_A_INLINE_RE.match(line.strip())
    if not m:
        return None
    return {
        "item_number": int(m.group(1)),
        "description": m.group(2).strip().rstrip("*").strip(),
        "quantity": _parse_num_loose(m.group(3)),
        "unit": m.group(4).upper(),
        "unit_price": _parse_num_loose(m.group(5)),
        "tax": _parse_num_loose(m.group(6)),
        "op": _parse_num_loose(m.group(7)),
        "rcv": _parse_num_loose(m.group(8)),
        "depreciation": -abs(_parse_num_loose(m.group(9))),
        "acv": _parse_num_loose(m.group(10)),
        "note": None,
    }


def _extract_lines_from_pages(page_texts: List[str]) -> List[str]:
    out: List[str] = []
    for page in page_texts:
        out.extend((page or "").splitlines())
    return [re.sub(r"\s+", " ", l).strip() for l in out if l and l.strip()]


def _parse_text_layout_items(page_texts: List[str]) -> List[Dict[str, Any]]:
    lines = _extract_lines_from_pages(page_texts)
    layout = _detect_layout_from_lines(lines)
    current_room: Optional[str] = None
    current_section: Optional[str] = None
    room_dim_buffer: List[str] = []
    room_dim_collecting = False
    room_meta_by_name: Dict[str, Dict[str, Any]] = {}
    known_rooms: set[str] = set()
    pending: Optional[Dict[str, Any]] = None
    out: List[Dict[str, Any]] = []

    def flush_pending() -> None:
        nonlocal pending
        if pending:
            out.append(pending)
            pending = None

    i = 0
    def next_meaningful(idx: int) -> str:
        for j in range(idx + 1, min(idx + 10, len(lines))):
            l = (lines[j] or "").strip()
            if l:
                return l
        return ""

    def looks_like_section_name(line: str, nxt: str) -> bool:
        if not line or re.match(r"^\d+\.", line):
            return False
        if ROOM_START_PATTERN.search(line) or SUBROOM_RE.search(line):
            return False
        if HEADER_A.search(line) or HEADER_B.search(line) or HEADER_B2.match(line):
            return False
        if _looks_like_data_b(line):
            return False
        if "," in line or re.search(r"\d{4,}", line):
            return False
        if len(line.split()) > 5:
            return False
        if not re.search(r"[A-Za-z]", line):
            return False
        return bool(HEADER_A.search(nxt) or HEADER_B.search(nxt) or HEADER_B2.match(nxt))

    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if HEADER_A.search(line) or HEADER_B.search(line) or HEADER_B2.match(line):
            if current_room and room_dim_collecting and room_dim_buffer:
                room_meta_by_name[current_room] = parse_room_header("\n".join(room_dim_buffer))
            room_dim_collecting = False
            room_dim_buffer = []
            i += 1
            continue
        if COND_DEP_LINE.match(line):
            i += 1
            continue
        if line.startswith("Totals:") or line.startswith("Total:"):
            flush_pending()
            current_section = None
            room_dim_collecting = False
            room_dim_buffer = []
            i += 1
            continue
        cm = CONTINUED_RE.match(line)
        if cm:
            candidate = cm.group(1).strip()
            if candidate in known_rooms:
                current_room = candidate
            elif current_section and current_section.lower() == candidate.lower():
                pass
            i += 1
            continue
        rm = ROOM_START_PATTERN.search(line)
        if rm:
            current_room = rm.group(1).strip()
            current_room = re.sub(r"^[\d'\"\s.]+", "", current_room).strip() or current_room
            known_rooms.add(current_room)
            current_section = None
            room_dim_collecting = True
            room_dim_buffer = [line]
            i += 1
            continue
        if SUBROOM_RE.search(line):
            # Subroom is merged into parent room in reference parser behavior.
            if room_dim_collecting:
                room_dim_buffer.append(line)
            i += 1
            continue
        nxt = next_meaningful(i)
        if looks_like_section_name(line, nxt):
            if current_room and room_dim_collecting and room_dim_buffer:
                room_meta_by_name[current_room] = parse_room_header("\n".join(room_dim_buffer))
            room_dim_collecting = False
            room_dim_buffer = []
            current_section = line
            current_room = None
            i += 1
            continue

        if current_room and room_dim_collecting:
            if re.match(r"^\d+\.", line) or _looks_like_data_b(line):
                room_meta_by_name[current_room] = parse_room_header("\n".join(room_dim_buffer))
                room_dim_collecting = False
                room_dim_buffer = []
            else:
                room_dim_buffer.append(line)
                i += 1
                continue

        if layout == "A":
            item = _parse_item_a_inline(line)
            if item:
                flush_pending()
                item["room"] = current_room or current_section
                if current_room and current_room in room_meta_by_name:
                    item["_room_meta"] = room_meta_by_name[current_room]
                item["raw_line"] = line
                out.append(item)
                i += 1
                continue
            m = re.match(r"^(\d+)\.\s+(.+)$", line)
            if m:
                combined = line
                if i + 1 < len(lines):
                    combined = f"{line} {lines[i+1].strip()}"
                item = _parse_item_a_inline(combined)
                if item:
                    flush_pending()
                    item["room"] = current_room or current_section
                    if current_room and current_room in room_meta_by_name:
                        item["_room_meta"] = room_meta_by_name[current_room]
                    item["raw_line"] = combined
                    out.append(item)
                    i += 2
                    continue
                flush_pending()
                pending = {
                    "item_number": int(m.group(1)),
                    "description": m.group(2).strip().rstrip("*").strip(),
                    "room": current_room or current_section,
                    "_room_meta": room_meta_by_name.get(current_room) if current_room else None,
                    "note": None,
                    "quantity": None,
                    "unit": None,
                    "unit_price": None,
                    "tax": None,
                    "op": None,
                    "rcv": None,
                    "depreciation": None,
                    "acv": None,
                    "raw_line": line,
                }
                i += 1
                continue
            if pending and pending.get("quantity") is None and _looks_like_data_b(line):
                data = _parse_data_b(line)
                if data:
                    pending.update(data)
                    flush_pending()
                i += 1
                continue
        else:
            line2 = re.sub(r"^\*\s*", "", line)
            m = re.match(r"^(\d+)\.\s+(.+)$", line2)
            if m and not _looks_like_data_b(line2):
                flush_pending()
                pending = {
                    "item_number": int(m.group(1)),
                    "description": m.group(2).strip().rstrip("*").strip(),
                    "room": current_room or current_section,
                    "_room_meta": room_meta_by_name.get(current_room) if current_room else None,
                    "note": None,
                    "quantity": None,
                    "unit": None,
                    "unit_price": None,
                    "tax": None,
                    "op": None,
                    "rcv": None,
                    "depreciation": None,
                    "acv": None,
                    "raw_line": line2,
                }
                i += 1
                continue
            if pending and _looks_like_data_b(line):
                data = _parse_data_b(line)
                if data:
                    pending.update(data)
                flush_pending()
                i += 1
                continue

        if pending and line and not line.startswith(("Totals:", "Total:")) and not _looks_like_data_b(line):
            pending["note"] = ((pending.get("note") or "") + " " + line).strip()
        i += 1

    flush_pending()
    return out


def _looks_like_state_farm_packet(page_texts: List[str]) -> bool:
    joined = "\n".join(page_texts).lower()
    return "state farm claims" in joined or "statefarmfireclaims@" in joined


def extract_numeric_fields(
    item: Dict[str, Any],
    line_words: List[dict],
    col_positions: Dict[str, Tuple[float, float]],
) -> None:
    def get_money_at(field_name: str) -> Optional[Decimal]:
        if field_name not in col_positions:
            return None
        x0, x1 = col_positions[field_name]
        nums = _numeric_words_in_column(line_words, x0, x1)
        if not nums:
            return parse_number(column_text(line_words, x0, x1).replace("$", ""))
        if len(nums) == 1:
            return parse_number(nums[0]["text"])
        joined = " ".join(n["text"] for n in nums)
        return parse_number(joined.replace("$", "").replace(" ", ""))

    if "quantity_unit_combined" in col_positions:
        x0, x1 = col_positions["quantity_unit_combined"]
        qty_unit_text = column_text(line_words, x0, x1)
        m = re.match(
            r"^(-?[\d,]+\.?\d*)\s+([A-Za-z]{1,5})\b",
            qty_unit_text.replace(",", ""),
        )
        if m:
            item["quantity"] = float(m.group(1).replace(",", ""))
            item["unit"] = m.group(2).upper()
        else:
            q = _rightmost_numeric_value(line_words, x0, x1)
            if q is not None:
                item["quantity"] = float(q)
    else:
        if "quantity" in col_positions:
            x0, x1 = col_positions["quantity"]
            q = _rightmost_numeric_value(line_words, x0, x1)
            if q is not None:
                item["quantity"] = float(q)
        if "unit" in col_positions:
            x0, x1 = col_positions["unit"]
            ut = column_text(line_words, x0, x1)
            if ut:
                item["unit"] = ut.split()[0].upper()

    if "unit_price" in col_positions:
        up = get_money_at("unit_price")
        if up is not None:
            item["unit_price"] = float(up)

    for key, fld in [
        ("tax", "tax"),
        ("op", "op"),
        ("rcv", "rcv"),
        ("depreciation", "deprec"),
        ("acv", "acv"),
    ]:
        v = get_money_at(fld)
        if v is not None:
            item[key] = float(v)

    opv = item.get("op")
    txv = item.get("tax")
    if opv is not None and txv is not None and opv == 0.0 and txv == 0.0:
        item["is_op_item"] = False


def _description_from_line_layout_a(
    line_words: List[dict],
    col_positions: Dict[str, Tuple[float, float]],
    item_num_match: re.Match,
) -> str:
    qkey = "quantity_unit_combined" if "quantity_unit_combined" in col_positions else "quantity"
    if qkey not in col_positions:
        cut = 400.0
    else:
        qx0, qx1 = col_positions[qkey]
        qty_nums = _numeric_words_in_column(line_words, qx0, qx1)
        if qty_nums:
            cut = min(float(w["x0"]) for w in qty_nums) - 2.0
        else:
            cut = qx0 - 8.0
    desc_words = [
        w for w in sorted(line_words, key=lambda w: float(w["x0"])) if float(w["x0"]) < cut
    ]
    desc = " ".join(w["text"] for w in desc_words).strip()
    desc = ITEM_START.sub("", desc).strip()
    return desc or item_num_match.group(0).strip()


def _apply_non_op_description(item: Dict[str, Any]) -> None:
    desc = (item.get("description") or "").lower()
    for s in NON_OP_PHRASES:
        if s in desc:
            item["is_op_item"] = False
            return


def _xactimate_parse_trustworthy(items: List[ParsedItemDTO]) -> bool:
    """
    Reject coordinate parses that matched numbered rows but not real line-item tables
    (e.g. State Farm PDFs that mention QUANTITY/RCV but are not Xactimate column layouts).
    """
    known_units = {"SF", "LF", "EA", "SY", "HR", "SQ", "DA"}

    def _structured(i: ParsedItemDTO) -> bool:
        return (
            (i.unit or "") in known_units
            and i.quantity is not None
            and i.unit_price is not None
        )

    n = len(items)
    if n == 0:
        return False
    if n < 3:
        return all(_structured(i) for i in items)

    structured = sum(1 for i in items if _structured(i))
    if n <= 12:
        need = max(3, int(0.5 * n))
    else:
        need = max(8, int(0.2 * n))
    return structured >= need


def raw_dicts_to_dtos(raw_items: List[Dict[str, Any]]) -> List[ParsedItemDTO]:
    out: List[ParsedItemDTO] = []
    for d in raw_items:
        flags: List[str] = []
        if d.get("quantity") is None:
            flags.append("quantity_invalid")

        room_m = d.pop("_room_meta", None)

        token: Dict[str, Any] = {}
        xact: Dict[str, Any] = {}
        if d.get("item_number") is not None:
            xact["item_number"] = d["item_number"]
        for k in ("tax", "op", "rcv", "depreciation", "acv"):
            if d.get(k) is not None:
                xact[k] = d[k]
        if d.get("is_op_item") is not None:
            xact["is_op_item"] = d["is_op_item"]
        if xact:
            token["xactimate"] = xact
        if room_m:
            token.setdefault("xactimate", {})["room_measurements"] = room_m

        def dec(x: Any) -> Optional[Decimal]:
            if x is None:
                return None
            try:
                return Decimal(str(x))
            except Exception:
                return None

        out.append(
            ParsedItemDTO(
                line_item=(d.get("description") or "").strip() or "(no description)",
                room=d.get("room"),
                notes=d.get("note"),
                unit_price=dec(d.get("unit_price")),
                quantity=dec(d.get("quantity")),
                unit=d.get("unit"),
                source_page=d.get("source_page"),
                confidence=Decimal("0.88"),
                raw_line=d.get("raw_line"),
                token_offsets=token,
                validation_flags=flags,
                item_number=d.get("item_number"),
                tax=dec(d.get("tax")),
                op=dec(d.get("op")),
                rcv=dec(d.get("rcv")),
                depreciation=dec(d.get("depreciation")),
                acv=dec(d.get("acv")),
                is_op_item=d.get("is_op_item"),
            )
        )
    return out


def parse_xactimate_pdf(file_path: str) -> Tuple[List[ParsedItemDTO], List[str], Dict[str, Any]]:
    diagnostics: Dict[str, Any] = {"strategy": "xactimate_layout"}
    try:
        import pdfplumber
    except ImportError:
        diagnostics["xactimate_skipped"] = "pdfplumber_not_installed"
        return [], [], diagnostics

    all_raw: List[Dict[str, Any]] = []
    page_texts: List[str] = []
    current_room: Optional[str] = None
    room_buffer: List[str] = []
    next_item_room_meta: Optional[Dict[str, Any]] = None

    try:
        with pdfplumber.open(file_path) as pdf:
            for page_no, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                page_texts.append(text)
                words = page.extract_words() or []
                if not words:
                    continue

                lines = group_words_by_line(words, tolerance=3.0)
                lines.sort(
                    key=lambda lw: sum(float(w["top"]) for w in lw) / max(len(lw), 1)
                )

                col_positions: Optional[Dict[str, Tuple[float, float]]] = None
                header_y: Optional[float] = None
                in_table = False
                current_item: Optional[Dict[str, Any]] = None

                for line_words in lines:
                    lt = line_text(line_words)

                    if _is_table_header_line(line_words):
                        if current_item:
                            all_raw.append(current_item)
                            current_item = None
                        if room_buffer:
                            next_item_room_meta = parse_room_header("\n".join(room_buffer))
                        else:
                            next_item_room_meta = None
                        room_buffer = []
                        col_positions = find_header_columns(line_words, float(page.width))
                        header_y = min(float(w["top"]) for w in line_words)
                        in_table = True
                        continue

                    if not in_table or col_positions is None or header_y is None:
                        if ROOM_START_PATTERN.search(lt):
                            mrm = ROOM_START_PATTERN.search(lt)
                            if mrm:
                                current_room = mrm.group(1).strip()
                            room_buffer = [lt]
                        elif current_room:
                            room_buffer.append(lt)
                        continue

                    if float(line_words[0]["top"]) <= header_y + 2:
                        continue

                    if lt.strip().startswith("Totals:"):
                        if current_item:
                            all_raw.append(current_item)
                            current_item = None
                        continue

                    m = ITEM_START.match(lt.strip())
                    if m:
                        if current_item:
                            all_raw.append(current_item)
                        rm = next_item_room_meta
                        next_item_room_meta = None
                        current_item = {
                            "item_number": int(m.group(1)),
                            "description": "",
                            "quantity": None,
                            "unit": None,
                            "unit_price": None,
                            "tax": None,
                            "op": None,
                            "rcv": None,
                            "depreciation": None,
                            "acv": None,
                            "note": None,
                            "is_op_item": True,
                            "source_page": page_no,
                            "room": current_room,
                            "raw_line": lt.strip(),
                            "_room_meta": rm,
                        }
                        numeric_words = [
                            w
                            for w in line_words
                            if NUMERIC_TOKEN.match(w["text"].replace(",", ""))
                            or (
                                MONEYISH_TOKEN.match(w["text"])
                                and any(c.isdigit() for c in w["text"])
                            )
                        ]
                        if numeric_words:
                            current_item["description"] = _description_from_line_layout_a(
                                line_words, col_positions, m
                            )
                            extract_numeric_fields(current_item, line_words, col_positions)
                        else:
                            current_item["description"] = lt[m.end() :].strip()
                        _apply_non_op_description(current_item)
                        continue

                    if current_item is not None and current_item.get("quantity") is None:
                        numeric_words = [
                            w
                            for w in line_words
                            if NUMERIC_TOKEN.match(w["text"].replace(",", ""))
                            or (
                                MONEYISH_TOKEN.match(w["text"])
                                and any(c.isdigit() for c in w["text"])
                            )
                        ]
                        if len(numeric_words) >= 2:
                            extract_numeric_fields(current_item, line_words, col_positions)
                            _apply_non_op_description(current_item)
                        else:
                            current_item["description"] = (
                                current_item["description"] + " " + lt.strip()
                            ).strip()
                        continue

                    if current_item is not None and _is_note_line(lt, line_words):
                        current_item["note"] = lt.strip()
                        continue

                if current_item:
                    all_raw.append(current_item)

    except Exception as e:
        diagnostics["xactimate_error"] = str(e)
        return [], page_texts if page_texts else [], diagnostics

    filtered_raw: List[Dict[str, Any]] = []
    for d in all_raw:
        blob = " ".join(
            x for x in (d.get("description"), d.get("note"), d.get("raw_line")) if x
        )
        if line_looks_like_room_measurement_sketch_line(blob):
            continue
        filtered_raw.append(d)

    items = raw_dicts_to_dtos(filtered_raw)
    if not _xactimate_parse_trustworthy(items):
        if _looks_like_state_farm_packet(page_texts):
            diagnostics["xactimate_skipped"] = "quality_gate_state_farm_packet"
            diagnostics["xactimate_rejected_item_count"] = len(items)
            return [], page_texts, diagnostics
        # fallback: guide-based text parser (Layout A/B, item-number + data line pairing)
        text_raw = _parse_text_layout_items(page_texts)
        text_filtered: List[Dict[str, Any]] = []
        for d in text_raw:
            blob = " ".join(x for x in (d.get("description"), d.get("note"), d.get("raw_line")) if x)
            if line_looks_like_room_measurement_sketch_line(blob):
                continue
            text_filtered.append(d)
        items = raw_dicts_to_dtos(text_filtered)
        if not _xactimate_parse_trustworthy(items):
            diagnostics["xactimate_skipped"] = "quality_gate"
            diagnostics["xactimate_rejected_item_count"] = len(items)
            return [], page_texts, diagnostics
        diagnostics["strategy"] = "xactimate_text_layout"
    diagnostics["xactimate_item_count"] = len(items)
    return items, page_texts, diagnostics
