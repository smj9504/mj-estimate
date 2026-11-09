# Reads what the Price List Item Report leaves out, from each item's Item Activity Information
# windows (Quick Entry -> unit price -> i next to Replace Price / Remove Price):
#   phase, worker's wage / labor burden / labor overhead, market conditions (each side),
#   component descriptions, supporting event code per component and the event's text,
#   minimum group, Xactimate's own replace and remove price.
# Input out\details_items.tsv (details_list.py); output out\details.jsonl, one line per item.
# Nothing is added to the estimate: every window is left with Esc (Cancel).
param(
  [string]$Out = "$PSScriptRoot\out",
  [string]$List = '',
  [string]$Result = '',
  [int]$MaxItems = 0,
  [string]$Only = '',            # "CAT SEL[,CAT SEL...]" to read just these items (testing)
  [string]$DebugDir = '',        # save window pictures here when something isn't found
  [int]$IdleSeconds = 30,
  [string]$Proc = 'Xactimate online Estimate Writer-G0'
)
$ErrorActionPreference = 'Stop'
if (-not $List) { $List = "$Out\details_items.tsv" }
if (-not $Result) { $Result = "$Out\details.jsonl" }
. "$PSScriptRoot\common.ps1"
trap { Log "details FATAL: $($_.Exception.Message)"; break }
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class PW {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
}
"@

# --- OCR (Windows.Media.Ocr), loaded once ----------------------------------------------------------
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
$ocrTmp = Join-Path $env:TEMP "xact_ocr_$PID.png"

function Capture($h) {
  $r = Rect $h; $w = $r.R - $r.L; $hh = $r.B - $r.T
  $bmp = New-Object System.Drawing.Bitmap $w, $hh
  $g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
  [PW]::PrintWindow($h, $hdc, 2) | Out-Null; $g.ReleaseHdc($hdc); $g.Dispose()
  $bmp
}
# OCR part of a captured window. Threshold > 0 turns everything darker than it black (greyed-out text).
function Ocr($bmp, [int]$x, [int]$y, [int]$w, [int]$h, [int]$threshold = 0, [double]$scale = 3) {
  if ($x -lt 0) { $x = 0 }; if ($y -lt 0) { $y = 0 }
  if ($x + $w -gt $bmp.Width) { $w = $bmp.Width - $x }; if ($y + $h -gt $bmp.Height) { $h = $bmp.Height - $y }
  if ($w -le 2 -or $h -le 2) { return '' }
  $big = New-Object System.Drawing.Bitmap ([int]($w * $scale)), ([int]($h * $scale))
  $g = [System.Drawing.Graphics]::FromImage($big); $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $big.Width, $big.Height), (New-Object System.Drawing.Rectangle $x, $y, $w, $h), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  if ($threshold -gt 0) {
    $rect = New-Object System.Drawing.Rectangle 0, 0, $big.Width, $big.Height
    $data = $big.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $n = $data.Stride * $big.Height; $px = New-Object byte[] $n
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $px, 0, $n)
    for ($i = 0; $i -lt $n; $i += 4) {
      $l = 0.114 * $px[$i] + 0.587 * $px[$i + 1] + 0.299 * $px[$i + 2]
      $v = if ($l -lt $threshold) { 0 } else { 255 }
      $px[$i] = $v; $px[$i + 1] = $v; $px[$i + 2] = $v; $px[$i + 3] = 255
    }
    [System.Runtime.InteropServices.Marshal]::Copy($px, 0, $data.Scan0, $n); $big.UnlockBits($data)
  }
  $big.Save($ocrTmp, [System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ocrTmp)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($ocrEngine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
    $script:lastOcr = $res
    (@($res.Lines | ForEach-Object { $_.Text }) -join "`n").Trim()
  } finally { $stream.Dispose() }
}
# Like Ocr, but every word with where it sits in the crop (original pixels): X, Y, Text.
function OcrWords($bmp, [int]$x, [int]$y, [int]$w, [int]$h, [int]$threshold, [double]$scale) {
  $script:wantWords = $true
  try { Ocr $bmp $x $y $w $h $threshold $scale | Out-Null } finally { $script:wantWords = $false }
  foreach ($line in $script:lastOcr.Lines) {
    foreach ($wd in $line.Words) { [pscustomobject]@{ X = $wd.BoundingRect.X / $scale; Y = ($wd.BoundingRect.Y + $wd.BoundingRect.Height / 2) / $scale; Text = $wd.Text } }
  }
}
# OCR'd money: "so.ll" -> 0.11, "$26.38" -> 26.38
function OcrMoney($s) {
  $t = ($s -replace '[sS\$]', '' -replace '[lIi|]', '1' -replace '[oO]', '0' -replace ',', '' -replace '\s', '')
  $v = 0.0; if ([double]::TryParse($t, [ref]$v)) { [math]::Round($v, 2) } else { $null }
}
function SafeName($s) { ($s.ToCharArray() | ForEach-Object { if ('\/:*?"<>|%'.Contains([string]$_)) { '%{0:X2}' -f [int]$_ } else { [string]$_ } }) -join '' }
function Money($s) { $v = 0.0; if ([double]::TryParse(($s -replace '[\$,\s]', ''), [ref]$v)) { $v } else { $null } }
function CopyBox($x, $y) { ClearClip; Click $x $y; Start-Sleep -Milliseconds 100; Keys '^a'; Keys '^c'; Start-Sleep -Milliseconds 220; $c = Clip; if ($c -eq '<<empty>>') { '' } else { $c.Trim() } }

