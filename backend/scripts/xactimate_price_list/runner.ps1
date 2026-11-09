# Pulls every line item's "Price List Item Report" PDF out of Xactimate.
#
#   -Mode categories   copy the category list to <Out>\categories.tsv
#   -Mode catalog      copy each category's selector list to <Out>\catalog\<CAT>.tsv
#   -Mode reports      for each selector: filter the list to it, View, Preview, keep the PDF
#
# Xactimate's windows can't be read or clicked through Windows UI Automation, so this drives the
# real mouse and keyboard. It pauses when the person touches the mouse or keyboard and waits until
# they've been idle for $IdleSeconds. Create <Out>\STOP to make it stop after the current item.
param(
  [ValidateSet('categories', 'catalog', 'reports')] [string]$Mode = 'reports',
  [string[]]$Categories = @(),
  [string]$Out = "$PSScriptRoot\out",
  [int]$MaxItems = 0,
  [int]$IdleSeconds = 30,
  [string]$Proc = 'Xactimate online Estimate Writer-G0'
)
$ErrorActionPreference = 'Stop'
# -File passes "A,B,C" as one string; accept both forms.
$Categories = @($Categories | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class X {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P cb, IntPtr l);
  public static string Title(IntPtr h) { var t = new StringBuilder(512); GetWindowText(h, t, 512); return t.ToString(); }
  public static uint LastInput() { var i = new LASTINPUTINFO(); i.cbSize = 8; GetLastInputInfo(ref i); return i.dwTime; }
  // Visible titled windows of a process, topmost first.
  public static System.Collections.Generic.List<IntPtr> Windows(uint want) {
    var o = new System.Collections.Generic.List<IntPtr>();
    EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid); if (pid == want && IsWindowVisible(h) && GetWindowTextLength(h) > 0) o.Add(h); return true; }, IntPtr.Zero);
    return o;
  }
}
"@
[X]::SetProcessDPIAware() | Out-Null

$xp = Get-Process -Name $Proc | Select-Object -First 1
if (-not $xp) { throw "Xactimate isn't running" }
$xpid = [uint32]$xp.Id
$TempDir = Join-Path (Split-Path $xp.Path) 'EstimateWriterData\xm8\Temp'
New-Item -ItemType Directory -Force -Path $Out, "$Out\catalog", "$Out\pdf" | Out-Null
$Log = "$Out\run.log"
# Append a line, sharing the file with readers (tail, editors) and retrying; never throws.
function Append($path, $line) {
  for ($i = 0; $i -lt 20; $i++) {
    try {
      $fs = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
      $b = [System.Text.Encoding]::UTF8.GetBytes($line + "`r`n"); $fs.Write($b, 0, $b.Length); $fs.Close(); return
    } catch { Start-Sleep -Milliseconds 250 }
  }
}
function Log($m) { $line = "{0:HH:mm:ss} {1}" -f (Get-Date), $m; Append $Log $line; Write-Host $line }

# Quick Entry fields on the Estimate Items screen (physical pixels, window maximized at 0,0).
$CatBox = @(865, 655); $CatList = @(911, 655); $SelList = @(1108, 655)

# --- the person's input wins -------------------------------------------------------------------
$script:ourInput = [X]::LastInput()
function Mark { Start-Sleep -Milliseconds 30; $script:ourInput = [X]::LastInput() }
function Guard {
  if (Test-Path "$Out\STOP") { Log "STOP file found - stopping"; exit 0 }
  if (Test-Path "$Out\PAUSE") {
    # Paused on purpose (pause.cmd): hand the PC back until the PAUSE file is gone.
    Log "paused - run resume to go on"
    try { CloseTabs } catch {}
    while (Test-Path "$Out\PAUSE") {
      if (Test-Path "$Out\STOP") { Log "STOP file found - stopping"; exit 0 }
      Start-Sleep -Seconds 2
    }
    Log "resumed"
    $script:ourInput = [X]::LastInput()
    return $true
  }
  # Input newer than our own last synthetic input came from the person.
  if ([X]::LastInput() -gt $script:ourInput + 200) {
    Log "person is using the PC - pausing until idle for $IdleSeconds s"
    while ((([Environment]::TickCount -band 0xFFFFFFFF) - [X]::LastInput()) -lt $IdleSeconds * 1000) {
      if (Test-Path "$Out\STOP") { Log "STOP file found - stopping"; exit 0 }
      Start-Sleep -Seconds 2
    }
    Log "idle - resuming"
    $script:ourInput = [X]::LastInput()
    return $true
  }
  return $false
}

