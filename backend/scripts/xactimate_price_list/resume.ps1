# 수집 다시 시작: 일시정지를 풀고, 꺼져 있으면 멈춘 곳부터 다시 켠다.
# (PDF 수집은 끝났으므로 지금은 세부 정보 읽기(details)를 이어서 한다.)
$out = "$PSScriptRoot\out"
Remove-Item "$out\PAUSE", "$out\STOP" -Force -ErrorAction SilentlyContinue
$running = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '-File\s+"?[^"]*\\supervise_details\.ps1' }).Count -gt 0
if ($running) {
  Write-Host "일시정지를 풀었습니다. 몇 초 안에 이어서 수집합니다."
} else {
  $p = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSScriptRoot\supervise_details.ps1`"") -WindowStyle Hidden -PassThru
  Set-Content "$out\details_supervisor.pid" $p.Id
  Write-Host "수집을 다시 켰습니다. 멈췄던 항목부터 이어서 합니다."
}
Write-Host "Xactimate 는 Estimate Items 화면에 둔 채로 두세요. 마우스/키보드를 쓰면 자동으로 쉬었다가 30초 뒤 이어서 합니다."