# --- screen positions (Estimate Items, window maximized at 0,0, 2560x1528) ---------------------------
$QeCancel = @(1507, 607); $QeCat = @(865, 655); $QeSel = @(1045, 657); $QePrice = @(1290, 740)
$ReplaceBox = @(1745, 690); $RemoveBox = @(1745, 733); $ReplaceI = @(1862, 692); $RemoveI = @(1862, 735)
$MinGroup = @(2010, 766, 96, 28)           # x, y, w, h on the main window (text only, not the arrow)
# Act list: + Replace, - Remove, R Detach & Reset, & Remove and Replace, M Material Only, I Install
# Only - but an item lists only the activities it has (CAB CTMSB has no R), so the wanted line is
# found by reading the open list, not by its usual place.
$QeAct = @(1210, 656); $ActList = @(1150, 672, 330, 260)   # x, y, w, h on screen below the box
function PickAct($want) {
  Click $QeAct[0] $QeAct[1]; Start-Sleep -Milliseconds 600
  $b = New-Object System.Drawing.Bitmap $ActList[2], $ActList[3]
  $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($ActList[0], $ActList[1], 0, 0, $b.Size); $g.Dispose()
  try { Ocr $b 0 0 $b.Width $b.Height 0 2 | Out-Null } finally { $b.Dispose() }
  foreach ($line in $script:lastOcr.Lines) {
    $text = $line.Text.Trim()
    $hit = switch ($want) {
      '&' { $text -match 'Remove and Replace' }
      '+' { $text -match 'Replace$' -and $text -notmatch 'Remove' }
      '-' { $text -match 'Remove$' -and $text -notmatch 'Replace' }
    }
    if ($hit) {
      $words = @($line.Words); $wd = $words[$words.Count - 1]   # a WinRT list: no .Count of its own
      Click ($ActList[0] + 130) ($ActList[1] + [int](($wd.BoundingRect.Y + $wd.BoundingRect.Height / 2) / 2))
      return $true
    }
  }
  Keys '{ESC}'
  $false
}
# Item Activity Information window (relative to its top-left)
$DetailsToggle = @(45, 331); $Row1 = @(300, 422); $McBox = @(270, 245)
$TabAssembly = 175; $TabEvents = 306

# The tab strip's background, 18 px above the tab labels; the window grows with the
# components and the definition text, so it is looked for, not assumed.
function TabY($bmp) {
  $x = $bmp.Width - 120; $run = 0
  for ($y = 380; $y -lt $bmp.Height - 60; $y++) {
    $c = $bmp.GetPixel($x, $y)
    if ($c.R -eq 223 -and $c.G -eq 233 -and $c.B -eq 245) { $run++; if ($run -ge 15) { return $y - $run + 1 + 18 } } else { $run = 0 }
  }
  return 0
}

