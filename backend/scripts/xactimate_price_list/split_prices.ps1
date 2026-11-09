# Xactimate's own Replace and Remove price for R&R items whose market conditions the
# Price List Item Report gives only as one total (out\mc_items.tsv: cat, sel, R&R price).
# Reads Quick Entry's price panel; nothing is added to the estimate.
#   split_prices.ps1 [-List out\mc_items.tsv] [-Result out\split_prices.tsv]
param(
  [string]$Out = "$PSScriptRoot\out",
  [string]$List = "$PSScriptRoot\out\mc_items.tsv",
  [string]$Result = "$PSScriptRoot\out\split_prices.tsv",
  [int]$IdleSeconds = 30,
  [string]$Proc = 'Xactimate online Estimate Writer-G0'
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"
trap { Log "split_prices FATAL: $($_.Exception.Message)"; break }

# Quick Entry (Estimate Items screen, window maximized)
$QeCancel = @(1507, 607); $QeCat = @(865, 655); $QeSel = @(1045, 657); $QeDesc = @(1200, 698); $QePrice = @(1290, 740)
$ReplaceBox = @(1745, 690); $RemoveBox = @(1745, 733)

function CopyBox($x, $y) { ClearClip; Click $x $y; Start-Sleep -Milliseconds 100; Keys '^a'; Keys '^c'; Start-Sleep -Milliseconds 250; (Clip).Trim() }
function Money($s) { $v = 0.0; if ([double]::TryParse(($s -replace '[\$,]', ''), [ref]$v)) { $v } else { $null } }

$done = @{}
if (Test-Path $Result) { Get-Content $Result -Encoding UTF8 | ForEach-Object { $f = $_ -split "`t"; if ($f[2] -eq 'ok') { $done["$($f[0])`t$($f[1])"] = 1 } } }
$items = Get-Content $List -Encoding UTF8 | Where-Object { $_.Trim() } | ForEach-Object { $f = $_ -split "`t"; [pscustomobject]@{ Cat = $f[0]; Sel = $f[1]; Total = [double]$f[2] } }
Log "split_prices: $($items.Count) items, $($done.Count) already read"
$n = 0
foreach ($it in $items) {
  if ($done.ContainsKey("$($it.Cat)`t$($it.Sel)")) { continue }
  try { if (Guard) { CloseMenus } } catch {}
  $status = 'error'; $rep = ''; $rem = ''; $desc = ''
  for ($try = 0; $try -lt 2; $try++) {
    try {
      CloseMenus
      Click $QeCancel[0] $QeCancel[1]; Start-Sleep -Milliseconds 300           # empty Quick Entry first
      Click $QeCat[0] $QeCat[1]; Keys '^a'; Keys (Lit $it.Cat)
      Click $QeSel[0] $QeSel[1]; Keys '^a'; Keys ((Lit $it.Sel) + '{TAB}'); Start-Sleep -Milliseconds 1500
      $desc = CopyBox $QeDesc[0] $QeDesc[1]
      Click $QePrice[0] $QePrice[1]; Start-Sleep -Milliseconds 900
      $rep = CopyBox $ReplaceBox[0] $ReplaceBox[1]
      $rem = CopyBox $RemoveBox[0] $RemoveBox[1]
      Keys '{ESC}'
      $r = Money $rep; $m = Money $rem
      # Both parts must add up to the R&R price in the report, or this isn't the item we asked for.
      if ($null -ne $r -and $null -ne $m -and [math]::Abs($r + $m - $it.Total) -lt 0.006) { $status = 'ok'; break }
      $status = "mismatch: $rep + $rem vs $($it.Total)"
    } catch { $status = "error: $($_.Exception.Message)" }
  }
  Append $Result ("{0}`t{1}`t{2}`t{3}`t{4}`t{5}" -f $it.Cat, $it.Sel, $status, $rep, $rem, $desc)
  if ($status -ne 'ok') { Log "split_prices $($it.Cat) $($it.Sel) -> $status" }
  $n++; if ($n % 50 -eq 0) { Log "split_prices: $n read" }
}
CloseMenus
Click $QeCancel[0] $QeCancel[1]
Log "split_prices done: $n this run"
