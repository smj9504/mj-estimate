# Shared by details.ps1 and rmi.ps1 (dot-sourced after common.ps1): window capture, Windows OCR,
# clipboard reads, screen fingerprints, and the Quick Entry positions on the Estimate Items screen.
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
# The clipboard as soon as a copy has landed in it (ClearClip first), or what's there after $maxMs.
function WaitClip([int]$maxMs = 500) {
  $t = [Environment]::TickCount
  do { Start-Sleep -Milliseconds 40; $c = Clip; if ($c -and $c -ne '<<empty>>') { return $c } } while ([Environment]::TickCount - $t -lt $maxMs)
  Clip
}
function CopyBox($x, $y) { ClearClip; Click $x $y; Start-Sleep -Milliseconds 100; Keys '^a'; Keys '^c'; $c = WaitClip 450; if ($c -eq '<<empty>>') { '' } else { $c.Trim() } }
# A fingerprint of part of the screen, to tell when Xactimate has redrawn it.
$md5 = [System.Security.Cryptography.MD5]::Create()
function ScreenSig($area) {
  $b = New-Object System.Drawing.Bitmap $area[2], $area[3]
  try {
    $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($area[0], $area[1], 0, 0, $b.Size); $g.Dispose()
    $data = $b.LockBits((New-Object System.Drawing.Rectangle 0, 0, $b.Width, $b.Height), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $n = $data.Stride * $b.Height; $px = New-Object byte[] $n
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $px, 0, $n); $b.UnlockBits($data)
    [Convert]::ToBase64String($md5.ComputeHash($px))
  } finally { $b.Dispose() }
}
# Wait until the area differs from $before and then holds still for $holds more looks;
# returns the ms it took, or -1 when it gave up after $maxMs.
function WaitRedraw($area, $before, [int]$maxMs, [int]$holds = 2) {
  $t = [Environment]::TickCount; $prev = $before; $same = 0
  while ([Environment]::TickCount - $t -lt $maxMs) {
    Start-Sleep -Milliseconds 60
    $s = ScreenSig $area
    if ($s -ne $before -and $s -eq $prev) { $same++; if ($same -ge $holds) { return [Environment]::TickCount - $t } } else { $same = 0 }
    $prev = $s
  }
  -1
}

# --- screen positions (Estimate Items, window maximized at 0,0, 2560x1528) ---------------------------
$QeCancel = @(1507, 607); $QeCat = @(865, 655); $QeSel = @(1045, 657); $QePrice = @(1290, 740)
$ReplaceBox = @(1745, 690); $RemoveBox = @(1745, 733); $ReplaceI = @(1862, 692); $RemoveI = @(1862, 735)
$MinGroup = @(2010, 766, 96, 28)           # x, y, w, h on the main window (text only, not the arrow)
$DescArea = @(836, 689, 728, 22)           # inside Quick Entry's Desc box: every item's text differs
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
