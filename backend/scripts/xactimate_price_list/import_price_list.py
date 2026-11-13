"""
Load a price list read out of Xactimate into xactimate_categories /
xactimate_items / xactimate_components.

Inputs (from the scrape, see README.md):
  <dir>/categories.tsv        code <TAB> name                         (P.L. Categories list)
  <dir>/catalog/<CAT>.tsv     sel, description, unit, act, price, green  (Selectors list)
  <dir>/parsed.jsonl          one parsed Price List Item Report per line (parse_reports.py)
  <dir>/split_prices.tsv      optional: cat, sel, ok, replace, remove as Xactimate shows them
                              (split_prices.ps1), for & items whose market conditions the
                              report gives only as one total
  <dir>/details.jsonl         optional: what details.ps1 read from the Item Activity
                              Information windows (phase, market conditions per activity,
                              minimum group, component descriptions and supporting events)
  <dir>/details_event_texts.tsv  optional: supporting event code <TAB> its text
  <dir>/details_events.tsv    optional: cat, side, component, SPT %, event - each component's
                              event as details.ps1 settled it; fills a row it missed
  <dir>/details_events_fixed.tsv  optional: cat, side, component, SPT %, event, selector, note -
                              codes read by eye from pictures (selector: that item only); these win
  <dir>/details_event_renames.tsv optional: misread code, code, note - OCR misreads renamed
                              everywhere (EventCodes says how these fit together)
  <dir>/rmi_index.tsv        optional: what rmi.ps1 read from Quick Entry: cat, sel, the
                              R / M / I activities offered (RMI, MI, ...), the R, M and I
                              prices, status (the last read of an item that didn't fail wins)
  <dir>/parsed_rmi.jsonl      optional: the Detach & Reset reports (pdf_rmi) parsed by
                              parse_reports.py; their components go in with activity "R"
  <dir>/labor_trades.tsv      optional: each labor trade's hourly rate split into wage,
                              burden and overhead (trades.ps1) -> xactimate_labor_rates

Every selector in the catalog becomes an item, item_code = category + selector
(CAB + AG- -> CABAG-), the same code the report and the rest of the app use.
Where its report parsed cleanly the item gets the cost split, components,
definition and life expectancy; otherwise only the catalog's price and
description, and it is listed in the summary. An & (remove and replace)
item's price is also split into replace_price and remove_price.

The price month comes from the price list name (VAAR8X_NOV26 -> 2026-11).
Rows of the same price month and category are replaced, so a re-run is safe.

    python import_price_list.py <dir> --price-list VAAR8X_NOV26 [--database-url URL] [--commit]

Without --commit nothing is written.
"""

import argparse
import difflib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import sqlalchemy as sa

MONTHS = {m: i for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], start=1)}


def price_month(price_list: str) -> Tuple[int, int]:
    m = re.search(r"_([A-Z]{3})(\d{2})$", price_list.upper())
    if not m or m[1] not in MONTHS:
        raise SystemExit(f"Can't tell the month from price list name {price_list!r} (expected ..._NOV26)")
    return 2000 + int(m[2]), MONTHS[m[1]]


def money(s: str) -> Optional[Decimal]:
    s = (s or "").strip().replace("$", "").replace(",", "")
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = Decimal(s)
    except Exception:
        return None
    return -v if neg else v


def read_tsv(path: Path) -> List[List[str]]:
    rows = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if line.strip() and line.strip() != "<<empty>>":
            rows.append([c.strip() for c in line.split("\t")])
    return rows


def dec(v, places: int) -> Optional[Decimal]:
    if v is None:
        return None
    return Decimal(str(v)).quantize(Decimal(1).scaleb(-places))


