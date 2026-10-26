"""
The totals a carrier prints at the end of its estimate: RCV, depreciation,
ACV, deductible and net claim, one section per coverage.

Xactimate prints a "Summary for <coverage>" block per coverage (Dwelling,
Code Upgrade, ...). Liberty Mutual / Safeco and Allstate's payment worksheet
print one claim-totals block instead ("Replacement cost value: $X",
"Replacement Cost.......$X"), which becomes a single section.

Amounts come from these blocks only, never from the line-item tables: a
"Line Item Totals:" row puts RCV in a different column from one layout to
the next.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

# Travelers and State Farm add a "how to read your estimate" page whose
# worked example would otherwise be read as the claim's own amounts. It
# defines the terms ("Replacement Cost Value (RCV) – The estimated cost...")
_GUIDE_PAGE = re.compile(
    r"GUIDE_EXAMPLE|Replacement\s+Cost\s+Value\s*\(RCV\)\s*[–—-]",
    re.IGNORECASE,
)

# 1,234.56 | $1,234.56 | (1,234.56) | $(1,234.56) | -$1,234.56 | <1,234.56>
# Only a leading minus is kept as a sign: brackets just mark what a "Less"
# label already subtracts
_MONEY = r"(-?)\s*\$?\s*[(<]?\s*\$?\s*([\d,]+\.\d{2})\s*[)>]?"
# Between a label and its amount: an aside such as "($1,000.00)" or
# "[Full Deductible = 1,000.00]", dot leaders, a colon
_GAP = r"(?:\s*(?:\([^)]*\)|\[[^\]]*\]))?[\s.:]*"
# A label starts the line or follows the previous amount (a payment worksheet
# puts several label/amount pairs on one line), never mid-phrase, so
# "Net Actual Cash Value" is not read as "Actual Cash Value"
_START = r"(?:^|(?<=[\d)>]\s))"


def _labels(*patterns: str) -> re.Pattern:
    return re.compile(
        _START + r"(?:" + "|".join(patterns) + r")" + _GAP + _MONEY,
        re.IGNORECASE,
    )


_FIELDS: Dict[str, re.Pattern] = {
    "line_item_total": _labels(r"Line\s+Item\s+Totals?"),
    "material_sales_tax": _labels(r"Material\s+Sales\s+Tax"),
    "subtotal": _labels(r"Subtotal"),
    "overhead_amount": _labels(r"(?:General\s+Contractor\s+)?Overhead"),
    "profit_amount": _labels(r"(?:General\s+Contractor\s+)?Profit"),
    "rcv": _labels(r"Replacement\s+Cost(?:\s+Value)?"),
    "depreciation": _labels(r"Less\s+Depreciation"),
    "split_depreciation": _labels(
        r"Less\s+(?:Recoverable|Non\s*-?\s*recoverable)\s+Depreciation"
    ),
    "total_depreciation": _labels(r"Total\s+Depreciation"),
    "acv": _labels(r"Actual\s+Cash\s+Value(?:\s*\(ACV\))?(?:\s+Subtotal)?"),
    # Liberty Mutual: ACV per coverage, before the deductible
    "coverage_acv": _labels(r"Net\s+Actual\s+Cash\s+Value\s+on\s+Coverage\s+\w+"),
    # Part of the RCV paid only once the work is done (Code Upgrade), so not ACV
    "when_incurred": _labels(
        r"Total\s+Paid\s+When\s+Incurred",
        r"Less\s+costs\s+payable\s+when\s+incurred",
    ),
    # The deductible applied, not the policy's "Deductible: $1,000.00" that
    # page headers repeat
    "deductible": _labels(
        r"Less\s+Deductible",
        r"Applied\s+Deductible",
        r"(?:Coverage\s+\w+\s+)?Deductible\s*\([^)]*\)(?:\s+applied)?",
    ),
    "net_claim": _labels(
        r"Net\s+Claim(?:\s+Remaining)?",
        r"Net\s+Actual\s+Cash\s+Value(?:\s+Payment)?",
        r"Net\s+Actual\s+Cash\s+Value\s+on\s+Coverage\s+\w+\s+after\s+Deductible",
        r"Net\s+Estimate",
    ),
}

_SUMMARY_FOR = re.compile(r"^Summary\s+for\b\s*(.*)$", re.IGNORECASE)
# Sub-heading Travelers puts under the coverage name, not a coverage itself
_ALL_ITEMS = {"all items", "all coverages"}
# Recap tables follow the summaries and carry Subtotal / O&P lines of their own
_BLOCK_END = re.compile(r"\bRecap\b|^Grand\s+Total\s+Areas", re.IGNORECASE)

_SCORED = (
    "rcv", "depreciation", "split_depreciation", "acv", "coverage_acv",
    "deductible", "net_claim",
)


def _find(line: str) -> Dict[str, List[float]]:
    found: Dict[str, List[float]] = {}
    for field, pat in _FIELDS.items():
        for m in pat.finditer(line):
            amount = float(m.group(2).replace(",", ""))
            found.setdefault(field, []).append(-amount if m.group(1) else amount)
    return found


def _section(name: str, values: Dict[str, List[float]]) -> Optional[dict]:
    """One coverage's amounts from every label value found in its block."""
    # A Code Upgrade block prints the ACV part ($0.00) before the part paid
    # when incurred, which carries the coverage's RCV. A block with no
    # positive RCV is a credit (State Farm: "Replacement Cost Value -6,642.28"
    # for mitigation already paid) or empty, not a coverage to add up.
    rcv = max(values.get("rcv") or [0.0])
    if rcv <= 0:
        return None

    def first(field: str) -> float:
        return abs(values[field][0]) if values.get(field) else 0.0

    def total(field: str) -> float:
        return sum(abs(v) for v in values.get(field) or [])

    if values.get("depreciation"):
        # A block that prints the whole may list its non-recoverable part
        # again further down
        depreciation = first("depreciation")
    elif values.get("split_depreciation"):
        # Recoverable and non-recoverable on separate lines, no whole
        depreciation = total("split_depreciation")
    else:
        depreciation = first("total_depreciation")
    if values.get("acv"):
        acv = first("acv")
    elif values.get("coverage_acv"):
        acv = total("coverage_acv")
    else:
        # Not from Net Claim: that is also net of the deductible and of any
        # prior payment
        acv = rcv - depreciation - first("when_incurred")
    return {
        "section_name": name,
        "line_item_total": max(abs(v) for v in values.get("line_item_total") or [0.0]),
        "material_sales_tax": first("material_sales_tax"),
        "subtotal": first("subtotal"),
        "overhead_amount": first("overhead_amount"),
        "profit_amount": first("profit_amount"),
        "rcv": round(rcv, 2),
        "depreciation": round(depreciation, 2),
        "deductible": first("deductible"),
        "net_acv": round(acv, 2),
        "net_claim": first("net_claim"),
    }


