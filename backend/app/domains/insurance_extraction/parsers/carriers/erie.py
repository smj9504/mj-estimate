"""Erie Insurance estimate parser.

Erie Insurance PDFs use a Xactimate-like structure but with a distinct column layout:
  Description | Quantity | Unit Price | Per | Total Cost

Room sections include dimension tables:
  Length: 9'7"   Width: 17'8"   Height: 8' Flat
  Walls: 436.00 SF  Walls-subs: 436.00 SF  ...

Line items are numbered without a period:
  3 Drywall/Plaster Ceiling - Paint, 2 Coats   169.31   $1.64  SF   $277.67
"""

import re
from decimal import Decimal
from typing import List, Optional

from app.domains.insurance_extraction.interfaces import ParsedItemDTO
from app.domains.insurance_extraction.parsers.base_parser import BaseInsuranceParser

# Erie room header: room name line like "Kitchen" or "Dining Room" or "Bathroom"
_ERIE_ROOM_HEADER = re.compile(
    r"^\s*(?:\u2507\s*)?([A-Za-z][A-Za-z /\-\']+(?:\(con\'?t\))?)\s*$"
)

# Erie dimension table lines
_ERIE_DIM_LINE = re.compile(
    r"^\s*(?:Length|Width|Height|Walls|Walls-subs|Walls-subs-cas-bsbd|"
    r"Doors|Windows|Openings|Missing\s+Walls|Floor|Ceiling|"
    r"Perim\s*\(F\)|Perim\s*\(C\)|Steps|Rise/run|Step\s+surface)\s*:",
    re.IGNORECASE,
)

# Erie column header
_ERIE_HEADER = re.compile(
    r"Description\s+Quantity\s+Unit\s+Price\s+Per\s+Total\s+Cost",
    re.IGNORECASE,
)

# Erie line item: number + description + quantity + unit_price + unit + total_cost
# Example: "3 Drywall/Plaster Ceiling - Paint, 2 Coats 169.31 $1.64 SF $277.67"
# Some items have parenthetical alternate qty: "4 Base Shoe... 54.50 (57.77) $3.56 LF $198.21"
_ERIE_LINE_ITEM = re.compile(
    r"^\s*(\d{1,4})\s+"                           # item number
    r"(.+?)\s+"                                     # description (non-greedy)
    r"([\d,]+\.?\d*)"                               # quantity
    r"(?:\s*\([\d,]+\.?\d*\))?\s+"                  # optional parenthetical qty
    r"\$?([\d,]+\.?\d*)\s+"                         # unit price
    r"(SF|LF|EA|SY|CF|HR|DAY|MO|RM|LS|SQ)\s+"      # unit
    r"\$?([\d,]+\.?\d*)\s*$",                       # total cost
    re.IGNORECASE,
)

# Subtotal line: "Kitchen - Subtotal (8 items)   $2,276.57"
_ERIE_SUBTOTAL = re.compile(
    r"(?:Subtotal|Sub-total)\s*(?:\(\d+\s+items?\))?\s+\$?([\d,]+\.?\d*)",
    re.IGNORECASE,
)