# --- what's been read ---------------------------------------------------------------------------------
$index = "$Out\details_index.tsv"
$done = @{}
# Done: read ok, or read with something to check - unless what went wrong was passing
# (a missed copy, a window that didn't open): those are read again.
$Passing = "copied|no window|details did not open|tabs not found"
if (Test-Path $index) { Get-Content $index -Encoding UTF8 | ForEach-Object { $f = $_ -split "`t"; if ($f[2] -like 'ok*' -or ($f[2] -like 'check*' -and $f[2] -notmatch $Passing)) { $done["$($f[0])`t$($f[1])"] = 1 } } }
# (category, side, component, SPT%) -> supporting event code, and event code -> text, across runs
$eventOf = @{}; $eventText = @{}
$evFile = "$Out\details_events.tsv"; $txFile = "$Out\details_event_texts.tsv"
if (Test-Path $evFile) { Get-Content $evFile -Encoding UTF8 | ForEach-Object { $f = $_ -split "`t"; if ($f.Count -ge 5) { $eventOf["$($f[0])|$($f[1])|$($f[2])|$($f[3])"] = $f[4] } } }
if (Test-Path $txFile) { Get-Content $txFile -Encoding UTF8 | ForEach-Object { $f = $_ -split "`t", 2; if ($f.Count -eq 2) { $eventText[$f[0]] = $f[1] } } }

# Same OCR look-alikes: I/l/1, O/0
function Norm($s) { ($s -replace '[Il|]', '1' -replace 'O', '0').ToUpper() }
# Wait until the window has stopped changing size (it first reports its last size, then lays out).
function Settle($h) {
  $prev = -1; $same = 0; $t = [Environment]::TickCount
  while ([Environment]::TickCount - $t -lt 3000) {
    $r = Rect $h; $hh = $r.B - $r.T
    if ($hh -eq $prev) { $same++; if ($same -ge 3) { return $r } } else { $same = 0; $prev = $hh }
    Start-Sleep -Milliseconds 100
  }
  Rect $h
}

# OCR can't tell O from 0: an event code usually starts with the component's code or the
# category (DMO2-LAB, CAB-LAB), so those letters are taken from the report.
function FixEv($ev, $code, $cat) {
  foreach ($pre in @($code, $cat)) {
    if ($pre -and $ev.Length -ge $pre.Length -and (Norm $ev.Substring(0, $pre.Length)) -eq (Norm $pre)) { return $pre + $ev.Substring($pre.Length) }
  }
  $ev
}

# Select the components grid's first row (it can be above the screen when the window was moved up:
# then click the first visible row and go to the top).
function FirstRow($r) {
  if ($r.T + $Row1[1] -ge 5) { Click ($r.L + $Row1[0]) ($r.T + $Row1[1]) }
  else {
    $k0 = [math]::Ceiling((5 - $r.T - $Row1[1]) / 30)
    Click ($r.L + $Row1[0]) ($r.T + $Row1[1] + 30 * $k0); Start-Sleep -Milliseconds 120; Keys '^{HOME}'
  }
  Start-Sleep -Milliseconds 150
}