def split_prices(activity: Optional[str], unit_price: Optional[Decimal],
                 components: List[dict]) -> Tuple[Optional[Decimal], Optional[Decimal]]:
    """(replace, remove) price of one item.

    A + item is all replace and a - item all remove. An & item's report lists
    its replace (+) and remove (-) components together; Xactimate prices "-"
    on its own as the remove components and "+" as the rest of the & price
    (checked against Xactimate's own Replace/Remove Price on 15 items). The
    report gives market conditions only as one total, though Xactimate puts
    them on either side or both (DRY 1/2: remove, CAB D+++: replace), so for
    those items the split read from Xactimate (split_prices.tsv) wins; this
    fallback puts them on replace.
    """
    if unit_price is None:
        return None, None
    if activity == "+":
        return unit_price, None
    if activity == "-":
        return None, unit_price
    if activity == "&" and components:
        remove = sum((Decimal(str(c["unit_price"] or 0)) for c in components if c.get("activity") == "-"),
                     Decimal("0")).quantize(Decimal("0.01"))
        return unit_price - remove, remove
    return None, None


def canonical_phases(phases: Counter, min_count: int = 3) -> Dict[str, str]:
    """Map each phase as read to how it is usually read.

    Phases are read off the screen (OCR); a rare spelling close to a common
    one (06 Finish Carpentrv) is taken as that common one.
    """
    common = [p for p, n in phases.most_common() if n >= min_count]
    out = {}
    for p in phases:
        if p in common or not common:
            out[p] = p
            continue
        best = max(common, key=lambda c: difflib.SequenceMatcher(None, p, c).ratio())
        out[p] = best if difflib.SequenceMatcher(None, p, best).ratio() >= 0.85 else p
    return out


def read_details(dir_: Path):
    """details.jsonl (the last read of each item wins) and the event texts."""
    details: Dict[str, dict] = {}
    f = dir_ / "details.jsonl"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                details[r["item_code"]] = r
    events: Dict[str, str] = {}
    t = dir_ / "details_event_texts.tsv"
    if t.exists():
        for line in t.read_text(encoding="utf-8-sig").splitlines():
            code, _, text = line.partition("\t")
            if code.strip() and text.strip():
                events[code.strip()] = text.strip()
    return details, events


EventKey = Tuple[str, str, str, str]   # category, side (+/-), component code, SPT % ("10.000")


def event_key(cat: str, act: str, comp: dict) -> Optional[EventKey]:
    spt = comp.get("spt_event_percent")
    if spt is None or Decimal(str(spt)) == 0:
        return None
    return cat, act, comp.get("component_code") or "", f"{Decimal(str(spt)):.3f}"


class EventCodes:
    """Each component's supporting event, beyond what details.ps1 put on the row.

    details_events.tsv (cat, side, component, SPT %, event) is what details.ps1 settled per key,
    reading a key once and reusing it; it fills a row of an item read before the key was learned.
    Reading the code box by eye from pictures of the window showed two ways that goes wrong:

    - Windows OCR settles on a misread code (RMSH for FRMSH, FNCIX-3 for FNC1X-3: a dropped first
      letter, 1 read as I). details_event_renames.tsv (misread code, code, note) renames it
      everywhere; its text was read from the same window, so it goes with the right code.
    - A key isn't always one event: FRM's FRMSHW3/4T at 10 % is FRMSH in sheathing items and FRMUL
      in underlayment ones; a trade's labor event differs between items of mixed categories (EQA).
      details_events_fixed.tsv (cat, side, component, SPT %, event, selector, note) holds codes read
      by eye: with a selector for that item only, without for every item of the category.

    A row's event: the item's fix, else the key's fix, else what details.ps1 settled for the key,
    else the row's own read; then renamed."""

    def __init__(self, dir_: Optional[Path] = None):
        self.known: Dict[EventKey, str] = {}
        self.fixed: Dict[EventKey, str] = {}
        self.item_fixed: Dict[Tuple[str, str, str, str], str] = {}   # item code, side, component, SPT %
        self.renames: Dict[str, str] = {}
        if dir_ is None:
            return
        spt = lambda s: f"{Decimal(s):.3f}" if re.fullmatch(r"\d+(\.\d+)?", s) else None
        f = dir_ / "details_events.tsv"
        if f.exists():
            for row in read_tsv(f):
                if len(row) >= 5 and row[4] and spt(row[3]):
                    self.known[(row[0], row[1], row[2], spt(row[3]))] = row[4]
        f = dir_ / "details_events_fixed.tsv"
        if f.exists():
            for row in read_tsv(f):
                row += [""] * (6 - len(row))
                if row[4] and spt(row[3]):
                    if row[5]:
                        self.item_fixed[(row[0] + row[5], row[1], row[2], spt(row[3]))] = row[4]
                    else:
                        self.fixed[(row[0], row[1], row[2], spt(row[3]))] = row[4]
        f = dir_ / "details_event_renames.tsv"
        if f.exists():
            for row in read_tsv(f):
                if len(row) >= 2 and row[0] and row[1]:
                    self.renames[row[0]] = row[1]

    def event(self, item_code: str, key: Optional[EventKey], own: str) -> str:
        ev = own
        if key:
            ev = (self.item_fixed.get((item_code, *key[1:])) or self.fixed.get(key)
                  or self.known.get(key) or own)
        return self.renames.get(ev, ev)

    def texts(self, texts: Dict[str, str], items: List[dict]) -> Dict[str, Optional[str]]:
        """The supporting event texts to store: a renamed code's text goes with the right code
        (when that one has none of its own), and a misread code no component uses maps to None
        (deleted from xactimate_supporting_events)."""
        out: Dict[str, Optional[str]] = dict(texts)
        used = {c["supporting_event"] for it in items for c in it["components"] if c.get("supporting_event")}
        for old, new in self.renames.items():
            if new not in out and old in texts:
                out[new] = texts[old]
        for old in self.renames:
            if old not in used:
                out[old] = None
        return out


