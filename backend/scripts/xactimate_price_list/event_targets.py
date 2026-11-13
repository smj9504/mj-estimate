"""
List the rows event_pictures.ps1 takes a picture of, to read their supporting event code by eye
(see README: supporting events): every (category, side, component, SPT %) no row has an event
for, and one row for each event code details.ps1 settled on - each read code is checked once.
A row is taken from the item with the fewest components (the smallest window).

    python event_targets.py [out_dir]     -> out/event_targets.tsv

Columns: cat, sel, the item's activities, side, row (1-based), key (cat|side|component|SPT %),
the code details.ps1 has for the key ("" none), why. event_fixes.py reads the readings back.
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
    details = {}
    for line in open(os.path.join(out, "details.jsonl"), encoding="utf-8"):
        if line.strip():
            r = json.loads(line)
            details[r["item_code"]] = r   # the last read of an item wins
    parsed = {}
    for line in open(os.path.join(out, "parsed.jsonl"), encoding="utf-8"):
        d = json.loads(line)
        parsed[d["item_code"]] = d
    cache = {}
    for line in open(os.path.join(out, "details_events.tsv"), encoding="utf-8"):
        f = line.rstrip("\n").split("\t")
        if len(f) >= 5:
            cache[tuple(f[:4])] = f[4]
    occ, missing = defaultdict(list), set()
    for code, r in details.items():
        p = parsed.get(code)
        if not p:
            continue
        for side in r.get("sides") or []:
            act = "+" if side.get("side") == "replace" else "-"
            comps = [c for c in p["components"] if c["activity"] == act]
            rows = side.get("components") or []
            if len(rows) != len(comps):
                continue
            for i, (c, row) in enumerate(zip(comps, rows)):
                spt = c.get("spt_event_percent") or 0
                if not spt:
                    continue
                key = (r["category"], act, c["component_code"], f"{spt:.3f}")
                if "%" not in r["selector"]:   # a file name stand-in, not typeable in Quick Entry
                    occ[key].append((r["category"], r["selector"], act, i + 1, len(comps)))
                if not row.get("event") and key not in cache:
                    missing.add(key)

    def pick(key):
        o = sorted(occ[key], key=lambda x: (x[4], len(x[1])))
        return o[0] if o else None

    targets = {k: "missing" for k in missing}
    keys_of = defaultdict(list)
    for k, ev in cache.items():
        keys_of[ev].append(k)
    for ev, ks in keys_of.items():
        best = min((k for k in ks if pick(k)), key=lambda k: pick(k)[4], default=None)
        if best:
            targets.setdefault(best, f"code {ev}")
    rows = []
    for k, why in targets.items():
        p = pick(k)
        if p:
            cat, sel, act, row, _ = p
            rows.append((cat, sel, sides.get((cat, sel), act), act, row, "|".join(k), cache.get(k, ""), why))
    rows.sort(key=lambda r: (r[0], r[1], r[3], r[4]))
    with open(os.path.join(out, "event_targets.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write("".join("\t".join(map(str, r)) + "\n" for r in rows))
    print(f"{len(rows)} rows ({len(missing)} keys without an event, {len(keys_of)} codes)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