function ReadSide($cat, $sel, $sideAct, $comps, $iPos) {
  $comps = @($comps)   # one component comes through as a lone object, which has no Count in PowerShell 5.1
  $o = [ordered]@{ side = $(if ($sideAct -eq '+') { 'replace' } else { 'remove' }); checks = @() }
  Click $iPos[0] $iPos[1]
  $d = WaitWin 'Item Activity Information' 5000
  if (-not $d) { $o.checks += 'no window'; return $o }
  $r = Settle $d.H
  for ($try = 0; $try -lt 3 -and ($r.B - $r.T) -lt 500; $try++) {
    Start-Sleep -Milliseconds (200 * $try)
    Click ($r.L + $DetailsToggle[0]) ($r.T + $DetailsToggle[1])
    Start-Sleep -Milliseconds 200
    $r = Settle $d.H
  }
  if (($r.B - $r.T) -lt 500) { $o.checks += 'details did not open'; Keys '{ESC}'; WaitGone 'Item Activity Information' | Out-Null; return $o }
  # Worker's wage / burden / overhead aren't read here: they are a fixed split of each labor
  # trade's rate (trades.ps1 reads it once per trade), and OCR misreads the short grey amounts.
  $tabY = 0
  for ($try = 0; $try -lt 5 -and -not $tabY; $try++) {
    if ($try) { Start-Sleep -Milliseconds 300 }      # still redrawing after Details opened
    $bmp = Capture $d.H
    try {
      $w = $bmp.Width
      if (-not $o.phase) {
        $phaseLine = (Ocr $bmp 500 60 ($w - 530) 36 235) -replace "`n", ' '
        $o.phase = (($phaseLine -replace '^.*?Phase:?\s*', '') -replace '[^\w\)]+$', '').Trim()
      }
      $tabY = TabY $bmp
      if (-not $tabY -and $try -eq 4 -and $DebugDir) { $bmp.Save("$DebugDir\$cat-$(SafeName $sel)-$($o.side)-notabs.png") }
    } finally { $bmp.Dispose() }
  }
  $o.market_conditions = Money (CopyBox ($r.L + $McBox[0]) ($r.T + $McBox[1]))
  if (-not $tabY) { $o.checks += 'tabs not found'; Keys '{ESC}'; WaitGone 'Item Activity Information' | Out-Null; return $o }

  # A window with many components is taller than the screen and its tabs are below the bottom
  # edge: move it up until they and the Assembly Info under them are on screen.
  $screenH = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height
  if ($r.T + $tabY + 175 -gt $screenH) {
    [PW]::SetWindowPos($d.H, [IntPtr]::Zero, $r.L, ($screenH - $tabY - 180), 0, 0, 0x0001 -bor 0x0004) | Out-Null   # NOSIZE | NOZORDER
    Start-Sleep -Milliseconds 300; $r = Rect $d.H
  }
  # Components: copy each row; read Assembly Info where this component's event isn't known yet.
  Click ($r.L + $TabAssembly) ($r.T + $tabY); Start-Sleep -Milliseconds 200
  FirstRow $r
  $rows = @(); $needText = @{}
  for ($k = 0; $k -lt $comps.Count; $k++) {
    $c = $comps[$k]
    ClearClip; Keys '^c'; Start-Sleep -Milliseconds 200
    $f = (Clip) -split "`t"
    $row = [ordered]@{ code = $c.Code; kind = $c.Kind; type = $f[0]; description = $(if ($f.Count -gt 1) { $f[1] } else { '' }); price_per_unit = $(if ($f.Count -gt 2) { Money $f[2] } else { $null }) }
    if ($null -eq $row.price_per_unit -or [math]::Abs([math]::Round($row.price_per_unit, 2) - $c.Price) -gt 0.011) {
      $o.checks += "row $($k + 1) $($c.Code): copied '$((Clip) -replace "`t", ' | ')'"
      if ($DebugDir -and -not $o.debugSaved) { $b7 = Capture $d.H; $b7.Save("$DebugDir\$cat-$(SafeName $sel)-$($o.side)-copy$($k + 1).png"); $b7.Dispose(); $o.debugSaved = $true }
    }
    $key = "$cat|$sideAct|$($c.Code)|$($c.Spt)"
    if ($c.Spt -ne '0.000' -and -not $eventOf.ContainsKey($key)) {
      Start-Sleep -Milliseconds 150
      $b2 = Capture $d.H
      try {
        # The labels and the boxes together: OCR gives up on a short code alone in its box.
        # Lines come back as "Component Code:", "Supporting Events:", code, event, "(39.583)".
        # Crop from the labels' left edge (x 28) to the boxes' right edge: the boxes start at
        # x 194 in the crop; code box centre ~12 px down, event box ~46, "(39.583)" ~72.
        $reads = foreach ($cfg in @(@(235, 2), @(242, 3))) {
          $ws = @(OcrWords $b2 28 ($tabY + 55) 340 92 $cfg[0] $cfg[1])
          $val = { param($y0, $y1) (@($ws | Where-Object { $_.X -ge 180 -and $_.Y -ge $y0 -and $_.Y -lt $y1 } | Sort-Object X | ForEach-Object { $_.Text }) -join '') }
          [pscustomobject]@{
            Code = (& $val 0 29)
            Ev = (& $val 29 59)
            Spt = ((@($ws | Where-Object { $_.Y -ge 59 -and $_.Text -match '^\(' }) | Select-Object -First 1).Text -replace '[^\d\.]', '')
          }
        }
      } finally { $b2.Dispose() }
      $code = $reads[0].Code; if (-not $code -or (Norm $code) -ne (Norm $c.Code)) { if ((Norm $reads[1].Code) -eq (Norm $c.Code)) { $code = $reads[1].Code } }
      $spt = if ($reads[0].Spt) { $reads[0].Spt } else { $reads[1].Spt }
      # The event code: the two reads agree, or more reads of the event box alone are taken and
      # the code read most often (at least twice) wins; otherwise it's left for review.
      $votes = @($reads | ForEach-Object { FixEv $_.Ev $c.Code $cat } | Where-Object { $_ })
      $ev = ''
      if ($votes.Count -eq 2 -and $votes[0] -ceq $votes[1]) { $ev = $votes[0] }
      else {
        $b5 = Capture $d.H
        try {
          foreach ($cfg in @(@(222, 91, 140, 22, 3, 235), @(224, 93, 130, 18, 4, 235), @(222, 91, 140, 22, 2, 235), @(222, 91, 140, 22, 3, 242))) {
            $one = FixEv ((Ocr $b5 $cfg[0] ($tabY + $cfg[1]) $cfg[2] $cfg[3] $cfg[5] $cfg[4]) -replace '\s', '') $c.Code $cat
            if ($one) { $votes += $one }
          }
        } finally { $b5.Dispose() }
        $top = @($votes | Group-Object -CaseSensitive | Sort-Object Count -Descending)
        if ($top.Count -and $top[0].Count -ge 2 -and ($top.Count -eq 1 -or $top[1].Count -lt $top[0].Count)) { $ev = $top[0].Name }
        elseif ($votes.Count) { $o.checks += "row $($k + 1): event read as $(($votes | Select-Object -Unique) -join ' / ')" }
        else { $o.checks += "row $($k + 1): event unread" }
      }
      $row.assembly = [ordered]@{ component_code = $code; event = $ev; spt = $spt }
      if ((Norm $code) -ne (Norm $c.Code)) {
        $o.checks += "row $($k + 1): assembly shows $code, report $($c.Code)"
        if ($DebugDir -and -not $o.debugSaved) {
          $b4 = Capture $d.H; $b4.Save("$DebugDir\$cat-$(SafeName $sel)-$($o.side)-row$($k + 1)-tab$tabY.png"); $b4.Dispose(); $o.debugSaved = $true
        }
      }
      elseif ($spt -and ($spt -replace '\.', '').TrimStart('0') -ne ($c.Spt -replace '\.', '').TrimStart('0')) { $o.checks += "row $($k + 1): SPT $spt vs $($c.Spt)" }   # OCR sometimes drops the point
      elseif ($ev) {
        $eventOf[$key] = $ev; Append $evFile "$cat`t$sideAct`t$($c.Code)`t$($c.Spt)`t$ev"
        if (-not $eventText.ContainsKey($ev)) { $needText[$ev] = $k }
      }
    }
    if ($eventOf.ContainsKey($key)) { $row.event = $eventOf[$key] }
    $rows += $row
    if ($k -lt $comps.Count - 1) { Keys '{DOWN}'; Start-Sleep -Milliseconds 120 }
  }
  $o.components = $rows
  # Texts of events seen for the first time
  # Each new event's text: select its row, then show Supporting Events (and make sure it is
  # showing - once it came back with the Assembly Info page instead).
  foreach ($ev in @($needText.Keys)) {
    $text = ''
    for ($try = 0; $try -lt 3 -and -not $text; $try++) {
      FirstRow $r
      if ($needText[$ev] -gt 0) { Keys "{DOWN $($needText[$ev])}"; Start-Sleep -Milliseconds 150 }
      Click ($r.L + $TabEvents) ($r.T + $tabY); Start-Sleep -Milliseconds 300
      $b3 = Capture $d.H
      try { $t = (Ocr $b3 28 ($tabY + 20) ($b3.Width - 56) ($b3.Height - $tabY - 100) 0 2) -replace "`n", ' ' } finally { $b3.Dispose() }
      $t = ($t -replace '\s*Preview\s+[0O]K\s+Cancel\s*$', '').Trim()
      if ($t -and $t -notmatch 'Component Code:|Direct Yield') { $text = $t }
    }
    if ($text) { $eventText[$ev] = $text; Append $txFile "$ev`t$text" } else { $o.checks += "event $ev text unread" }
  }
  Keys '{ESC}'
  if (-not (WaitGone 'Item Activity Information')) { Keys '{ESC}'; WaitGone 'Item Activity Information' | Out-Null }
  if ($o.Contains('debugSaved')) { $o.Remove('debugSaved') }
  $o
}