def apply_details(item: dict, det: dict, phase_of: Dict[str, str],
                  events: Optional[EventCodes] = None) -> List[str]:
    """Put what details.ps1 read onto the item and its components; returns problems."""
    problems = []
    events = events or EventCodes()
    item["minimum_group"] = (det.get("minimum_group") or "")[:20] or None
    for side in det.get("sides") or []:
        act = "+" if side.get("side") == "replace" else "-"
        key = "replace" if act == "+" else "remove"
        phase = side.get("phase")
        item[f"{key}_phase"] = phase_of.get(phase, phase)[:60] if phase else None
        mc = side.get("market_conditions")
        item[f"{key}_market_conditions"] = dec(mc, 2) if mc is not None else None
        comps = [c for c in item["components"] if c["activity"] == act]
        rows = side.get("components") or []
        if len(rows) != len(comps):
            problems.append(f"{key}: {len(rows)} rows read, report has {len(comps)}")
            continue
        for c, r in zip(comps, rows):
            if (r.get("code") or "")[:50] != (c["component_code"] or ""):
                problems.append(f"{key}: row {r.get('code')} vs component {c['component_code']}")
                continue
            c["description"] = r.get("description") or None
            ev = events.event(item["item_code"], event_key(item["category_code"], act, c), r.get("event") or "")
            c["supporting_event"] = ev[:30] or None
    return problems


def component_row(x: dict) -> dict:
    """A parsed report's component as an xactimate_components row."""
    return {
        "component_type": x["component_type"], "activity": x["activity"],
        "component_code": (x["component_code"] or "")[:50] or None,
        "cost": dec(x["cost"], 3), "direct_yield": dec(x["direct_yield"], 3),
        "yield_unit": (x["yield_unit"] or "")[:20] or None,
        "spt_event_percent": dec(x["spt_event_percent"], 3), "yield_value": dec(x["yield_value"], 3),
        "unit_price": dec(x["unit_price"], 2),
        "description": None, "supporting_event": None,
    }


# R / M / I: the activities Quick Entry offers besides the item's own, and their columns
OTHER_ACTIVITY_PRICES = {"R": "detach_reset_price", "M": "material_only_price", "I": "install_only_price"}


def read_rmi(dir_: Path):
    """rmi_index.tsv (the last read of each item that didn't fail) and the R reports."""
    reads: Dict[str, dict] = {}
    f = dir_ / "rmi_index.tsv"
    if f.exists():
        for line in f.read_text(encoding="utf-8-sig").splitlines():
            row = [c.strip() for c in line.split("\t")]
            if len(row) < 7 or row[6].startswith("error"):
                continue
            reads[row[0] + row[1]] = {"avail": row[2], "R": money(row[3]), "M": money(row[4]),
                                      "I": money(row[5]), "status": row[6]}
    reports: Dict[str, dict] = {}
    p = dir_ / "parsed_rmi.jsonl"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                if r.get("item_code") and r.get("activity") == "R":
                    reports[r["item_code"]] = r
    return reads, reports


