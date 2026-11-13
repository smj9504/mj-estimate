# Reads each item's other activities from Quick Entry: R (Detach & Reset), M (Material Only) and
# I (Install Only) - which of them the item offers, each one's price, and R's own Price List Item
# Report (Item Activity Information -> Preview), whose components and yields differ from replace.
# M and I are the replace side's material and labor/equipment components (checked on 70 reports),
# so only their prices are read; they're checked against those components here.
# Input out\rmi_items.tsv: cat, sel, replace material, replace labor+equipment, market conditions.
# Output out\rmi_index.tsv (one line per item read) and out\pdf_rmi\CAT\SEL.R.pdf.
# Nothing is added to the estimate: Quick Entry is cancelled and every window is left with Esc.
param(
  [string]$Out = "$PSScriptRoot\out",
  [string]$List = '',
  [int]$MaxItems = 0,
  [string]$Only = '',            # "CAT SEL[,CAT SEL...]" to read just these items (testing)
  [int]$IdleSeconds = 30,
  [string]$Proc = 'Xactimate online Estimate Writer-G0'
)
$ErrorActionPreference = 'Stop'
if (-not $List) { $List = "$Out\rmi_items.tsv" }
. "$PSScriptRoot\common.ps1"
trap { Log "rmi FATAL: $($_.Exception.Message)"; break }
. "$PSScriptRoot\reader_helpers.ps1"

$PanelArea = @(1560, 670, 400, 90)       # Quick Entry's price panel: redraws when the activity changes
$PdfDir = "$Out\pdf_rmi"
$index = "$Out\rmi_index.tsv"

# The i button on a price row: the longest run of the button's light-blue fill near its bottom
# edge. Where it sits depends on the row's label (Reset Price is shorter than Replace Price).
function FindI([int]$y = 692) {
  $b = New-Object System.Drawing.Bitmap 200, 40; $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(1740, $y - 20, 0, 0, $b.Size); $g.Dispose()
  $best = $null
  try {
    foreach ($yy in 30, 29, 31) {
      $run = 0; $start = 0
      for ($x = 0; $x -lt 200; $x++) {
        $c = $b.GetPixel($x, $yy)
        $hit = [math]::Abs($c.R - 220) -le 6 -and [math]::Abs($c.G - 231) -le 6 -and [math]::Abs($c.B - 245) -le 6
        if ($hit) { if (-not $run) { $start = $x }; $run++ }
        if (-not $hit -or $x -eq 199) { if ($run -ge 20 -and (-not $best -or $run -gt $best.Len)) { $best = [pscustomobject]@{ X = 1740 + $start + [int]($run / 2); Len = $run } }; $run = 0 }
      }
      if ($best) { break }
    }
  } finally { $b.Dispose() }
  $best
}

# The darkest pixel of Quick Entry's Act box arrow: ~59 when the box opens a list, ~196 when it's
# greyed out (the item has one activity).
function ActArrow {
  $b = New-Object System.Drawing.Bitmap 30, 20; $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(1215, 646, 0, 0, $b.Size); $g.Dispose()
  $min = 255
  try { for ($x = 0; $x -lt 30; $x++) { for ($y = 0; $y -lt 20; $y++) { $c = $b.GetPixel($x, $y); $l = [int](($c.R + $c.G + $c.B) / 3); if ($l -lt $min) { $min = $l } } } } finally { $b.Dispose() }
  $min
}

# Pick an activity by its letter: the Act list jumps to the line starting with it.
function Pick($letter, [bool]$listOpen = $false) {
  $before = ScreenSig $PanelArea
  if (-not $listOpen) { Click $QeAct[0] $QeAct[1]; Start-Sleep -Milliseconds 180 }
  Keys $letter.ToLower(); Keys '{ENTER}'
  $ms = WaitRedraw $PanelArea $before 2000
  if ($ms -lt 0) { Start-Sleep -Milliseconds 300 }
  $ms
}