# --- windows -----------------------------------------------------------------------------------
function XWindows { [X]::Windows($xpid) | ForEach-Object { [pscustomobject]@{ H = $_; Title = [X]::Title($_) } } }
function FindWin($prefix) { XWindows | Where-Object { $_.Title -like "$prefix*" } | Select-Object -First 1 }
function Rect($h) { $r = New-Object X+RECT; [X]::GetWindowRect($h, [ref]$r) | Out-Null; $r }
function WaitWin($prefix, $ms = 6000) {
  $t = [Environment]::TickCount
  while ([Environment]::TickCount - $t -lt $ms) { $w = FindWin $prefix; if ($w) { return $w }; Start-Sleep -Milliseconds 80 }
  return $null
}
function WaitGone($prefix, $ms = 4000) {
  $t = [Environment]::TickCount
  while ([Environment]::TickCount - $t -lt $ms) { if (-not (FindWin $prefix)) { return $true }; Start-Sleep -Milliseconds 80 }
  return $false
}
function Front {
  # Bring Xactimate's topmost window (the open dialog, if any) to the front.
  if ([X]::IsIconic($xp.MainWindowHandle)) { [X]::ShowWindow($xp.MainWindowHandle, 9) | Out-Null }
  $top = (XWindows | Select-Object -First 1).H
  if (-not $top) { throw "no Xactimate window" }
  if ([X]::GetForegroundWindow() -ne $top) {
    [X]::SetForegroundWindow($top) | Out-Null; Start-Sleep -Milliseconds 120
    if ([X]::GetForegroundWindow() -ne $top) {
      [X]::keybd_event(0x12, 0, 0, [IntPtr]::Zero); [X]::keybd_event(0x12, 0, 2, [IntPtr]::Zero); Mark
      [X]::SetForegroundWindow($top) | Out-Null; Start-Sleep -Milliseconds 200
    }
  }
  $fp = 0; [X]::GetWindowThreadProcessId([X]::GetForegroundWindow(), [ref]$fp) | Out-Null
  if ($fp -ne $xpid) { throw "Xactimate didn't come to the front" }
}
function Click($x, $y) { Front; [X]::SetCursorPos($x, $y) | Out-Null; Start-Sleep -Milliseconds 50; [X]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero); [X]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero); Mark }
function Keys($k) { Front; [System.Windows.Forms.SendKeys]::SendWait($k); Mark }
function Lit($s) { ($s.ToCharArray() | ForEach-Object { if ('+^%~(){}[]'.Contains([string]$_)) { "{$_}" } else { [string]$_ } }) -join '' }
function Clip { try { [System.Windows.Forms.Clipboard]::GetText() } catch { '' } }
function ClearClip { try { [System.Windows.Forms.Clipboard]::SetText('<<empty>>') } catch {} }

function CloseMenus {
  # Esc out of every Xactimate dialog back to the Estimate Items screen.
  for ($i = 0; $i -lt 4; $i++) {
    $top = XWindows | Select-Object -First 1
    if (-not $top -or $top.H -eq $xp.MainWindowHandle) { return }
    Keys '{ESC}'; Start-Sleep -Milliseconds 400
  }
}

