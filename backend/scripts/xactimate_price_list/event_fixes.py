"""
Turn supporting event codes read by eye (from event_pictures.ps1's pictures) into the two files
import_price_list.py applies (see README: supporting events):

  details_event_renames.tsv  misread code, code, note - the same code misread by OCR (1 read as I,
                             O as 0, VV as W, a dropped or garbled first letter); renamed everywhere
  details_events_fixed.tsv   cat, side, component, SPT %, event, selector, note - a key no row had an
                             event for (no selector: every item of the category), or an item whose
                             event differs from the one details.ps1 settled for its key (selector)

    python event_fixes.py <out_dir> <targets.tsv> <readings.tsv> [<targets.tsv> <readings.tsv> ...]

readings.tsv: index (0-based line of targets.tsv) <TAB> the code in the picture. Both files are
rewritten from all the pairs given.
"""

import difflib
import os
import re
import sys
from collections import Counter, defaultdict


def main(out: str, pairs: list) -> None:
    texts = {}
    for line in open(os.path.join(out, "details_event_texts.tsv"), encoding="utf-8-sig"):
        c, _, t = line.rstrip("\n").partition("\t")
        if c.strip():
            texts[c.strip()] = t.strip()

    def shape(s):
        if s.startswith("r-"):            # OCR reads a light F as "r-"
            s = "F" + s[2:]
        s = s.upper().replace("VV", "W")
        return re.sub(r"[^A-Z0-9]", "", s).replace("I", "1").replace("L", "1").replace("O", "0")

    def misread(old, new):
        a, b = shape(old), shape(new)
        if a == b or (len(a) >= 3 and b.endswith(a)):     # OCR drops leading letters, never adds
            return True
        # same text, nearly the same code (ACBALHR / FNCBALHR); not labor events, which share a text
        return bool(not new.endswith("-LAB") and texts.get(old) and texts.get(old) == texts.get(new)
                    and difflib.SequenceMatcher(None, a, b).ratio() >= 0.75)

    renames, key_fix, item_fix, seen = defaultdict(Counter), defaultdict(Counter), {}, Counter()
    for tf, rf in zip(pairs[0::2], pairs[1::2]):
        rows = [l.rstrip("\n").split("\t") for l in open(tf, encoding="utf-8") if l.strip()]
        read = dict(l.rstrip("\n").split("\t")[:2] for l in open(rf, encoding="utf-8") if l.strip())
        for i, r in enumerate(rows):
            cat, sel, _, act, _, key, cached = r[:7]
            got = read.get(str(i))
            k = tuple(key.split("|"))
            if not got:
                seen["no reading"] += 1
            elif not cached:
                key_fix[k][got] += 1; seen["no event -> key fix"] += 1
            elif got == cached:
                seen["same"] += 1
            elif misread(cached, got) and (texts.get(cached) == texts.get(got) or got not in texts):
                renames[cached][got] += 1; seen["misread -> rename"] += 1
            else:
                item_fix[(k, sel)] = got; seen["different event -> item fix"] += 1
                print(f"  {cat} {sel} {act} {k[2]} {k[3]}: settled {cached}, window {got}")
    for name, d in (("renamed", renames), ("key", key_fix)):
        for k, c in d.items():
            if len(c) > 1:
                print(f"read two ways ({name}), left out: {k} {dict(c)}")
    with open(os.path.join(out, "details_event_renames.tsv"), "w", encoding="utf-8", newline="\n") as f:
        for m in sorted(renames):
            if len(renames[m]) == 1:
                f.write(f"{m}\t{next(iter(renames[m]))}\tread by eye {sum(renames[m].values())}x\n")
    with open(os.path.join(out, "details_events_fixed.tsv"), "w", encoding="utf-8", newline="\n") as f:
        for k in sorted(key_fix):
            if len(key_fix[k]) == 1:
                f.write("\t".join([*k, next(iter(key_fix[k])), "", "no event read; read by eye"]) + "\n")
        for (k, sel) in sorted(item_fix):
            f.write("\t".join([*k, item_fix[(k, sel)], sel, "differs from the key's other items; read by eye"]) + "\n")
    print(dict(seen))


if __name__ == "__main__":
    if len(sys.argv) < 4 or len(sys.argv) % 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
