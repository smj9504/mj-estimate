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
from collections import Counter
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


def apply_details(item: dict, det: dict, phase_of: Dict[str, str]) -> List[str]:
    """Put what details.ps1 read onto the item and its components; returns problems."""
    problems = []
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
            c["supporting_event"] = (r.get("event") or "")[:30] or None
    return problems


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
                    components=[{
                        "component_type": x["component_type"], "activity": x["activity"],
                        "component_code": (x["component_code"] or "")[:50] or None,
                        "cost": dec(x["cost"], 3), "direct_yield": dec(x["direct_yield"], 3),
                        "yield_unit": (x["yield_unit"] or "")[:20] or None,
                        "spt_event_percent": dec(x["spt_event_percent"], 3), "yield_value": dec(x["yield_value"], 3),
                        "unit_price": dec(x["unit_price"], 2),
                        "description": None, "supporting_event": None,
                    } for x in rep["components"]],
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
                bad = apply_details(item, det, phase_of)
                problems["with details"] += 1
                if bad:
                    problems["details not matching the report"] += 1
                    notes.append(f"{code}: details {bad}")
            elif usable and rep.get("components"):
                problems["no details yet"] += 1
            items.append(item)
    return categories, items, problems, notes, (year, month), events


def write(url: str, categories: Dict[str, str], items: List[dict], year: int, month: int,
          events: Optional[Dict[str, str]] = None) -> None:
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
    t_event = sa.Table("xactimate_supporting_events", md, autoload_with=engine)

    by_cat: Dict[str, List[dict]] = {}
    for it in items:
        by_cat.setdefault(it["category_code"], []).append(it)
    now = datetime.now(timezone.utc)
    item_cols = [c.name for c in t_item.c if c.name not in ("id", "created_at", "updated_at")]

    if events:
        with engine.begin() as conn:
            conn.execute(t_event.delete().where(t_event.c.code.in_(list(events))))
            conn.execute(t_event.insert(), [{"code": k[:30], "description": v, "created_at": now} for k, v in events.items()])
        print(f"  {len(events)} supporting events")

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
    if a.notes:
        Path(a.notes).write_text("\n".join(notes), encoding="utf-8")
    if not a.commit:
        print("dry run - nothing written (add --commit)")
        return
    if not a.database_url:
        sys.exit("no database url (--database-url or DATABASE_URL)")
    write(a.database_url, categories, items, year, month, events)
    print("written")


if __name__ == "__main__":
    main()