$script:spent = @()
function ClosePdfTabs {
  CloseTabs
  # Xactimate's copies of PDFs we already kept - safe to drop once Edge has let go of them.
  foreach ($dir in $script:spent) { try { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue } catch {} }
  $script:spent = @()
}
function CloseTabs {
  for ($i = 0; $i -lt 60; $i++) {
    $w = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'Price List Item Report.pdf*' } | Select-Object -First 1
    if (-not $w) { return }
    $h = $w.MainWindowHandle
    [X]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 120
    if ([X]::GetForegroundWindow() -ne $h) { [X]::keybd_event(0x12, 0, 0, [IntPtr]::Zero); [X]::keybd_event(0x12, 0, 2, [IntPtr]::Zero); [X]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 200 }
    $fg = [X]::GetForegroundWindow()
    if ($fg -ne $h -or -not ([X]::Title($fg) -like 'Price List Item Report.pdf*')) { Log "couldn't bring the PDF tab forward - leaving it"; return }
    [X]::keybd_event(0x11, 0, 0, [IntPtr]::Zero); [X]::keybd_event(0x57, 0, 0, [IntPtr]::Zero); [X]::keybd_event(0x57, 0, 2, [IntPtr]::Zero); [X]::keybd_event(0x11, 0, 2, [IntPtr]::Zero)
    Mark; Start-Sleep -Milliseconds 300
  }
}

# --- lists -------------------------------------------------------------------------------------
function CopyGrid($win, $rx = 300, $ry = 151) {
  # Click the first row of a list dialog and copy every row.
  $r = Rect $win.H
  ClearClip
  Click ($r.L + $rx) ($r.T + $ry); Start-Sleep -Milliseconds 150
  Keys '^a'; Start-Sleep -Milliseconds 150; Keys '^c'; Start-Sleep -Milliseconds 500
  Clip
}

function OpenSelectors($cat) {
  $w = FindWin "Selectors for $cat ("
  if ($w) { return $w }
  CloseMenus
  Click $CatBox[0] $CatBox[1]; Start-Sleep -Milliseconds 150
  Keys '^a'; Keys (Lit $cat); Keys '{TAB}'; Start-Sleep -Milliseconds 600
  Click $SelList[0] $SelList[1]
  $w = WaitWin "Selectors for $cat (" 8000
  if (-not $w) { throw "selector list for $cat didn't open" }
  Start-Sleep -Milliseconds 400
  $w
}

# Windows can't have files or folders named CON, PRN, AUX, NUL, COM1.., LPT1.. - such categories get a trailing _.
function FileCat($cat) { if ($cat -match '^(CON|PRN|AUX|NUL|COM\d|LPT\d)$') { "${cat}_" } else { $cat } }

function Catalog($cat) {
  $w = OpenSelectors $cat
  $r = Rect $w.H
  Click ($r.L + 375) ($r.T + 77); Keys '^a'; Keys '{DEL}'; Start-Sleep -Milliseconds 600   # clear the filter
  $text = CopyGrid $w
  if ($text -eq '<<empty>>' -or -not $text) { throw "couldn't copy the $cat selector list" }
  [System.IO.File]::WriteAllText("$Out\catalog\$(FileCat $cat).tsv", $text, (New-Object System.Text.UTF8Encoding $false))
  $n = ($text -split "`r?`n" | Where-Object { $_.Trim() }).Count
  Log "$cat catalog: $n selectors"
  $n
}

