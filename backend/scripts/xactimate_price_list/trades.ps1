# Reads each labor trade's breakdown from Xactimate: an item's Item Activity Information window
# shows its labor component split into Worker's Wage, Labor Burden and Labor Overhead. The
# three add up to the item's labor per unit; scaled by (rate per hour / labor per unit) they
# give the trade's hourly split, which is the same for every item of that trade (checked on
# two items per trade, 38 trades, VAAR8X_NOV26).
# Input out\trades_items.tsv (trades_list.py). Output out\labor_trades.tsv.
# Nothing is added to the estimate: Quick Entry is cancelled and the window is left with Esc.
param(
  [string]$Out = "$PSScriptRoot\out",
  [string]$List = '',
  [int]$MaxItems = 0,
  [int]$IdleSeconds = 30,
  [string]$Proc = 'Xactimate online Estimate Writer-G0'
)
$ErrorActionPreference = 'Stop'
if (-not $List) { $List = "$Out\trades_items.tsv" }
. "$PSScriptRoot\common.ps1"
trap { Log "trades FATAL: $($_.Exception.Message)"; break }
. "$PSScriptRoot\reader_helpers.ps1"
$OutFile = "$Out\labor_trades.tsv"
$DebugDir = "$Out\debug_trades"

# The i button on a price row (same as rmi.ps1): the longest run of its light-blue fill.
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
# Wait until the window stops changing height (it grows as it fills in).
function Settle($h) {
  $prev = -1; $same = 0; $t = [Environment]::TickCount
  while ([Environment]::TickCount - $t -lt 3000) {
    $r = Rect $h; $hh = $r.B - $r.T
    if ($hh -eq $prev) { $same++; if ($same -ge 3) { return $r } } else { $same = 0; $prev = $hh }
    Start-Sleep -Milliseconds 100
  }
  Rect $h
}
# Every dollar amount in an OCR'd string, after the usual slips (S for $, o for 0, l for 1).
function Moneys($s) {
  $s = $s -replace '[sS](?=\d)', '$' -replace '(?<=\d)[oO]', '0' -replace '(?<=\d)[lI|]', '1'
  @([regex]::Matches($s, '\$?\s?(\d{1,3}(?:,\d{3})*\.\d{2})') | ForEach-Object { [double]($_.Groups[1].Value -replace ',', '') })
}

$rows = Get-Content $List -Encoding UTF8 | Where-Object { $_.Trim() }
if ($MaxItems -gt 0) { $rows = $rows | Select-Object -First $MaxItems }
$head = "trade`tcategory`tselector`tside`tlabor_per_unit`trate_per_hour`twage_per_unit`tburden_per_unit`toverhead_per_unit`tretail`twage_per_hour`tburden_per_hour`toverhead_per_hour`tstatus`tseconds"
$res = @($head)
Log "trades: $(@($rows).Count) items listed"
foreach ($line in $rows) {
  $trade, $cat, $sel, $side, $sides, $lab, $cost = $line -split "`t"
  $lab = [double]$lab
  $t0 = [Environment]::TickCount
  $status = ''; $w = $null; $bu = $null; $ov = $null
  try { if (Guard) { CloseMenus } } catch {}
  try {
    CloseMenus
    Click $QeCancel[0] $QeCancel[1]; Start-Sleep -Milliseconds 300
    Click $QeCat[0] $QeCat[1]; Keys '^a'; Keys (Lit $cat)
    $descBefore = ScreenSig $DescArea
    Click $QeSel[0] $QeSel[1]; Keys '^a'; Keys ((Lit $sel) + '{TAB}')
    WaitRedraw $DescArea $descBefore 2500 | Out-Null
    Start-Sleep -Milliseconds 200
    Click $QePrice[0] $QePrice[1]; Start-Sleep -Milliseconds 500
    # an item with both activities shows Remove on the second row
    $rowY = if ($side -eq '-' -and $sides -eq '+-') { 735 } else { 692 }
    $ib = FindI $rowY
    if (-not $ib) { Start-Sleep -Milliseconds 500; $ib = FindI $rowY }
    if (-not $ib) { throw 'no i button' }
    Click $ib.X $rowY
    $d = WaitWin 'Item Activity Information' 5000
    if (-not $d) { throw 'no window' }
    Settle $d.H | Out-Null
    Start-Sleep -Milliseconds 200
    $bmp = Capture $d.H
    try {
      # Worker's Wage, Labor Burden, Labor Overhead boxes (x, width) on the window, y 226-258.
      # Several OCR settings are tried until the three amounts add up to the labor per unit.
      $boxes = @(@(415, 98), @(540, 110), @(660, 100))
      $vals = @($null, $null, $null)
      foreach ($cfg in @(@(235, 3), @(242, 3), @(230, 4), @(235, 2), @(245, 4))) {
        for ($i = 0; $i -lt 3; $i++) {
          if ($null -ne $vals[$i]) { continue }
          $m = @(Moneys (Ocr $bmp $boxes[$i][0] 226 $boxes[$i][1] 32 $cfg[0] $cfg[1]))
          if ($m.Count -eq 1) { $vals[$i] = $m[0] }
        }
        if (@($vals | Where-Object { $null -ne $_ }).Count -eq 3) {
          if ([math]::Abs([math]::Round($vals[0] + $vals[1] + $vals[2], 2) - $lab) -le 0.011) { break }
          $vals = @($null, $null, $null)
        }
      }
      if (@($vals | Where-Object { $null -ne $_ }).Count -eq 3) { $w = $vals[0]; $bu = $vals[1]; $ov = $vals[2]; $status = 'ok' }
      else {
        $status = "check: read $($vals -join '/') (want sum $lab)"
        New-Item -ItemType Directory -Force -Path $DebugDir | Out-Null
        $bmp.Save("$DebugDir\$trade`_$cat`_$(SafeName $sel).png", [System.Drawing.Imaging.ImageFormat]::Png)
      }
    } finally { $bmp.Dispose() }
    Keys '{ESC}'; WaitGone 'Item Activity Information' | Out-Null
  } catch { $status = "error: $($_.Exception.Message)"; try { CloseMenus } catch {} }
  $hrW = $null; $hrB = $null; $hrO = $null
  if ($null -ne $w) { $k = [double]$cost / $lab; $hrW = [math]::Round($w * $k, 2); $hrB = [math]::Round($bu * $k, 2); $hrO = [math]::Round($ov * $k, 2) }
  $o = "$trade`t$cat`t$sel`t$side`t$lab`t$cost`t$w`t$bu`t$ov`t`t$hrW`t$hrB`t$hrO`t$status`t$([math]::Round(([Environment]::TickCount - $t0) / 1000, 1))"
  Log "trades $trade $cat $sel -> $status"
  $res += $o
}
[System.IO.File]::WriteAllLines($OutFile, [string[]]$res, (New-Object System.Text.UTF8Encoding $false))
Log "trades done: $(@($rows).Count) items -> $OutFile"
