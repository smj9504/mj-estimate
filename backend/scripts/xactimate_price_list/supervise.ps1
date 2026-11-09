# Keeps runner.ps1 -Mode reports going until every item is collected (or out\STOP exists).
# After the runner finishes a pass, items that failed are tried again (up to 2 more passes).
param([string]$Out = "$PSScriptRoot\out", [string]$Order = "$PSScriptRoot\out\order.txt")
$log = "$Out\run.log"
# Append to the log while others may have it open; never throws.
function Note($m) {
  for ($i = 0; $i -lt 20; $i++) {
    try {
      $fs = New-Object System.IO.FileStream($log, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
      $b = [System.Text.Encoding]::UTF8.GetBytes("$(Get-Date -Format HH:mm:ss) supervisor: $m`r`n"); $fs.Write($b, 0, $b.Length); $fs.Close(); return
    } catch { Start-Sleep -Milliseconds 250 }
  }
}
function Unresolved {
  $done = @{}; $bad = @{}
  foreach ($l in [System.IO.File]::ReadAllLines("$Out\index.tsv")) {
    $f = $l -split "`t"; if ($f.Count -lt 3) { continue }; $k = "$($f[0])`t$($f[1])"
    if ($f[2] -eq 'ok' -or $f[2] -like 'skip*') { $done[$k] = 1; $bad.Remove($k) } elseif (-not $done.ContainsKey($k)) { $bad[$k] = 1 }
  }
  $bad.Count
}
# Only one supervisor: a second one would start a second runner on the same items.
$others = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-File\s+"?[^"]*\\supervise\.ps1' })
if ($others.Count) { Note "another supervisor is already running (pid $($others[0].ProcessId)) - this one exits"; exit 0 }
$retries = 0
for ($round = 1; $round -le 200; $round++) {
  if (Test-Path "$Out\STOP") { Note "STOP file - not restarting"; break }
  $cats = (Get-Content $Order -Raw).Trim()
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\runner.ps1" -Mode reports -Out $Out -Categories $cats *>> "$Out\runner.stderr.txt"
  $code = $LASTEXITCODE
  if ($code -eq 3) { Note "a runner started elsewhere is already collecting - this supervisor stops"; break }
  $last = Get-Content $log -Tail 1
  if ($last -match 'reports done') {
    $left = Unresolved
    if ($left -eq 0) { Note "finished - every item collected"; break }
    if ($retries -ge 2) { Note "finished - $left items still failing after retries"; break }
    $retries++; Note "pass done, $left items failed - trying them again (retry $retries)"; continue
  }
  Note "runner ended (exit $code) - restarting in 20 s (round $round)"
  Start-Sleep -Seconds 20
}
