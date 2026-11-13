"""
List the items rmi.ps1 reads: every item whose report has components, in the
category order of out/order.txt (the catalog's order inside a category).

Each line: cat, sel, then what rmi.ps1 checks M and I against - the replace
(+) material components' total, the replace labor + equipment total - and the
report's market conditions.

    python rmi_list.py [out_dir]
"""

import json
import os
import re
import sys


def main(out: str) -> None:
    order_file = os.path.join(out, "order.txt")
    order = open(order_file, encoding="utf-8").read().strip().split(",") if os.path.exists(order_file) else []
    rank = {c: i for i, c in enumerate(order)}
    rows = []
    for line in open(os.path.join(out, "parsed.jsonl"), encoding="utf-8"):
        d = json.loads(line)
        if not d["components"]:
            continue
        # file names keep %XX for characters Windows won't take
        sel = re.sub(r"%([0-9A-F]{2})", lambda m: chr(int(m.group(1), 16)),
                     os.path.splitext(os.path.basename(d["file"]))[0])
        plus = [c for c in d["components"] if c["activity"] == "+"]
        mat = sum(c["unit_price"] for c in plus if c["component_type"] == "mat")
        lab = sum(c["unit_price"] for c in plus if c["component_type"] != "mat")
        mc = (d.get("costs") or {}).get("market_conditions") or 0
        rows.append((rank.get(d["category"], 999), d["category"], sel, f"{mat:.2f}", f"{lab:.2f}", f"{mc:.2f}"))
    rows.sort(key=lambda r: (r[0], r[1]))  # stable: keeps the catalog order inside a category
    with open(os.path.join(out, "rmi_items.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write("".join("\t".join(r[1:]) + "\n" for r in rows))
    print(f"{len(rows)} items")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