# --- items --------------------------------------------------------------------------------------------
$items = Get-Content $List -Encoding UTF8 | Where-Object { $_.Trim() } | ForEach-Object {
  $f = $_ -split "`t"
  $parse = { param($s) @(($s -split ';') | Where-Object { $_ } | ForEach-Object { $p = $_ -split '\|'; [pscustomobject]@{ Code = $p[0]; Spt = $p[1]; Price = [double]$p[2]; Kind = $p[3] } }) }
  [pscustomobject]@{ Cat = $f[0]; Sel = $f[1]; Sides = $f[2]; Plus = (& $parse $f[3]); Minus = (& $parse $(if ($f.Count -gt 4) { $f[4] } else { '' })) }
}
if ($Only) {
  $want = @($Only -split ',' | ForEach-Object { $_.Trim() })
  $items = @($items | Where-Object { $want -ccontains "$($_.Cat) $($_.Sel)" }); $done = @{}
}
if ($DebugDir) { New-Item -ItemType Directory -Force -Path $DebugDir | Out-Null }
if (-not $Only) {
  # Two readers would fight over Xactimate; only one may run.
  $others = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-File\s+"?[^"]*\\details\.ps1' -and $_.CommandLine -notmatch '-Only' })
  if ($others.Count) { Log "details: another reader is already running (pid $($others[0].ProcessId)) - this one exits"; exit 3 }
}
Log "details: $($items.Count) items listed, $($done.Count) already read"
$curCat = ''; $n = 0; $streak = 0
foreach ($it in $items) {
  if ($done.ContainsKey("$($it.Cat)`t$($it.Sel)")) { continue }
  if ($MaxItems -gt 0 -and $n -ge $MaxItems) { break }
  try { if (Guard) { CloseMenus; $curCat = '' } } catch {}
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
  $t0 = Get-Date
  $rec = [ordered]@{ category = $it.Cat; selector = $it.Sel; item_code = "$($it.Cat)$($it.Sel)" }
  $status = 'ok'
  try {
    CloseMenus
    if ($curCat -ne $it.Cat) {
      Click $QeCancel[0] $QeCancel[1]; Start-Sleep -Milliseconds 300
      Click $QeCat[0] $QeCat[1]; Keys '^a'; Keys (Lit $it.Cat); $curCat = $it.Cat
    }
    Click $QeSel[0] $QeSel[1]; Keys '^a'; Keys ((Lit $it.Sel) + '{TAB}'); Start-Sleep -Milliseconds 1300
    # An & item's panel has a Replace Price row and a Remove Price row; any other item has
    # one row (its own activity's price) and Minimum Group one row higher.
    $both = $it.Sides -eq '+-'
    $plus = 0.0; foreach ($c in $it.Plus) { $plus += $c.Price }; $minus = 0.0; foreach ($c in $it.Minus) { $minus += $c.Price }
    $okPrice = $false
    for ($try = 0; $try -lt 2 -and -not $okPrice; $try++) {
      if ($try) {
        # Quick Entry keeps its own activity for some items (CAB APNL came up as + though
        # the list says &): pick the one wanted from the Act list.
        $want = if ($both) { '&' } elseif ($it.Sides -eq '+') { '+' } else { '-' }
        if (-not (PickAct $want)) { throw "couldn't pick activity $want" }
        Start-Sleep -Milliseconds 900
      }
      Click $QePrice[0] $QePrice[1]; Start-Sleep -Milliseconds 800
      $first = Money (CopyBox $ReplaceBox[0] $ReplaceBox[1])
      $rec.replace_price = $null; $rec.remove_price = $null
      if ($both) { $rec.replace_price = $first; $rec.remove_price = Money (CopyBox $RemoveBox[0] $RemoveBox[1]) }
      elseif ($it.Sides -eq '+') { $rec.replace_price = $first } else { $rec.remove_price = $first }
      # The prices must be this item's, or Quick Entry didn't load it (or shows another activity).
      $okPrice = ($it.Sides -notlike '*+*' -or ($null -ne $rec.replace_price -and [math]::Abs($rec.replace_price - $plus) -lt 0.5 + 0.05 * $plus)) -and
                 ($it.Sides -notlike '*-*' -or ($null -ne $rec.remove_price -and [math]::Abs($rec.remove_price - $minus) -lt 0.5 + 0.05 * $minus))
    }
    if (-not $okPrice) { throw "Quick Entry shows replace $($rec.replace_price) / remove $($rec.remove_price), report $plus / $minus" }
    $main = Capture $xp.MainWindowHandle
    $mgY = if ($both) { $MinGroup[1] } else { $MinGroup[1] - 43 }
    try { $mg = (Ocr $main $MinGroup[0] $mgY $MinGroup[2] $MinGroup[3] 150) -replace '\s', '' } finally { $main.Dispose() }
    $rec.minimum_group = if ($mg -match '^([A-Z0-9]+-[A-Z0-9]+)') { $Matches[1] } else { $mg }
    $rec.sides = @()
    if ($it.Sides -like '*+*') { $rec.sides += (ReadSide $it.Cat $it.Sel '+' $it.Plus $ReplaceI) }
    if ($it.Sides -like '*-*') { $rec.sides += (ReadSide $it.Cat $it.Sel '-' $it.Minus $(if ($both) { $RemoveI } else { $ReplaceI })) }
    $checks = @($rec.sides | ForEach-Object { $_.checks } | Where-Object { $_ })
    if ($checks.Count) { $status = "check: $($checks -join '; ')" }
  } catch {
    $status = "error: $($_.Exception.Message)"; try { CloseMenus } catch {}; $curCat = ''
  }
  # Someone used the mouse or keyboard while this item was being read: don't keep what was
  # read (a click may have landed elsewhere); it's read again later, and Guard waits for idle.
  if ([X]::LastInput() -gt $script:ourInput + 200) { $status = 'error: the PC was used during this item'; try { CloseMenus } catch {}; $curCat = ''; break }
  # Passing trouble (a copy that missed, a window that didn't open): read the item once more.
  if ($attempt -eq 0 -and $status -match "copied|no window|details did not open|tabs not found|couldn't pick|Quick Entry shows") {
    Log "details $($it.Cat) $($it.Sel) -> reading again: $status"; try { CloseMenus } catch {}; $curCat = ''; continue
  }
  break
  }
  $rec.status = $status
  $rec.seconds = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  if ($status -notlike 'error*') { Append $Result ($rec | ConvertTo-Json -Depth 8 -Compress) }
  Append $index ("{0}`t{1}`t{2}`t{3}" -f $it.Cat, $it.Sel, $status, (Get-Date -Format s))
  if ($status -ne 'ok') { Log "details $($it.Cat) $($it.Sel) -> $status" }
  if ($status -like 'error*' -and $status -notlike '*PC was used*') { $streak++ } else { $streak = 0 }
  if ($streak -ge 3) {
    # Several in a row means Xactimate itself is in trouble (session timed out / logged off).
    New-Item -ItemType File -Force -Path "$Out\PAUSE" | Out-Null
    Log "3 failures in a row - paused; check Xactimate (logged off?), then run resume"
    $streak = 0
  }
  $n++; if ($n % 50 -eq 0) { Log "details: $n items this run ($($it.Cat))" }
}
CloseMenus
Log "details done: $n items this run"
