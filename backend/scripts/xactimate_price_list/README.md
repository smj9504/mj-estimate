# Xactimate price list import

Reads the whole price list out of the Xactimate desktop estimate writer on a
Windows PC and loads it into `xactimate_categories` / `xactimate_items` /
`xactimate_components`.

Xactimate exposes nothing to Windows UI Automation, so `runner.ps1` drives
the real mouse and keyboard. It pauses whenever someone touches the mouse or
keyboard and goes on after 30 s idle. Creating `out\STOP` stops it after the
current item. It also uses the clipboard.

## What it reads

| Step | Xactimate screen | What comes out |
|---|---|---|
| categories | Quick Entry → ◂ next to Cat → *P.L. Categories*, Ctrl+A / Ctrl+C | `categories.tsv`: code, name |
| catalog | ◂ next to Sel → *Selectors for CAT*, Ctrl+A / Ctrl+C | `catalog/CAT.tsv`: selector, description, unit, default activity, unit price, green |
| reports | in that list: filter to the selector → **View** → **Preview** | `pdf/CAT/SEL.pdf`: *Price List Item Report* |
| split prices (`split_prices.ps1`) | Quick Entry → Cat, Sel → click the unit price → *Replace Price* / *Remove Price* | `split_prices.tsv`: Xactimate's own replace and remove price |

The report holds the cost split (labor, material, equipment, labor burden,
market conditions, untaxed unit price), every component with its cost,
direct yield, yield unit, supporting event % and yield, for replace (+) and
remove (−), the definition (includes, excludes, quality, reference, notes),
and life expectancy / depreciation. Each Preview opens the PDF in the
default browser; the runner closes those tabs as it goes.

An & (remove and replace) item's price splits into replace (the + components)
and remove (the − components); that matched Xactimate's own Replace/Remove
Price to the cent on every item checked. The exception is market conditions:
the report gives one total, while Xactimate puts them on replace, remove or
both. `split_prices.ps1` reads those items' split from Quick Entry
(`mc_items.tsv` lists them: & items with market conditions), and the
importer prefers it.

The report doesn't have the component descriptions, the supporting event
codes and texts, the phase or each activity's market conditions. `details.ps1`
reads them from Quick Entry → unit price → the i next to *Replace Price* /
*Remove Price* (the editable Item Activity Information window, always left
with Esc): component rows are copied with Ctrl+C one row at a time, the
greyed-out boxes (phase, component code, supporting event) are read with
Windows OCR and checked against the report, and each event's text is read
once. Input `details_items.tsv` comes from `details_list.py`; output is
`details.jsonl`, `details_events.tsv`, `details_event_texts.tsv`. About 8 s
an item (two windows for & items), so ~32 hours for the whole list: it waits
for Quick Entry's description box to redraw and for each copy to reach the
clipboard instead of fixed pauses (13.0 → 8.9 s on 40 items, same data). An
item whose Quick Entry price differs from its report (LIT RCT, FCW LAMQ) is
an error that counts half toward the three-in-a-row pause. Run it
with `supervise_details.ps1`. Worker's wage / labor burden / labor overhead
aren't read per item: they're a fixed split of each labor trade's rate (see
labor trades below).

The supporting event code is only in a greyed-out box (its ◂ is disabled:
there's no list to copy), and Windows OCR sometimes can't settle it or
settles on a wrong code: a dropped first letter (RMSH for FRMSH, NCTRIM for
FNCTRIM), 1 read as I (FNCIX-3 for FNC1X-3, SCREW-I for SCREW-1), VV read as W,
`>>` in the component code box read as nothing. Re-reading doesn't help (the
same picture gives the same OCR). And `details.ps1` reads each (category,
side, component, SPT %) once and reuses it, which isn't always right: FRM's
FRMSHW3/4T at 10 % is FRMSH in sheathing items but FRMUL in underlayment ones,
and labor events differ between items of mixed categories (EQA, EQC: STL-LAB,
MTL-LAB, SDG-LAB for the same CARP-MECH 31.25 %).

`event_pictures.ps1` saves a picture of the component code and supporting
event boxes for listed rows (`event_targets.py` lists them: rows with no event,
codes that look misread, one row per code), to be read by eye; the readings go
into two files the importer applies:

- `details_event_renames.tsv` (misread code, code, note): renamed everywhere.
  The text was read from the same window, so it goes with the right code, and
  the misread code is removed from `xactimate_supporting_events`.
- `details_events_fixed.tsv` (category, side, component, SPT %, event,
  selector, note): with a selector for that item only, without for every
  item of the category with that key.

`details_events.tsv` also fills a row of an item read before its key was
learned. The importer counts the components still left with a supporting
event % and no code, and the codes without a text.