# Summary lines on last page
_ERIE_SUMMARY_PATTERNS = {
    "total_materials": re.compile(r"Total\s+Materials?:\s+\$?([\d,]+\.?\d*)", re.IGNORECASE),
    "total_labor": re.compile(r"Total\s+Labor:\s+\$?([\d,]+\.?\d*)", re.IGNORECASE),
    "total_equipment": re.compile(r"Total\s+Equipment:\s+\$?([\d,]+\.?\d*)", re.IGNORECASE),
    "subtotal": re.compile(r"^\s*Subtotal:\s+\$?([\d,]+\.?\d*)", re.IGNORECASE),
    "sales_tax": re.compile(r"Sales\s+Tax.*?:\s+\$?([\d,]+\.?\d*)", re.IGNORECASE),
    "overhead": re.compile(r"(?:Add\s+)?(\d+(?:\.\d+)?)\s*%?\s*overhead.*?\$?([\d,]+\.?\d*)", re.IGNORECASE),
    "profit": re.compile(r"(?:Add\s+)?(\d+(?:\.\d+)?)\s*%?\s*profit.*?\$?([\d,]+\.?\d*)", re.IGNORECASE),
    "estimate_subtotal": re.compile(r"Estimate\s+Subtotal:\s+\$?([\d,]+\.?\d*)", re.IGNORECASE),
    "deductible": re.compile(r"Deductible.*?:\s+\$?\(?([\d,]+\.?\d*)\)?", re.IGNORECASE),
    "estimate_total": re.compile(r"Estimate\s+Total:\s+\$?([\d,]+\.?\d*)", re.IGNORECASE),
}

# Section headers that are NOT rooms
_NON_ROOM_SECTIONS = re.compile(
    r"^\s*(?:FLOORPLAN|Floorplan|"
    r"ESTIMATE|Approved|Completed|Finalization|"
    r"Description|Claim\s+#|Page\s+\d+)",
    re.IGNORECASE,
)

# Known room names for Erie
_ERIE_KNOWN_ROOMS = {
    "kitchen", "dining room", "living room", "bathroom", "bedroom",
    "master bedroom", "master bathroom", "hallway", "stairway", "stairs",
    "basement", "laundry room", "laundry", "garage", "foyer", "entry",
    "den", "office", "family room", "utility room", "closet",
    "walk-in closet", "pantry", "porch", "deck", "attic",
    "general items", "exterior",
    "minimum charge adjustments",
}


def _safe_decimal(value: str) -> Optional[Decimal]:
    try:
        return Decimal(value.replace(",", "").replace("$", "").strip())
    except Exception:
        return None


def _is_erie_room_header(line: str) -> Optional[str]:
    """Check if line is an Erie room header and return room name."""
    stripped = line.strip()
    if not stripped or len(stripped) < 3:
        return None
    if _NON_ROOM_SECTIONS.match(stripped):
        return None
    if _ERIE_DIM_LINE.match(stripped):
        return None
    if _ERIE_HEADER.search(stripped):
        return None
    if _ERIE_LINE_ITEM.match(stripped):
        return None
    if _ERIE_SUBTOTAL.search(stripped):
        return None
    if re.match(r"^\s*\d+\s+", stripped) and re.search(r"\$[\d,]+\.\d+", stripped):
        return None
    if re.match(r"^\s*(?:Erie|Claim|Page|Date|Total|Add|Sales|Net|Deductible|Estimate)", stripped, re.IGNORECASE):
        return None

    m = _ERIE_ROOM_HEADER.match(stripped)
    if m:
        candidate = m.group(1).strip()
        # Check against known rooms
        if candidate.lower().rstrip("(con't)").strip() in _ERIE_KNOWN_ROOMS:
            return candidate
        # Also accept if followed by dimension lines (checked by caller)
        if len(candidate) > 2 and candidate[0].isupper():
            return candidate
    return None


