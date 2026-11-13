# 수집 진행 상황 (PDF 수집 + 세부 정보 읽기)
$out = "$PSScriptRoot\out"
# 1) PDF reports
$total = 0
foreach ($f in [System.IO.Directory]::GetFiles("$out\catalog", "*.tsv")) { foreach ($l in [System.IO.File]::ReadAllLines($f)) { if ($l.Trim()) { $total++ } } }
$done = @{}; $skip = @{}
foreach ($l in [System.IO.File]::ReadAllLines("$out\index.tsv")) {
  if (-not $l.Trim()) { continue }
  $f = $l -split "`t"; $key = "$($f[0]) $($f[1])"
  if ($f[2] -eq 'ok') { $done[$key] = 1 } elseif ($f[2] -like 'skip*') { $skip[$key] = 1 }
}
Write-Host ("PDF 수집: {0:N0} / {1:N0} 완료 (MISC {2} 건너뜀)" -f $done.Count, $total, $skip.Count)

# 2) details (Item Activity Information)
$listed = 0
if (Test-Path "$out\details_items.tsv") { foreach ($l in [System.IO.File]::ReadAllLines("$out\details_items.tsv")) { if ($l.Trim()) { $listed++ } } }
$ok = @{}; $check = @{}; $failed = [ordered]@{}; $last = $null
if (Test-Path "$out\details_index.tsv") {
  foreach ($l in [System.IO.File]::ReadAllLines("$out\details_index.tsv")) {
    if (-not $l.Trim()) { continue }
    $f = $l -split "`t"; $key = "$($f[0]) $($f[1])"; $last = $f
    if ($f[2] -like 'ok*') { $ok[$key] = 1; $check.Remove($key); $failed.Remove($key) }
    elseif ($f[2] -like 'check*') { if (-not $ok.ContainsKey($key)) { $check[$key] = $f[2] }; $failed.Remove($key) }
    elseif (-not $ok.ContainsKey($key) -and -not $check.ContainsKey($key)) { $failed[$key] = $f[2] }
  }
}
$alive = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '-File\s+"?[^"]*\\(supervise_details|details)\.ps1' }).Count -gt 0
$state = if (Test-Path "$out\PAUSE") { "일시정지" } elseif (Test-Path "$out\STOP") { "멈춤" } elseif ($alive) { "읽는 중" } else { "꺼져 있음" }
$read = $ok.Count + $check.Count
Write-Host ("세부 정보: {0}" -f $state)
Write-Host ("  읽음: {0:N0} / {1:N0} 항목 ({2:P1}), 그중 확인 필요 {3}" -f $read, $listed, ($read / [math]::Max($listed, 1)), $check.Count)
if ($last) { Write-Host ("  마지막: {0} {1}  {2}" -f $last[0], $last[1], $last[3]) }
Write-Host ("  실패 (다시 시도할 것): {0}" -f $failed.Count)
@($failed.Keys) | Select-Object -Last 3 | ForEach-Object { Write-Host ("    {0} -> {1}" -f $_, $failed[$_]) }
$left = $listed - $read
if ($state -eq "읽는 중" -and $left -gt 0) { Write-Host ("  남은 시간: 약 {0:N1} 시간 (항목당 약 11.6초, 쉬는 시간 제외)" -f ($left * 11.6 / 3600)) }

# 3) R / M / I (Detach & Reset, Material Only, Install Only)
$listed = 0
if (Test-Path "$out\rmi_items.tsv") { foreach ($l in [System.IO.File]::ReadAllLines("$out\rmi_items.tsv")) { if ($l.Trim()) { $listed++ } } }
$ok = @{}; $failed = [ordered]@{}; $last = $null
if (Test-Path "$out\rmi_index.tsv") {
  foreach ($l in [System.IO.File]::ReadAllLines("$out\rmi_index.tsv")) {
    if (-not $l.Trim()) { continue }
    $f = $l -split "`t"; $key = "$($f[0]) $($f[1])"; $last = $f
    if ($f[6] -notlike 'error*') { $ok[$key] = 1; $failed.Remove($key) } elseif (-not $ok.ContainsKey($key)) { $failed[$key] = $f[6] }
  }
}
$alive = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '-File\s+"?[^"]*\\(supervise_rmi|rmi)\.ps1' }).Count -gt 0
$state = if (Test-Path "$out\PAUSE") { "일시정지" } elseif (Test-Path "$out\STOP") { "멈춤" } elseif ($alive) { "읽는 중" } else { "꺼져 있음" }
Write-Host ("R/M/I 가격: {0}" -f $state)
Write-Host ("  읽음: {0:N0} / {1:N0} 항목 ({2:P1})" -f $ok.Count, $listed, ($ok.Count / [math]::Max($listed, 1)))
if ($last) { Write-Host ("  마지막: {0} {1}  {2}" -f $last[0], $last[1], $last[7]) }
Write-Host ("  실패 (다시 시도할 것): {0}" -f $failed.Count)
$left = $listed - $ok.Count
if ($state -eq "읽는 중" -and $left -gt 0) { Write-Host ("  남은 시간: 약 {0:N1} 시간 (항목당 약 4.8초, 쉬는 시간 제외)" -f ($left * 4.8 / 3600)) }