# With R picked: open its Item Activity window, Preview, keep the PDF.
function ReportR($dest) {
  $ib = FindI 692
  if (-not $ib) { Click $QePrice[0] $QePrice[1]; Start-Sleep -Milliseconds 600; $ib = FindI 692 }
  if (-not $ib) { return 'no i button' }
  Click $ib.X 692
  $d = WaitWin 'Item Activity Information' 5000
  if (-not $d) { return 'no window' }
  $t0 = Get-Date
  $r = Rect $d.H
  for ($i = 0; $i -lt 10 -and ($r.B - $r.T) -lt 300; $i++) { Start-Sleep -Milliseconds 100; $r = Rect $d.H }
  Click ($r.R - 348) ($r.T + 373)                          # Preview (Preview / OK / Cancel, anchored right)
  $pdf = $null; $t = [Environment]::TickCount
  while ([Environment]::TickCount - $t -lt 10000) {
    $pdf = Get-ChildItem $TempDir -Recurse -Filter '*.pdf' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $t0 -and $_.Length -gt 0 } | Select-Object -First 1
    if ($pdf) { break }; Start-Sleep -Milliseconds 100
  }
  Start-Sleep -Milliseconds 150
  if ($pdf) { New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null; Copy-Item $pdf.FullName $dest -Force; $script:spent += (Split-Path $pdf.FullName) }
  Keys '{ESC}'
  if (-not (WaitGone 'Item Activity Information')) { Keys '{ESC}'; WaitGone 'Item Activity Information' | Out-Null }
  if ($pdf) { 'ok' } else { 'no pdf' }
}