class ErieInsuranceParser(BaseInsuranceParser):
    """Parser for Erie Insurance estimate PDFs."""

    def parse_pages(self, pages: List[str], carrier: Optional[str] = None) -> List[ParsedItemDTO]:
        current_room: Optional[str] = None
        extracted: List[ParsedItemDTO] = []
        item_counter = 0

        for page_index, page_text in enumerate(pages, start=1):
            lines = [
                re.sub(r"\s+", " ", raw).strip()
                for raw in page_text.splitlines()
                if raw.strip()
            ]

            i = 0
            while i < len(lines):
                line = lines[i]

                # Skip header/footer lines
                if _ERIE_HEADER.search(line):
                    i += 1
                    continue
                if re.match(r"^\s*ESTIMATE:", line, re.IGNORECASE):
                    i += 1
                    continue
                if re.match(
                    r"^\s*(Approved|Completed)\s*$",
                    line, re.IGNORECASE,
                ):
                    i += 1
                    continue
                if re.match(r"^\s*Claim\s+", line, re.IGNORECASE):
                    i += 1
                    continue
                if re.match(r"^\s*Erie\s+Insurance", line, re.IGNORECASE):
                    i += 1
                    continue
                if re.match(r"^\s*\d+\s+Erie\s+Insurance", line, re.IGNORECASE):
                    i += 1
                    continue
                if re.match(r"^\s*Page\s+\d+\s+of\s+\d+", line, re.IGNORECASE):
                    i += 1
                    continue

                # Skip dimension lines
                if _ERIE_DIM_LINE.match(line):
                    i += 1
                    continue

                # Skip subtotal lines
                if _ERIE_SUBTOTAL.search(line):
                    i += 1
                    continue

                # Skip summary section lines
                if any(p.search(line) for p in _ERIE_SUMMARY_PATTERNS.values()):
                    i += 1
                    continue

                # Check for room header
                room_name = _is_erie_room_header(line)
                if room_name:
                    # Verify by lookahead or known room name
                    looks_like_room = False
                    for j in range(i + 1, min(i + 5, len(lines))):
                        if _ERIE_DIM_LINE.match(lines[j]):
                            looks_like_room = True
                            break
                        if _ERIE_HEADER.search(lines[j]):
                            looks_like_room = True
                            break
                        if _ERIE_LINE_ITEM.match(lines[j]):
                            looks_like_room = True
                            break
                    clean_name = (
                        room_name.lower()
                        .replace("(con't)", "").strip()
                    )
                    if looks_like_room or clean_name in _ERIE_KNOWN_ROOMS:
                        current_room = room_name.replace("(con't)", "").strip()
                        i += 1
                        continue

                # Try to parse line item
                m = _ERIE_LINE_ITEM.match(line)
                if m:
                    item_counter += 1
                    item_number = int(m.group(1))
                    description = m.group(2).strip()
                    quantity = _safe_decimal(m.group(3))
                    unit_price = _safe_decimal(m.group(4))
                    unit = m.group(5).upper()
                    total_cost = _safe_decimal(m.group(6))

                    if unit_price and unit_price > 0:
                        dto = ParsedItemDTO(
                            line_item=description[:2000],
                            room=current_room,
                            unit_price=unit_price,
                            quantity=quantity,
                            measurement=f"{m.group(3)} {unit}" if quantity else None,
                            unit=unit,
                            source_page=page_index,
                            confidence=Decimal("0.90"),
                            raw_line=line[:2000],
                            token_offsets={
                                "erie": {
                                    "item_number": item_number,
                                    "total_cost": float(total_cost) if total_cost else None,
                                }
                            },
                            validation_flags=[],
                            item_number=item_number,
                            rcv=total_cost,
                        )

                        # Collect notes (Operation & Price Source lines)
                        notes_parts: List[str] = []
                        j = i + 1
                        while j < len(lines):
                            next_line = lines[j]
                            if _ERIE_LINE_ITEM.match(next_line):
                                break
                            if _is_erie_room_header(next_line):
                                break
                            if _ERIE_SUBTOTAL.search(next_line):
                                break
                            if _ERIE_DIM_LINE.match(next_line):
                                break
                            if re.match(r"^\s*Operation\s+&\s+Price\s+Source:", next_line, re.IGNORECASE):
                                notes_parts.append(next_line.strip())
                                j += 1
                                continue
                            if notes_parts and re.match(r"^\s*(Total|Date):", next_line, re.IGNORECASE):
                                notes_parts.append(next_line.strip())
                                j += 1
                                continue
                            break

                        if notes_parts:
                            dto.notes = "\n".join(notes_parts)
                            i = j
                        else:
                            i += 1

                        extracted.append(dto)
                        continue

                i += 1

        return extracted
