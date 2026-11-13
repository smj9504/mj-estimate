"""
Pick, for each labor trade, two items to read its labor breakdown from (trades.ps1).

A trade is the component code of a labor component (CARP-FNC, DMO...). An item
whose activity has exactly one labor component shows that trade's breakdown
(worker's wage, labor burden, labor overhead) in its Item Activity window.
Preferred: one-activity items (the window opens straight from Replace), labor
of $10 - $5,000 per unit (amounts that size read reliably), larger first.

Reads out/details_items.tsv (cat, sel, activities) and out/parsed.jsonl; writes
out/trades_items.tsv: trade, cat, sel, activity read (+/-), item's activities,
labor per unit, rate per hour (the component's cost).

    python trades_list.py [out_dir]
"""

import json
import os
import sys
from collections import defaultdict


def main(out: str) -> None:
    sides = {}
    for line in open(os.path.join(out, "details_items.tsv"), encoding="utf-8"):
        f = line.rstrip("\n").split("\t")
        if len(f) >= 3:
            sides[(f[0], f[1])] = f[2]
    cand = defaultdict(list)
    trades = set()
    for line in open(os.path.join(out, "parsed.jsonl"), encoding="utf-8"):
        d = json.loads(line)
        sel = os.path.splitext(os.path.basename(d["file"]))[0]
        key = (d["category"], sel)
        trades.update(c["component_code"] for c in d["components"] if c["component_type"] == "lab")
        if key not in sides or "%" in sel:  # % in a file name stands for a character Windows won't take
            continue
        for act in "+-":
            labs = [c for c in d["components"] if c["activity"] == act and c["component_type"] == "lab"]
            if len(labs) != 1 or labs[0]["unit_price"] <= 0:
                continue
            lab = labs[0]["unit_price"]
            cand[labs[0]["component_code"]].append((
                0 if 10 <= lab <= 5000 else 1, 0 if sides[key] in ("+", "-") else 1, -lab,
                key[0], key[1], act, sides[key], lab, labs[0]["cost"]))
    with open(os.path.join(out, "trades_items.tsv"), "w", encoding="utf-8") as f:
        for trade, c in sorted(cand.items()):
            for x in sorted(c)[:2]:
                f.write("\t".join(map(str, [trade, *x[3:]])) + "\n")
    print(f"{len(trades)} trades, {len(cand)} with an item to read; none for: {sorted(trades - set(cand))}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