def _summary_for_blocks(lines: List[str]) -> List[dict]:
    """Xactimate: one section per "Summary for <coverage>" block."""
    blocks: List[dict] = []
    current: Optional[dict] = None
    i = 0
    while i < len(lines):
        line = lines[i]
        header = _SUMMARY_FOR.match(line)
        if header:
            name = header.group(1).strip()
            if not name and i + 1 < len(lines):
                # Travelers puts the coverage name on the next line
                nxt = lines[i + 1]
                if not _SUMMARY_FOR.match(nxt) and not _find(nxt):
                    name = nxt
                    i += 1
            if name.lower() in _ALL_ITEMS and current is not None and not current["values"]:
                current["name"] = current["name"] or name
            else:
                current = {"name": name, "values": {}}
                blocks.append(current)
        elif current is not None:
            if _BLOCK_END.search(line):
                current = None
            else:
                for field, vals in _find(line).items():
                    current["values"].setdefault(field, []).extend(vals)
        i += 1

    sections = []
    seen = set()
    for block in blocks:
        sec = _section(block["name"] or "All Items", block["values"])
        if sec and (sec["section_name"], sec["rcv"]) not in seen:
            seen.add((sec["section_name"], sec["rcv"]))
            sections.append(sec)
    return sections


def _claim_totals_page(pages: List[List[str]]) -> List[dict]:
    """Single claim-totals block: the page that reads as the most complete
    summary, the later one on a tie (totals come last)."""
    best, best_score = None, 0
    for lines in pages:
        values: Dict[str, List[float]] = {}
        for line in lines:
            for field, vals in _find(line).items():
                values.setdefault(field, []).extend(vals)
        if not values.get("rcv"):
            continue
        score = sum(1 for f in _SCORED if values.get(f))
        if score >= best_score:
            best, best_score = values, score
    # RCV alone is too thin to tell a summary from a stray table cell
    if best is None or best_score < 2:
        return []
    sec = _section("All Items", best)
    return [sec] if sec else []


def parse_estimate_summary(page_texts: List[str]) -> dict:
    """Sections and their totals from an estimate's extracted page texts.

    Returns {"sections": [...], "totals": {...}}; no sections when no
    summary was found.
    """
    pages = [
        [ln.strip() for ln in (text or "").split("\n") if ln.strip()]
        for text in page_texts
        if not _GUIDE_PAGE.search(text or "")
    ]
    sections = _summary_for_blocks([ln for page in pages for ln in page])
    if not sections:
        sections = _claim_totals_page(pages)

    def total(field: str) -> float:
        return round(sum(sec[field] for sec in sections), 2)

    # Sections are saved as they are (NegotiationSectionData), which has no
    # net claim
    net_claim = round(sum(sec.pop("net_claim") for sec in sections), 2)
    return {
        "sections": sections,
        "totals": {
            "rcv_amount": total("rcv"),
            "acv_amount": total("net_acv"),
            "depreciation_amount": total("depreciation"),
            "deductible": total("deductible"),
            "net_claim": net_claim,
        },
    }
