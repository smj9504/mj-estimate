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
`details.jsonl`, `details_events.tsv`, `details_event_texts.tsv`. About 11 s
an item (two windows for & items), so ~45 hours for the whole list; run it
with `supervise_details.ps1` (`resume.ps1` starts it). Worker's wage / labor
burden / labor overhead aren't read per item: they're a fixed split of each
labor trade's rate, and OCR misreads those short grey amounts.

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
python scripts/xactimate_price_list/import_price_list.py <out> --price-list VAAR8X_NOV26            # dry run
python scripts/xactimate_price_list/import_price_list.py <out> --price-list VAAR8X_NOV26 --commit --database-url ...
```

The price month comes from the price list name (`VAAR8X_NOV26` → 2026-11).
Re-importing a month replaces that month's rows, category by category.
Items whose report is missing or doesn't add up are still loaded with the
catalog price and description only, and listed with `--notes`.