def apply_rmi(item: dict, read: dict, report: Optional[dict]) -> List[str]:
    """Put an item's R / M / I prices on it, and its Detach & Reset components; returns problems."""
    problems = []
    avail = "".join(a for a in "RMI" if a in read["avail"])
    item["other_activities"] = avail
    for act, col in OTHER_ACTIVITY_PRICES.items():
        item[col] = read[act] if act in avail else None
        if act in avail and read[act] is None:
            problems.append(f"{act} offered but its price wasn't read")
    if "R" in avail:
        if report is None:
            problems.append("no Detach & Reset report")
        elif report.get("checks"):
            problems.append(f"Detach & Reset report checks {report['checks']}")
        elif read["R"] is not None and abs(Decimal(str(report["costs"]["untaxed_unit_price"])) - read["R"]) > Decimal("0.011"):
            problems.append(f"Detach & Reset {read['R']} vs report {report['costs']['untaxed_unit_price']}")
        else:
            item["components"] = item["components"] + [component_row(x) for x in report["components"]]
    if read["status"] != "ok":
        problems.append(read["status"])
    return problems


def read_labor_rates(dir_: Path, price_list: str) -> Tuple[List[dict], List[str]]:
    """labor_trades.tsv -> one xactimate_labor_rates row per trade, named the way
    the details windows name its labor components."""
    f = dir_ / "labor_trades.tsv"
    if not f.exists():
        return [], []
    year, month = price_month(price_list)
    details, _ = read_details(dir_)
    names: Dict[str, Counter] = defaultdict(Counter)
    for d in details.values():
        for s in d.get("sides") or []:
            for c in s.get("components") or []:
                if c.get("kind") == "lab" and c.get("code") and c.get("description"):
                    names[c["code"]][c["description"]] += 1
    lines = f.read_text(encoding="utf-8-sig").splitlines()
    head = [h.strip() for h in lines[0].split("\t")]
    rates: Dict[str, dict] = {}
    notes: List[str] = []
    for line in lines[1:]:
        r = dict(zip(head, [c.strip() for c in line.split("\t")]))
        if r.get("status") != "ok" or not r.get("trade"):
            continue
        rate, wage, burden, overhead = (money(r.get(k, "")) for k in
                                        ("rate_per_hour", "wage_per_hour", "burden_per_hour", "overhead_per_hour"))
        if None in (rate, wage, burden, overhead) or abs(wage + burden + overhead - rate) > Decimal("0.02"):
            notes.append(f"labor {r['trade']} ({r.get('category')} {r.get('selector')}): parts don't add up to {rate}")
            continue
        row = {
            "trade": r["trade"][:20],
            "description": names[r["trade"]].most_common(1)[0][0] if names[r["trade"]] else None,
            "price_list": price_list, "price_year": year, "price_month": month,
            "rate_per_hour": rate, "wage_per_hour": wage, "burden_per_hour": burden, "overhead_per_hour": overhead,
            "sample_item_code": f"{r.get('category', '')}{r.get('selector', '')}"[:50] or None,
        }
        old = rates.get(row["trade"])
        if old is None:
            rates[row["trade"]] = row
        elif any(old[k] != row[k] for k in ("rate_per_hour", "wage_per_hour", "burden_per_hour", "overhead_per_hour")):
            notes.append(f"labor {row['trade']}: {old['sample_item_code']} and {row['sample_item_code']} split differently")
    return sorted(rates.values(), key=lambda x: x["trade"]), notes


