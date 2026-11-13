# Pictures of the component code and supporting event boxes, to be read by eye where OCR missed or
# misread the code (see README: supporting events). For each listed row: Quick Entry -> unit price ->
# i -> the row -> Assembly Info, and the boxes are saved as <Dir>\CAT_SEL_P|M_ROW.png.
# Input: event_targets.py's list (cat, sel, sides, side, row, key, cached event, why).
# Look only: every window is left with Esc and Quick Entry is cancelled; nothing is added.
param(
  [string]$Out = "$PSScriptRoot\out",
  [string]$List = '',
  [string]$Dir = '',
  [int]$IdleSeconds = 30,
  [string]$Proc = 'Xactimate online Estimate Writer-G0'
)
$ErrorActionPreference = 'Stop'
if (-not $List) { $List = "$Out\event_targets.tsv" }
if (-not $Dir) { $Dir = "$Out\event_pictures" }
. "$PSScriptRoot\common.ps1"
trap { Log "event_pictures FATAL: $($_.Exception.Message)"; break }
. "$PSScriptRoot\reader_helpers.ps1"
function Settle($h) {
  $prev = -1; $same = 0; $t = [Environment]::TickCount
  while ([Environment]::TickCount - $t -lt 3000) {
    $r = Rect $h; $hh = $r.B - $r.T
    if ($hh -eq $prev) { $same++; if ($same -ge 3) { return $r } } else { $same = 0; $prev = $hh }
    Start-Sleep -Milliseconds 100
  }
  Rect $h
}
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Row1 = @(300, 422)
function TabY($bmp) {
  $x = $bmp.Width - 120; $run = 0
  for ($y = 380; $y -lt $bmp.Height - 60; $y++) {
    $c = $bmp.GetPixel($x, $y)
    if ($c.R -eq 223 -and $c.G -eq 233 -and $c.B -eq 245) { $run++; if ($run -ge 15) { return $y - $run + 1 + 18 } } else { $run = 0 }
  }
  return 0
}
function FindI([int]$y = 692) {
  $b = New-Object System.Drawing.Bitmap 200, 40; $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(1740, $y - 20, 0, 0, $b.Size); $g.Dispose()
  $best = $null
  foreach ($yy in 30, 29, 31) { $run = 0; $start = 0
    for ($x = 0; $x -lt 200; $x++) { $c = $b.GetPixel($x, $yy)
      $hit = [math]::Abs($c.R - 220) -le 6 -and [math]::Abs($c.G - 231) -le 6 -and [math]::Abs($c.B - 245) -le 6
      if ($hit) { if (-not $run) { $start = $x }; $run++ }
      if (-not $hit -or $x -eq 199) { if ($run -ge 20 -and (-not $best -or $run -gt $best.Len)) { $best = [pscustomobject]@{ X = 1740 + $start + [int]($run / 2); Len = $run } }; $run = 0 } }
    if ($best) { break } }
  $b.Dispose(); $best
}
function FirstRow($r) {
  if ($r.T + $Row1[1] -ge 5) { Click ($r.L + $Row1[0]) ($r.T + $Row1[1]) }
  else { $k0 = [math]::Ceiling((5 - $r.T - $Row1[1]) / 30); Click ($r.L + $Row1[0]) ($r.T + $Row1[1] + 30 * $k0); Start-Sleep -Milliseconds 120; Keys '^{HOME}' }
  Start-Sleep -Milliseconds 150
}
$rows = Get-Content $List -Encoding UTF8 | Where-Object { $_.Trim() } | ForEach-Object {
  $f = $_ -split "`t"; [pscustomobject]@{ Cat = $f[0]; Sel = $f[1]; Sides = $f[2]; Act = $f[3]; Row = [int]$f[4] }
}
$groups = $rows | Group-Object { "$($_.Cat)`t$($_.Sel)`t$($_.Act)" }
$n = 0
Log "event_pictures: $(@($rows).Count) rows, $(@($groups).Count) windows"
foreach ($g in $groups) {
  $it = $g.Group[0]
  if (Test-Path "$Out\STOP") { break }
  try { if (Guard) { CloseMenus } } catch {}
  $status = 'ok'
  try {
    CloseMenus
    Click $QeCancel[0] $QeCancel[1]; Start-Sleep -Milliseconds 300
    Click $QeCat[0] $QeCat[1]; Keys '^a'; Keys (Lit $it.Cat)
    $descBefore = ScreenSig $DescArea
    Click $QeSel[0] $QeSel[1]; Keys '^a'; Keys ((Lit $it.Sel) + '{TAB}')
    WaitRedraw $DescArea $descBefore 2500 | Out-Null; Start-Sleep -Milliseconds 300
    Click $QePrice[0] $QePrice[1]; Start-Sleep -Milliseconds 500
    $rowY = if ($it.Act -eq '-' -and $it.Sides -eq '+-') { 735 } else { 692 }
    $ib = FindI $rowY; if (-not $ib) { Start-Sleep -Milliseconds 500; $ib = FindI $rowY }
    if (-not $ib) { throw 'no i button' }
    Click $ib.X $rowY
    $d = WaitWin 'Item Activity Information' 5000
    if (-not $d) { throw 'no window' }
    $r = Settle $d.H
    for ($try = 0; $try -lt 3 -and ($r.B - $r.T) -lt 500; $try++) { Start-Sleep -Milliseconds (200 * $try); Click ($r.L + 45) ($r.T + 331); Start-Sleep -Milliseconds 200; $r = Settle $d.H }
    $tabY = 0
    for ($try = 0; $try -lt 5 -and -not $tabY; $try++) { if ($try) { Start-Sleep -Milliseconds 300 }; $bmp = Capture $d.H; try { $tabY = TabY $bmp } finally { $bmp.Dispose() } }
    $screenH = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height
    if (-not $tabY -and $r.B -gt $screenH) {
      [PW]::SetWindowPos($d.H, [IntPtr]::Zero, $r.L, ($screenH - ($r.B - $r.T) - 10), 0, 0, 0x0001 -bor 0x0004) | Out-Null
      Start-Sleep -Milliseconds 400; $r = Rect $d.H
      for ($try = 0; $try -lt 3 -and -not $tabY; $try++) { if ($try) { Start-Sleep -Milliseconds 300 }; $bmp = Capture $d.H; try { $tabY = TabY $bmp } finally { $bmp.Dispose() } }
    }
    if (-not $tabY) { throw 'tabs not found' }
    if ($r.T + $tabY + 175 -gt $screenH) {
      [PW]::SetWindowPos($d.H, [IntPtr]::Zero, $r.L, ($screenH - $tabY - 180), 0, 0, 0x0001 -bor 0x0004) | Out-Null
      Start-Sleep -Milliseconds 300; $r = Rect $d.H
    }
    Click ($r.L + 175) ($r.T + $tabY); Start-Sleep -Milliseconds 200
    FirstRow $r
    $at = 1
    foreach ($x in ($g.Group | Sort-Object Row)) {
      if ($x.Row -gt $at) { Keys "{DOWN $($x.Row - $at)}"; $at = $x.Row }
      Start-Sleep -Milliseconds 350
      $bmp = Capture $d.H
      try {
        $crop = $bmp.Clone((New-Object System.Drawing.Rectangle 28, ($tabY + 50), 560, 112), $bmp.PixelFormat)
        $crop.Save("$Dir\$($x.Cat)_$(SafeName $x.Sel)_$(if ($x.Act -eq '+') { 'P' } else { 'M' })_$($x.Row).png", [System.Drawing.Imaging.ImageFormat]::Png); $crop.Dispose()
      } finally { $bmp.Dispose() }
      $n++
    }
    Keys '{ESC}'; if (-not (WaitGone 'Item Activity Information')) { Keys '{ESC}'; WaitGone 'Item Activity Information' | Out-Null }
  } catch { $status = "error: $($_.Exception.Message)"; try { Keys '{ESC}'; CloseMenus } catch {} }
  if ($status -ne 'ok') { Log "event_pictures $($it.Cat) $($it.Sel) $($it.Act) -> $status" }
}
Click $QeCancel[0] $QeCancel[1]
Log "event_pictures done: $n pictures"