# --- one item ----------------------------------------------------------------------------------
function Report($cat, $sel, $dest, $listRow) {
  $w = OpenSelectors $cat
  $r = Rect $w.H
  Click ($r.L + 375) ($r.T + 77); Keys '^a'; Keys (Lit $sel); Start-Sleep -Milliseconds 450
  # Make sure the first row is exactly this selector (the filter matches code prefixes).
  $ok = $false
  ClearClip; Click ($r.L + 300) ($r.T + 151); Start-Sleep -Milliseconds 120; Keys '^c'; Start-Sleep -Milliseconds 250
  for ($i = 0; $i -lt 15; $i++) {
    $row = (Clip) -split "`t"
    if ($row[0] -ceq $sel) { $ok = $true; break }
    ClearClip; Keys '{DOWN}'; Start-Sleep -Milliseconds 120; Keys '^c'; Start-Sleep -Milliseconds 250
  }
  if (-not $ok) {
    # A one-letter filter doesn't filter. Clear it, go to the top and walk down to the
    # selector's row in the catalog (same order as the unfiltered list), then look around it.
    Click ($r.L + 375) ($r.T + 77); Keys '^a'; Keys '{DEL}'; Start-Sleep -Milliseconds 700
    Click ($r.L + 300) ($r.T + 151); Start-Sleep -Milliseconds 120
    Keys '^{HOME}'; if ($listRow -gt 0) { Keys "{DOWN $listRow}" }; Start-Sleep -Milliseconds 300
    foreach ($step in @('', '{UP 5}', '{DOWN}', '{DOWN}', '{DOWN}', '{DOWN}', '{DOWN}', '{DOWN}', '{DOWN}', '{DOWN}', '{DOWN}', '{DOWN}')) {
      if ($step) { Keys $step; Start-Sleep -Milliseconds 120 }
      ClearClip; Keys '^c'; Start-Sleep -Milliseconds 250
      if (((Clip) -split "`t")[0] -ceq $sel) { $ok = $true; break }
    }
  }
  if (-not $ok) { return "not-in-list" }
  $t0 = Get-Date
  Click ($r.L + 923) ($r.T + 225)                       # View
  $d = WaitWin 'Item Activity Information' 6000
  if (-not $d) { return "no-dialog" }
  Start-Sleep -Milliseconds 250
  $dr = Rect $d.H
  $w0 = $dr.R - $dr.L; $h0 = $dr.B - $dr.T
  # Details collapsed: 423 high. A long description makes it a few pixels wider; the
  # buttons stay anchored to the right edge.
  if ($h0 -ne 423 -or $w0 -lt 800 -or $w0 -gt 1400) { Keys '{ESC}'; WaitGone 'Item Activity Information' | Out-Null; return "dialog-${w0}x${h0}" }
  Click ($dr.R - 220) ($dr.T + 372)                     # Preview
  $pdf = $null; $t = [Environment]::TickCount
  while ([Environment]::TickCount - $t -lt 10000) {
    $pdf = Get-ChildItem $TempDir -Recurse -Filter '*.pdf' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $t0 -and $_.Length -gt 0 } | Select-Object -First 1
    if ($pdf) { break }; Start-Sleep -Milliseconds 100
  }
  Start-Sleep -Milliseconds 150
  if ($pdf) { Copy-Item $pdf.FullName $dest -Force }
  Keys '{ESC}'                                          # read-only dialog: Esc = Close
  if (-not (WaitGone 'Item Activity Information')) { Keys '{ESC}'; WaitGone 'Item Activity Information' | Out-Null }
  if (-not $pdf) { return "no-pdf" }
  $script:spent += (Split-Path $pdf.FullName)
  return "ok"
}

# Selector codes keep + and - (legal in file names); only characters Windows forbids become %XX.
function SafeName($s) { ($s.ToCharArray() | ForEach-Object { if ('\/:*?"<>|%'.Contains([string]$_)) { '%{0:X2}' -f [int]$_ } else { [string]$_ } }) -join '' }
# A report already on disk and complete (PDF end marker present) - no need to ask Xactimate again.
function PdfOk($p) {
  if (-not (Test-Path -LiteralPath $p)) { return $false }
  try {
    $fs = [System.IO.File]::Open($p, 'Open', 'Read', 'ReadWrite')
    try {
      if ($fs.Length -lt 500) { return $false }
      $k = [int][Math]::Min(1024, $fs.Length); $fs.Seek(-$k, 'End') | Out-Null
      $b = New-Object byte[] $k; $fs.Read($b, 0, $k) | Out-Null
      return [System.Text.Encoding]::ASCII.GetString($b).Contains('%%EOF')
    } finally { $fs.Close() }
  } catch { return $false }
}