def build(dir_: Path, price_list: str):
    year, month = price_month(price_list)
    categories = {r[0]: (r[1] if len(r) > 1 else r[0]) for r in read_tsv(dir_ / "categories.tsv")}

    reports: Dict[str, dict] = {}
    parsed = dir_ / "parsed.jsonl"
    if parsed.exists():
        for line in parsed.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            if r.get("item_code"):
                reports[r["item_code"]] = r

    # Xactimate's own replace / remove prices where the report can't tell how its
    # market conditions divide between the two.
    exact: Dict[str, Tuple[Decimal, Decimal]] = {}
    split_file = dir_ / "split_prices.tsv"
    if split_file.exists():
        for row in read_tsv(split_file):
            if len(row) >= 5 and row[2] == "ok" and money(row[3]) is not None and money(row[4]) is not None:
                exact[f"{row[0]}{row[1]}"] = (money(row[3]), money(row[4]))

    details, events = read_details(dir_)
    event_codes = EventCodes(dir_)
    rmi_reads, rmi_reports = read_rmi(dir_)
    phase_of = canonical_phases(Counter(
        s.get("phase") for d in details.values() for s in d.get("sides") or [] if s.get("phase")))

    items, problems = [], Counter()
    notes: List[str] = []
    for tsv in sorted((dir_ / "catalog").glob("*.tsv")):
        cat = tsv.stem.rstrip("_")  # CON_.tsv -> CON (Windows reserves the name CON)
        for row in read_tsv(tsv):
            row += [""] * (6 - len(row))
            sel, desc, unit, act, price, green = row[:6]
            code = f"{cat}{sel}"
            rep = reports.get(code)
            usable = rep is not None and not rep.get("checks")
            item = {
                "category_code": cat, "item_code": code, "selector": sel,
                "description": desc, "unit": unit or None, "activity": act or None,
                "price_list": price_list, "is_green": green.lower() == "true",
                "price_year": year, "price_month": month,
                "untaxed_unit_price": money(price) or Decimal("0"),
                "labor_cost": None, "material_cost": None, "equipment_cost": None,
                "labor_burden": None, "market_conditions": None,
                "life_expectancy_years": None, "depreciation_rate": None, "max_depreciation": None,
                "has_life_expectancy_data": False,
                "includes_description": None, "excludes_description": None, "quality_description": None,
                "reference_description": None, "note_description": None,
                "replace_price": None, "remove_price": None,
                "replace_phase": None, "remove_phase": None,
                "replace_market_conditions": None, "remove_market_conditions": None,
                "minimum_group": None,
                "other_activities": None, "detach_reset_price": None,
                "material_only_price": None, "install_only_price": None,
                "components": [],
            }
            if rep is None:
                problems["no report"] += 1
                notes.append(f"{code}: no report - catalog price only")
            elif not usable:
                problems["report failed checks"] += 1
                notes.append(f"{code}: report checks {rep['checks']} - catalog price only")
            if usable:
                c, d, life = rep["costs"], rep["definition"], rep["life"]
                if money(price) is not None and abs(money(price) - Decimal(str(c["untaxed_unit_price"]))) > Decimal("0.011"):
                    problems["catalog price != report price"] += 1
                    notes.append(f"{code}: catalog {price} vs report {c['untaxed_unit_price']}")
                item.update(
                    description=rep.get("description") or desc,
                    untaxed_unit_price=dec(c["untaxed_unit_price"], 2),
                    labor_cost=dec(c.get("lab"), 2), material_cost=dec(c.get("mat"), 2),
                    equipment_cost=dec(c.get("equ"), 2), labor_burden=dec(c.get("labor_burden"), 2),
                    market_conditions=dec(c.get("market_conditions"), 2),
                    life_expectancy_years=life.get("years"), depreciation_rate=dec(life.get("rate"), 2),
                    max_depreciation=dec(life.get("max"), 2), has_life_expectancy_data=bool(life),
                    includes_description=d.get("includes") or None, excludes_description=d.get("excludes") or None,
                    quality_description=d.get("quality") or None, note_description=d.get("notes") or None,
                    reference_description="\n".join(
                        t for t in (d.get("reference"), d.get("green") and f"Green: {d['green']}") if t) or None,
                    components=[component_row(x) for x in rep["components"]],
                )
                if rep.get("activity") and act and rep["activity"] != act:
                    notes.append(f"{code}: catalog activity {act} vs report {rep['activity']}")
            item["replace_price"], item["remove_price"] = split_prices(
                rep.get("activity") if usable else (act or None), item["untaxed_unit_price"], item["components"])
            if code in exact and item["replace_price"] is not None:
                item["replace_price"], item["remove_price"] = exact[code]
            elif usable and act == "&" and (rep["costs"].get("market_conditions") or 0) != 0:
                problems["& split guessed (market conditions, no Xactimate split)"] += 1
                notes.append(f"{code}: market conditions {rep['costs']['market_conditions']} put on replace - not read from Xactimate")
            if usable and rep.get("activity") in ("+", "-"):
                # one activity: all of the report's market conditions are that activity's
                key = "replace" if rep["activity"] == "+" else "remove"
                item[f"{key}_market_conditions"] = item["market_conditions"]
            det = details.get(code)
            if det and usable and not str(det.get("status", "")).startswith("error"):
                bad = apply_details(item, det, phase_of, event_codes)
                problems["with details"] += 1
                unread = sum(1 for c in item["components"] if c["activity"] in "+-"
                             and event_key(cat, c["activity"], c) and not c["supporting_event"])
                if unread:
                    problems["components with a supporting event % but no event code"] += unread
                    notes.append(f"{code}: {unread} supporting event(s) not read")
                if bad:
                    problems["details not matching the report"] += 1
                    notes.append(f"{code}: details {bad}")
            elif usable and rep.get("components"):
                problems["no details yet"] += 1
            read = rmi_reads.get(code)
            if read:
                bad = apply_rmi(item, read, rmi_reports.get(code))
                problems["with R/M/I"] += 1
                if bad:
                    problems["R/M/I to look at"] += 1
                    notes.append(f"{code}: R/M/I {bad}")
            items.append(item)
    events = event_codes.texts(events, items)
    no_text = sorted({c["supporting_event"] for it in items for c in it["components"]
                      if c.get("supporting_event") and not events.get(c["supporting_event"])})
    if no_text:
        problems["supporting event codes without a text"] = len(no_text)
        notes.append(f"supporting events without a text: {', '.join(no_text)}")
    return categories, items, problems, notes, (year, month), events