# --- what's been read ---------------------------------------------------------------------------------
$done = @{}
if (Test-Path $index) { Get-Content $index -Encoding UTF8 | ForEach-Object { $f = $_ -split "`t"; if ($f.Count -ge 7 -and $f[6] -notlike 'error*') { $done["$($f[0])`t$($f[1])"] = 1 } } }
$items = Get-Content $List -Encoding UTF8 | Where-Object { $_.Trim() } | ForEach-Object {
  $f = $_ -split "`t"; [pscustomobject]@{ Cat = $f[0]; Sel = $f[1]; Mat = [double]$f[2]; Lab = [double]$f[3]; Mc = [double]$f[4] }
}
if ($Only) {
  $want = @($Only -split ',' | ForEach-Object { $_.Trim() })
  $items = @($items | Where-Object { $want -ccontains "$($_.Cat) $($_.Sel)" }); $done = @{}
} else {
  $others = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-File\s+"?[^"]*\\(rmi|details)\.ps1' -and $_.CommandLine -notmatch '-Only' })
  if ($others.Count) { Log "rmi: another reader is already running (pid $($others[0].ProcessId)) - this one exits"; exit 3 }
}
Log "rmi: $($items.Count) items listed, $($done.Count) already read"
$n = 0; $streak = 0
foreach ($it in $items) {
  if ($done.ContainsKey("$($it.Cat)`t$($it.Sel)")) { continue }
  if ($MaxItems -gt 0 -and $n -ge $MaxItems) { break }
  try { if (Guard) { CloseMenus } } catch {}
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    $t0 = Get-Date
    $avail = ''; $price = @{ R = ''; M = ''; I = '' }; $checks = @(); $status = 'ok'
    try {
      CloseMenus
      Click $QeCancel[0] $QeCancel[1]; Start-Sleep -Milliseconds 200
      Click $QeCat[0] $QeCat[1]; Keys '^a'; Keys (Lit $it.Cat)
      $descBefore = ScreenSig $DescArea
      Click $QeSel[0] $QeSel[1]; Keys '^a'; Keys ((Lit $it.Sel) + '{TAB}')
      $loadMs = WaitRedraw $DescArea $descBefore 2500
      Start-Sleep -Milliseconds $(if ($loadMs -lt 0) { 300 } else { 150 })
      # Which activities the item has: read the open Act list. An item with one activity has its
      # Act box greyed out (arrow ~196 grey, ~59 when it opens); the list can be slow to open.
      $names = ''; $open = $false
      $arrow = ActArrow
      for ($look = 0; $look -lt 2 -and $arrow -ge 130; $look++) { Start-Sleep -Milliseconds 300; $arrow = ActArrow }   # not drawn yet?
      if ($arrow -lt 130) {
        for ($look = 0; $look -lt 4 -and $names -notmatch 'Replace|Remove|Install|Material|Detach'; $look++) {
          if ($look -eq 0 -or $look -eq 2) {
            $listBefore = ScreenSig $ActList; Click $QeAct[0] $QeAct[1]
            if ((WaitRedraw $ActList $listBefore 1200 1) -lt 0) { Start-Sleep -Milliseconds 200 } else { Start-Sleep -Milliseconds 100 }
          } else { Start-Sleep -Milliseconds 400 }
          $b = New-Object System.Drawing.Bitmap $ActList[2], $ActList[3]
          $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($ActList[0], $ActList[1], 0, 0, $b.Size); $g.Dispose()
          try { $names = (Ocr $b 0 0 $b.Width $b.Height 0 2) -replace "`n", ' | ' } finally { $b.Dispose() }
        }
        if ($names -notmatch 'Replace|Remove|Install|Material|Detach') { throw "Act list didn't open" }
        $open = $true
      }
      if ($names -match 'Detach') { $avail += 'R' }
      if ($names -match 'Material Only') { $avail += 'M' }
      if ($names -match 'Install Only') { $avail += 'I' }
      if ($open -and -not $avail) { Click $QeAct[0] $QeAct[1]; Start-Sleep -Milliseconds 150; $open = $false }   # + / - / & only
      foreach ($a in @($avail.ToCharArray() | ForEach-Object { [string]$_ })) {
        $ms = Pick $a $open; $open = $false
        $p = $null
        for ($look = 0; $look -lt 3 -and $null -eq $p; $look++) { if ($look) { Start-Sleep -Milliseconds 300 }; $p = Money (CopyBox $ReplaceBox[0] $ReplaceBox[1]) }
        $price[$a] = $p
        if ($null -eq $p) { $checks += "$a price unread" }
        elseif ($a -eq 'M' -and [math]::Abs($p - $it.Mat) -gt 0.5 + 0.05 * $it.Mat) { $checks += "M $p vs replace material $($it.Mat)" }
        elseif ($a -eq 'I' -and [math]::Abs($p - $it.Lab) -gt 0.5 + 0.05 * $it.Lab + $it.Mc) { $checks += "I $p vs replace labor $($it.Lab)" }
        if ($a -eq 'R') {
          $rs = ReportR "$PdfDir\$(FileCat $it.Cat)\$(SafeName $it.Sel).R.pdf"
          if ($rs -ne 'ok') { $checks += "R report: $rs" }
        }
      }
      if ($checks.Count) { $status = "check: $($checks -join '; ')" }
    } catch {
      $status = "error: $($_.Exception.Message)"; try { CloseMenus } catch {}
    }
    if ([X]::LastInput() -gt $script:ourInput + 200) { $status = 'error: the PC was used during this item'; try { CloseMenus } catch {}; break }
    # Passing trouble (no i button / window / pdf, a price that didn't copy): read the item once more.
    if ($attempt -eq 0 -and $status -match 'unread|no i button|no window|no pdf|error') { Log "rmi $($it.Cat) $($it.Sel) -> reading again: $status"; continue }
    break
  }
  $sec = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  Append $index ("{0}`t{1}`t{2}`t{3}`t{4}`t{5}`t{6}`t{7}`t{8}" -f $it.Cat, $it.Sel, $avail, $price.R, $price.M, $price.I, $status, (Get-Date -Format s), $sec)
  if ($status -ne 'ok') { Log "rmi $($it.Cat) $($it.Sel) -> $status" }
  if ($status -like 'error*' -and $status -notlike '*PC was used*') { $streak++ } else { $streak = 0 }
  if ($streak -ge 3) {
    New-Item -ItemType File -Force -Path "$Out\PAUSE" | Out-Null
    Log "3 failures in a row - paused; check Xactimate (logged off?), then run resume"
    $streak = 0
  }
  $n++
  if ($n % 10 -eq 0) { try { ClosePdfTabs } catch {} }
  if ($n % 50 -eq 0) { Log "rmi: $n items this run ($($it.Cat))" }
}
try { ClosePdfTabs } catch {}
CloseMenus
Log "rmi done: $n items this run"
