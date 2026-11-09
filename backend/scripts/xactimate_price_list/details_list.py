"""
List what details.ps1 should read from each item's Item Activity Information
windows, from the parsed reports.

One line per item (catalog order, categories in out/order.txt order):

    cat  sel  sides  plus  minus

sides: "+" , "-" or "+-" (which i windows to open: Replace, Remove)
plus / minus: that side's components as CODE|SPT%|unit price|kind, joined by ";"
              (kind lab / mat / equ; what details.ps1 checks each row against)

Items without components (bid items, agreed price, ...) and MISC are left out.

    python details_list.py <out dir>      -> <out>/details_items.tsv
"""

import json
import sys
from pathlib import Path


def side(components, act):
    return ";".join(
        f"{c['component_code']}|{c['spt_event_percent']:.3f}|{c['unit_price']:.2f}|{c['component_type']}"
        for c in components if c.get("activity") == act
    )


def main(out: str) -> None:
    root = Path(out)
    reports = {}
    for line in (root / "parsed.jsonl").read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        if r.get("item_code"):
            reports[r["item_code"]] = r
    order = [c.strip() for c in (root / "order.txt").read_text(encoding="utf-8").split(",") if c.strip()]
    lines, skipped = [], 0
    for cat in order:
        tsv = root / "catalog" / (f"{cat}_.tsv" if cat in ("CON", "PRN", "AUX", "NUL") else f"{cat}.tsv")
        if not tsv.exists():
            continue
        for row in tsv.read_text(encoding="utf-8-sig").splitlines():
            sel = row.split("\t")[0].strip()
            rep = reports.get(cat + sel)
            if not sel or sel == "MISC" or not rep or not rep.get("components") or rep.get("checks"):
                skipped += 1
                continue
            plus, minus = side(rep["components"], "+"), side(rep["components"], "-")
            sides = ("+" if plus else "") + ("-" if minus else "")
            if not sides:
                skipped += 1
                continue
            lines.append("\t".join([cat, sel, sides, plus, minus]))
    (root / "details_items.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    both = sum(1 for l in lines if l.split("\t")[2] == "+-")
    print(f"{len(lines)} items ({both} with both sides), {skipped} left out")


if __name__ == "__main__":
    main(sys.argv[1])