def write(url: str, categories: Dict[str, str], items: List[dict], year: int, month: int,
          events: Optional[Dict[str, str]] = None, labor_rates: Optional[List[dict]] = None) -> None:
    engine = sa.create_engine(url)
    md = sa.MetaData()
    t_cat = sa.Table("xactimate_categories", md, autoload_with=engine)
    t_item = sa.Table("xactimate_items", md, autoload_with=engine)
    t_comp = sa.Table("xactimate_components", md, autoload_with=engine)
    for col in ("unit", "activity", "price_list", "is_green", "replace_price", "remove_price",
                "replace_phase", "remove_phase", "replace_market_conditions", "remove_market_conditions",
                "minimum_group"):
        if col not in t_item.c:
            raise SystemExit(f"xactimate_items.{col} is missing - run migration xp20261108pl01 first")
    for col in ("activity", "description", "supporting_event"):
        if col not in t_comp.c:
            raise SystemExit(f"xactimate_components.{col} is missing - run migration xp20261108pl01 first")
    for col in ("other_activities", *OTHER_ACTIVITY_PRICES.values()):
        if col not in t_item.c:
            raise SystemExit(f"xactimate_items.{col} is missing - run migration xp20261113rm01 first")
    t_event = sa.Table("xactimate_supporting_events", md, autoload_with=engine)
    t_rate = None
    if labor_rates:
        if "xactimate_labor_rates" not in sa.inspect(engine).get_table_names():
            raise SystemExit("xactimate_labor_rates is missing - run migration xp20261113rm01 first")
        t_rate = sa.Table("xactimate_labor_rates", md, autoload_with=engine)

    by_cat: Dict[str, List[dict]] = {}
    for it in items:
        by_cat.setdefault(it["category_code"], []).append(it)
    now = datetime.now(timezone.utc)
    item_cols = [c.name for c in t_item.c if c.name not in ("id", "created_at", "updated_at")]

    if events:
        # a code mapped to None was a misread one: deleted, not written again
        keep = {k: v for k, v in events.items() if v}
        with engine.begin() as conn:
            conn.execute(t_event.delete().where(t_event.c.code.in_(list(events))))
            if keep:
                conn.execute(t_event.insert(), [{"code": k[:30], "description": v, "created_at": now} for k, v in keep.items()])
        print(f"  {len(keep)} supporting events" + (f", {len(events) - len(keep)} misread codes removed" if len(keep) < len(events) else ""))

    if t_rate is not None:
        with engine.begin() as conn:
            conn.execute(t_rate.delete().where(t_rate.c.price_year == year, t_rate.c.price_month == month))
            conn.execute(t_rate.insert(), [{**r, "created_at": now, "updated_at": now} for r in labor_rates])
        print(f"  {len(labor_rates)} labor rates")

    with engine.begin() as conn:
        existing = {r[0] for r in conn.execute(sa.select(t_cat.c.category_code))}
        for code in sorted(set(categories) | set(by_cat)):
            name = categories.get(code, code)[:100]
            if code in existing:
                conn.execute(t_cat.update().where(t_cat.c.category_code == code).values(category_name=name))
            else:
                conn.execute(t_cat.insert().values(category_code=code, category_name=name, created_at=now))

    for cat, rows in sorted(by_cat.items()):
        with engine.begin() as conn:
            old = sa.select(t_item.c.id).where(
                t_item.c.category_code == cat, t_item.c.price_year == year, t_item.c.price_month == month)
            conn.execute(t_comp.delete().where(t_comp.c.item_id.in_(old)))
            conn.execute(t_item.delete().where(
                t_item.c.category_code == cat, t_item.c.price_year == year, t_item.c.price_month == month))
            conn.execute(t_item.insert(), [
                {**{k: it.get(k) for k in item_cols}, "created_at": now, "updated_at": now} for it in rows])
            ids = {r.item_code: r.id for r in conn.execute(sa.select(t_item.c.id, t_item.c.item_code).where(
                t_item.c.category_code == cat, t_item.c.price_year == year, t_item.c.price_month == month))}
            comps = [{**c, "item_id": ids[it["item_code"]]} for it in rows for c in it["components"]]
            if comps:
                conn.execute(t_comp.insert(), comps)
        print(f"  {cat}: {len(rows)} items, {sum(len(it['components']) for it in rows)} components")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--price-list", required=True)
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--notes", help="write per-item notes to this file")
    a = ap.parse_args()

    categories, items, problems, notes, (year, month), events = build(Path(a.dir), a.price_list)
    print(f"price list {a.price_list} -> {year}-{month:02d}")
    print(f"{len(categories)} categories, {len(items)} items, "
          f"{sum(1 for i in items if i['components'])} with full report, "
          f"{sum(len(i['components']) for i in items)} components")
    for k, v in problems.most_common():
        print(f"  {k}: {v}")
    with_other = [i for i in items if i["other_activities"]]
    if with_other:
        print(f"R/M/I: {sum('R' in i['other_activities'] for i in with_other)} Detach & Reset, "
              f"{sum('M' in i['other_activities'] for i in with_other)} Material Only, "
              f"{sum('I' in i['other_activities'] for i in with_other)} Install Only; "
              f"{sum(1 for i in items for c in i['components'] if c['activity'] == 'R')} Detach & Reset components")
    if events:
        dropped = sum(1 for v in events.values() if v is None)
        print(f"{len(events) - dropped} supporting event texts" + (f", {dropped} misread codes to remove" if dropped else ""))
    labor_rates, labor_notes = read_labor_rates(Path(a.dir), a.price_list)
    notes += labor_notes
    if labor_rates or labor_notes:
        print(f"{len(labor_rates)} labor rates" + (f", {len(labor_notes)} left out (see notes)" if labor_notes else ""))
    if a.notes:
        Path(a.notes).write_text("\n".join(notes), encoding="utf-8")
    if not a.commit:
        print("dry run - nothing written (add --commit)")
        return
    if not a.database_url:
        sys.exit("no database url (--database-url or DATABASE_URL)")
    write(a.database_url, categories, items, year, month, events, labor_rates)
    print("written")


if __name__ == "__main__":
    main()
