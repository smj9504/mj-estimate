"""
Read Xactimate "Price List Item Report" PDFs (Item Activity Information -> Preview)
into structured items.

A report looks like this (text as pdfplumber extracts it):

    Price List Item: CABAG & 11/8/2026
    Page: 1
    Description:
    Cabinetry - appliance garage
    Assembly Information:
    Type Component Cost Direct Yield SPT Event % Yield Unit Price
    RLB+ CARP-FNC 92.320 2.000 EA/HR 39.583 1.208 76.41
    MAT+ CABAG 147.231 1.000 EA/EA 0.000 1.000 147.23
    RLB- DMO 55.430 4.500 EA/HR 39.583 2.719 20.39
    Costs: Lab: 80.82 Mat: 147.23 Equ: 0.00 = 228.05
    Labor Burden: 15.98
    Market Conditions: 0.00
    Untaxed Unit Price: 244.03
    Definition:
    Includes: Factory built, ...
    Quality: Average grade ...
    Average life expectancy 50 years
    Average depreciation 2% per year
    Maximum depreciation 100%

Lines the parser doesn't recognise are kept in `unparsed` so new report
shapes show up instead of being dropped.

    python parse_reports.py <pdf_root> <out.jsonl>
"""

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import pdfplumber

HEADER = re.compile(r"^Price List Item:\s*(?P<code>.+?)\s+(?P<act>[+\-&A-Z]{1,2})\s+(?P<date>\d{1,2}/\d{1,2}/\d{4})\s*$")
NUM = r"-?[\d,]*\.?\d+"
COMPONENT = re.compile(
    rf"^(?P<kind>[A-Z]{{3}})(?P<act>[+\-])?\s+(?P<code>\S+)\s+(?P<cost>{NUM})\s+(?P<direct_yield>{NUM})\s+"
    rf"(?P<yield_unit>\S+/\S+)\s+(?P<spt>{NUM})\s+(?P<yield>{NUM})\s+(?P<unit_price>{NUM})$"
)
COSTS = re.compile(rf"^Costs:\s*Lab:\s*(?P<lab>{NUM})\s*Mat:\s*(?P<mat>{NUM})\s*Equ:\s*(?P<equ>{NUM})\s*=\s*(?P<total>{NUM})$")
MONEY_LINE = re.compile(rf"^(?P<label>Labor Burden|Market Conditions|Untaxed Unit Price):\s*(?P<value>{NUM})$")
DEFINITION_LABELS = ("Includes", "Excludes", "Quality", "Reference", "Green", "Notes", "Note")
DEFINITION_START = re.compile(r"^(?P<label>" + "|".join(DEFINITION_LABELS) + r"):\s*(?P<text>.*)$")
LIFE = re.compile(r"^Average life expectancy\s+(?P<years>\d+)\s+years?$", re.I)
DEPRECIATION = re.compile(rf"^Average depreciation\s+(?P<rate>{NUM})%\s+per year$", re.I)
MAX_DEPRECIATION = re.compile(rf"^Maximum depreciation\s+(?P<rate>{NUM})%$", re.I)
PAGE = re.compile(r"^Page:\s*\d+$")

KIND = {"RLB": "lab", "LAB": "lab", "MAT": "mat", "EQU": "equ", "EQP": "equ"}


def _num(s: Optional[str]) -> Optional[float]:
    if s is None:
        return None
    return float(s.replace(",", ""))