# --- modes -------------------------------------------------------------------------------------
# Anything not caught below still goes in the log before the script ends.
trap { Log "FATAL: $($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)"; break }
Log "start mode=$Mode categories=$($Categories -join ',')"
switch ($Mode) {
  'categories' {
    CloseMenus
    Click $CatList[0] $CatList[1]
    $w = WaitWin 'P.L. Categories' 8000
    if (-not $w) { throw "category list didn't open" }
    Start-Sleep -Milliseconds 400
    $text = CopyGrid $w 200 190
    [System.IO.File]::WriteAllText("$Out\categories.tsv", $text, (New-Object System.Text.UTF8Encoding $false))
    Log ("categories: " + ($text -split "`r?`n" | Where-Object { $_.Trim() }).Count)
    CloseMenus
  }
  'catalog' {
    foreach ($cat in $Categories) {
      Guard | Out-Null
      try { Catalog $cat | Out-Null } catch { Log "$cat catalog failed: $_"; CloseMenus }
    }
    CloseMenus
  }
  'reports' {
    # Two runners would fight over Xactimate and fetch the same items; only one may run.
    $others = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-File\s+"?[^"]*\\runner\.ps1' })
    if ($others.Count) { Log "another runner is already running (pid $($others[0].ProcessId)) - this one exits"; exit 3 }
    $index = "$Out\index.tsv"
    $done = @{}
    if (Test-Path $index) { Get-Content $index -Encoding UTF8 | ForEach-Object { $f = $_ -split "`t"; if ($f[2] -eq 'ok' -or $f[2] -like 'skip*') { $done["$($f[0])`t$($f[1])"] = 1 } } }
    $count = 0
    $streak = 0
    foreach ($cat in $Categories) {
      $tsv = "$Out\catalog\$(FileCat $cat).tsv"
      if (-not (Test-Path $tsv)) { try { Catalog $cat | Out-Null } catch { Log "$cat catalog failed: $_"; CloseMenus; continue } }
      $lines = @(Get-Content $tsv -Encoding UTF8 | Where-Object { $_.Trim() })
      $sels = @($lines | ForEach-Object { ($_ -split "`t")[0] })
      New-Item -ItemType Directory -Force -Path "$Out\pdf\$(FileCat $cat)" | Out-Null
      $n = 0
      for ($row = 0; $row -lt $sels.Count; $row++) {
        $sel = $sels[$row]
        if ($done.ContainsKey("$cat`t$sel")) { continue }
        $dest = "$Out\pdf\$(FileCat $cat)\$(SafeName $sel).pdf"
        if (PdfOk $dest) {
          # Saved before but never marked done (stopped between copying and writing the index).
          $done["$cat`t$sel"] = 1
          Append $index "$cat`t$sel`tok`t$(Get-Date -Format s)"
          Log "$cat $sel -> already saved, not fetched again"
          continue
        }
        if ($MaxItems -gt 0 -and $count -ge $MaxItems) { break }
        try { if (Guard) { CloseMenus } } catch { Log "after pause: $($_.Exception.Message)"; Start-Sleep -Seconds 5 }
        $status = 'error'
        $fields = $lines[$row] -split "`t"
        # Each category's MISC row is a $0 placeholder without a unit; it has no item window.
        if ($sel -eq 'MISC' -and -not $fields[2].Trim()) { $status = 'skip: placeholder' }
        else {
        for ($try = 0; $try -lt 2; $try++) {
          try { $status = Report $cat $sel $dest $row; if ($status -eq 'ok') { break } }
          catch { $status = "error: $($_.Exception.Message)"; try { CloseMenus } catch {} }
        }
        }
        Append $index "$cat`t$sel`t$status`t$(Get-Date -Format s)"
        if ($status -eq 'ok' -or $status -like 'skip*') { $done["$cat`t$sel"] = 1 }  # a repeated row won't be fetched twice
        if ($status -ne 'ok') { Log "$cat $sel -> $status" }
        if ($status -eq 'ok' -or $status -like 'skip*') { $streak = 0 } else { $streak++ }
        if ($streak -ge 3) {
          # Several in a row means Xactimate itself is in trouble (session timed out / logged off).
          New-Item -ItemType File -Force -Path "$Out\PAUSE" | Out-Null
          Log "3 failures in a row - paused; check Xactimate (logged off?), then run resume"
          $streak = 0
        }
        $count++; $n++
        if ($count % 8 -eq 0) { try { ClosePdfTabs } catch { Log "closing PDF tabs: $($_.Exception.Message)" } }
        if ($count % 50 -eq 0) { Log "$count items done ($cat at $n/$($sels.Count))" }
      }
      Log "$cat finished ($n this run)"
      if ($MaxItems -gt 0 -and $count -ge $MaxItems) { break }
    }
    Start-Sleep -Milliseconds 800
    ClosePdfTabs
    CloseMenus
    Log "reports done: $count items this run"
  }
}
