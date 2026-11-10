# Keeps details.ps1 going until every listed item is read (or out\STOP exists).
# After a pass, items that errored are tried again (up to 2 more passes).
param([string]$Out = "$PSScriptRoot\out")
$log = "$Out\run.log"
function Note($m) {
  for ($i = 0; $i -lt 20; $i++) {
    try {
      $fs = New-Object System.IO.FileStream($log, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
      $b = [System.Text.Encoding]::UTF8.GetBytes("$(Get-Date -Format HH:mm:ss) details supervisor: $m`r`n"); $fs.Write($b, 0, $b.Length); $fs.Close(); return
    } catch { Start-Sleep -Milliseconds 250 }
  }
}
function Unread {
  $done = @{}
  if (Test-Path "$Out\details_index.tsv") {
    $pf = @{}
    foreach ($l in [System.IO.File]::ReadAllLines("$Out\details_index.tsv")) { $f = $l -split "`t"; if ($f.Count -ge 3 -and ($f[2] -like 'ok*' -or ($f[2] -like 'check*' -and $f[2] -notmatch 'copied|no window|details did not open|tabs not found'))) { $done["$($f[0])`t$($f[1])"] = 1 }
      elseif ($f.Count -ge 3 -and $f[2] -like 'error: Quick Entry shows*') { $k = "$($f[0])`t$($f[1])`t$($f[2])"; $pf[$k]++; if ($pf[$k] -ge 2) { $done["$($f[0])`t$($f[1])"] = 1 } } }   # same wrong price twice: the item's own, left for review
  }
  $n = 0
  foreach ($l in [System.IO.File]::ReadAllLines("$Out\details_items.tsv")) { $f = $l -split "`t"; if ($f.Count -ge 2 -and -not $done.ContainsKey("$($f[0])`t$($f[1])")) { $n++ } }
  $n
}
$others = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-File\s+"?[^"]*\\supervise_details\.ps1' })
if ($others.Count) { Note "another one is already running (pid $($others[0].ProcessId)) - this one exits"; exit 0 }
$retries = 0
for ($round = 1; $round -le 300; $round++) {
  if (Test-Path "$Out\STOP") { Note "STOP file - not restarting"; break }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\details.ps1" -Out $Out *>> "$Out\details.stderr.txt"
  $code = $LASTEXITCODE
  if ($code -eq 3) { Note "a reader started elsewhere is already running - stopping"; break }
  $last = Get-Content $log -Tail 1
  if ($last -match 'details done') {
    $left = Unread
    if ($left -eq 0) { Note "finished - every item read"; break }
    if ($retries -ge 2) { Note "finished - $left items still failing after retries"; break }
    $retries++; Note "pass done, $left items failed - trying them again (retry $retries)"; continue
  }
  Note "reader ended (exit $code) - restarting in 20 s (round $round)"
  Start-Sleep -Seconds 20
}