Still open (VAAR8X_NOV26): about 32,800 rows took their event from a key
learned at another item, and pictures at another item showed a different
event on 7 of 116 (~6 %), so on the order of 2,000 rows may carry another
item's event code and text. Prices don't depend on it (the SPT % is the
report's). Fixing it means reading every row's event without reusing keys:
`details.ps1` still reuses them, and a full pass takes about a day.

An item's report gives market conditions only as one total, and its
components leave them out: an item's replace price is its + components plus
that side's market conditions (STR TRDT: 57.11 + 24.70 = 81.81). Quick Entry's
total and the Selectors list's price agree, which is what `details.ps1`
checks a price against when the components alone don't add up.

### Detach & Reset, Material Only, Install Only (`rmi.ps1`)

Quick Entry's Act list offers, besides the item's own activity, up to three
more: R (Detach & Reset), M (Material Only), I (Install Only). It lists only
the ones the item has, and an item with a single activity has its Act box
greyed out. `rmi.ps1` reads, for every item with components
(`rmi_items.tsv` from `rmi_list.py`): which of R / M / I the item offers
(the Act list, by OCR), each one's price (picked in the list, the price box
copied), and R's own Price List Item Report (the i next to *Reset Price* →
Preview), because R has its own labor yield (CAB CTCON-: R $41.67, replace
$95.17). M is the replace material components and I the replace labor and
equipment (+ that side's market conditions); that held on 70 reports, so only
their prices are read, each checked against those components (a
mismatch is a `check:` line, not an error). Output: `rmi_index.tsv` (cat,
sel, activities, R, M, I, status) and `pdf_rmi/CAT/SEL.R.pdf`. About 4.8 s an
item, ~19 hours for 14,083 items; run it with `supervise_rmi.ps1`
(`resume.ps1` starts it, `status.ps1` shows it).

After the run, check that no item took the previous item's values: when
Quick Entry hadn't loaded the new item yet, the first read after Xactimate
was reopened, or a dropped first character (FRM 2X212WP read as X212WP), the
item got the previous one's activities and prices. The M/I check catches
those (10 of 14,083 on VAAR8X_NOV26, all fine on a re-read with
`rmi.ps1 -Only "CAT SEL,..."`); every R price should also match its report,
and a report left from such a read (it names another item) should be moved
out of `pdf_rmi`.

### Labor trades (`trades.ps1`)

An item's Item Activity window splits its labor into Worker's Wage, Labor
Burden and Labor Overhead. Scaled by the labor component's rate per hour /
labor per unit, that's the trade's hourly split, the same for every item of
the trade (two items per trade agreed on all 38). The trade is the labor
component's code (CARP-FNC). `trades_list.py` picks two items per trade with
a single labor component; `trades.ps1` reads them (OCR, tried until the three
add up to the labor per unit) into `labor_trades.tsv`. The report's "Lab"
is wage + overhead and its "Labor Burden" the burden. The nine P* trades
(PACT, PM...) are $0 and have nothing to read.

## Running it

Assumes Xactimate is maximized on a 2560×1528 screen with an estimate open
on Estimate Items (the Quick Entry positions in `runner.ps1` are pixels).
Nothing is added to the estimate: only the read-only View window is used.

```powershell
.\runner.ps1 -Mode categories -Out .\out
$cats = Get-Content .\out\categories.tsv | % { ($_ -split "`t")[0] }
.\runner.ps1 -Mode catalog -Categories $cats -Out .\out
.\runner.ps1 -Mode reports -Categories $cats -Out .\out     # ~3 s per item; resumes from out\index.tsv
.\split_prices.ps1                                           # after parsing: & items with market conditions, ~6 s each
```

For the long reports run use `supervise.ps1` (restarts the runner, retries
failed items twice) with `pause.ps1` / `resume.ps1` / `status.ps1`. Nothing is
fetched twice: items marked ok or skipped in `index.tsv` and complete PDFs
already on disk are skipped, and only one runner and one supervisor run at a
time. Three failures in a row (Xactimate logged off after ~9 hours) pause the
run until `resume.ps1`; if Xactimate was closed and opened again in the
meantime, the running reader follows the new one. Never `tail -f` the run's files: an open handle made
the runner's log writes fail once.

Then, from `backend/`:

```bash
python scripts/xactimate_price_list/parse_reports.py <out>/pdf <out>/parsed.jsonl
python scripts/xactimate_price_list/parse_reports.py <out>/pdf_rmi <out>/parsed_rmi.jsonl
python scripts/xactimate_price_list/import_price_list.py <out> --price-list VAAR8X_NOV26            # dry run
python scripts/xactimate_price_list/import_price_list.py <out> --price-list VAAR8X_NOV26 --commit --database-url ...
```

The price month comes from the price list name (`VAAR8X_NOV26` → 2026-11).
Re-importing a month replaces that month's rows, category by category.
Items whose report is missing or doesn't add up are still loaded with the
catalog price and description only, and listed with `--notes`.

R / M / I go on the item (`other_activities` "RMI", "MI"...; "" none; empty
where not read; `detach_reset_price`, `material_only_price`,
`install_only_price`), R's components next to its + and − ones with activity
`R`, and the labor trades into `xactimate_labor_rates` (migration
`xp20261113rm01`).