def parse_text(text: str) -> Dict[str, Any]:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    item: Dict[str, Any] = {
        "item_code": None, "activity": None, "report_date": None, "description": None,
        "components": [], "costs": {}, "definition": {}, "life": {}, "unparsed": [],
    }
    section = None
    current_label = None
    desc_lines: List[str] = []
    for i, line in enumerate(lines):
        if re.fullmatch(r"\d+", line) and (
                item["item_code"] is None or (i + 1 < len(lines) and HEADER.match(lines[i + 1]))):
            continue  # page number above the header (page 1, and again on every later page)
        if line == "No life expectancy data":
            continue
        m = HEADER.match(line)
        if m:
            item["item_code"], item["activity"], item["report_date"] = m["code"], m["act"], m["date"]
            continue
        if PAGE.match(line):
            continue
        if line == "Description:":
            section = "description"; continue
        if line == "Assembly Information:":
            section = "assembly"; continue
        if line == "Definition:":
            section = "definition"; current_label = None; continue
        if line.startswith("Type Component Cost"):
            continue
        m = COMPONENT.match(line)
        if m:
            item["components"].append({
                "type": m["kind"] + (m["act"] or ""),
                "component_type": KIND.get(m["kind"], m["kind"].lower()),
                "activity": m["act"],
                "component_code": m["code"],
                "cost": _num(m["cost"]),
                "direct_yield": _num(m["direct_yield"]),
                "yield_unit": m["yield_unit"],
                "spt_event_percent": _num(m["spt"]),
                "yield_value": _num(m["yield"]),
                "unit_price": _num(m["unit_price"]),
            })
            section = "assembly"
            continue
        if section == "assembly" and item["components"] and re.fullmatch(r"\S{1,4}", line):
            # Component codes longer than the column (DMOCHIPTRU|K, DRYCHAN>>2|0) wrap their
            # last characters onto a line of their own under the row.
            item["components"][-1]["component_code"] += line
            continue
        m = COSTS.match(line)
        if m:
            item["costs"].update(lab=_num(m["lab"]), mat=_num(m["mat"]), equ=_num(m["equ"]), subtotal=_num(m["total"]))
            section = "costs"; continue
        m = MONEY_LINE.match(line)
        if m:
            key = {"Labor Burden": "labor_burden", "Market Conditions": "market_conditions",
                   "Untaxed Unit Price": "untaxed_unit_price"}[m["label"]]
            item["costs"][key] = _num(m["value"])
            continue
        m = LIFE.match(line)
        if m:
            item["life"]["years"] = int(m["years"]); current_label = None; continue
        m = DEPRECIATION.match(line)
        if m:
            item["life"]["rate"] = _num(m["rate"]); current_label = None; continue
        m = MAX_DEPRECIATION.match(line)
        if m:
            item["life"]["max"] = _num(m["rate"]); current_label = None; continue
        if section == "description":
            desc_lines.append(line); continue
        if section == "definition":
            m = DEFINITION_START.match(line)
            if m:
                current_label = m["label"].lower()
                if current_label == "note":
                    current_label = "notes"
                item["definition"][current_label] = m["text"]
                continue
            if current_label:
                item["definition"][current_label] = (item["definition"][current_label] + " " + line).strip()
                continue
        item["unparsed"].append(line)
    item["description"] = " ".join(desc_lines) or None
    item["checks"] = check(item)
    return item


def check(item: Dict[str, Any]) -> List[str]:
    """Arithmetic the report itself promises; anything off means a misread."""
    problems = []
    c = item["costs"]
    if not item["item_code"]:
        problems.append("no header")
    if "untaxed_unit_price" not in c:
        problems.append("no unit price")
    if {"lab", "mat", "equ", "subtotal"} <= c.keys() and abs(c["lab"] + c["mat"] + c["equ"] - c["subtotal"]) > 0.015:
        problems.append("lab+mat+equ != subtotal")
    if {"subtotal", "labor_burden", "market_conditions", "untaxed_unit_price"} <= c.keys():
        total = c["subtotal"] + c["labor_burden"] + c["market_conditions"]
        if abs(total - c["untaxed_unit_price"]) > 0.015:
            problems.append("subtotal+burden+market != unit price")
    if item["components"] and "untaxed_unit_price" in c:
        comp_total = sum(x["unit_price"] or 0 for x in item["components"])
        if abs(comp_total + (c.get("market_conditions") or 0) - c["untaxed_unit_price"]) > 0.02 * max(len(item["components"]), 1):
            problems.append(f"components {comp_total:.2f} != unit price")
    return problems


def parse_pdf(path: Path) -> Dict[str, Any]:
    with pdfplumber.open(str(path)) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    item = parse_text(text)
    item["pages"] = text.count("Page:") or 1
    return item


def main(root: str, out: str) -> None:
    root_path = Path(root)
    n = bad = 0
    with open(out, "w", encoding="utf-8") as f:
        for pdf in sorted(root_path.rglob("*.pdf")):
            try:
                item = parse_pdf(pdf)
            except Exception as e:  # a damaged file shouldn't stop the batch
                item = {"error": str(e)}
            item["category"] = pdf.parent.name.rstrip("_")  # CON_ -> CON (reserved name on Windows)
            item["file"] = str(pdf.relative_to(root_path))
            if item.get("error") or item.get("checks") or item.get("unparsed"):
                bad += 1
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
            n += 1
    print(f"{n} reports, {bad} with problems or unparsed lines")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
