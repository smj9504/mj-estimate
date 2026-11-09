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
  if (-not (XWindows | Select-Object -First 1)) {
    # Xactimate was closed and opened again: follow the new process.
    $np = Get-Process -Name $Proc -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($np -and [uint32]$np.Id -ne $xpid) { $script:xp = $np; $script:xpid = [uint32]$np.Id; Log "Xactimate was reopened - following the new one (pid $xpid)" }
  }
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
