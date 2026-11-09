# 수집 일시정지: 지금 하던 항목까지만 하고 멈춘다. resume 으로 이어서.
$out = "$PSScriptRoot\out"
New-Item -ItemType File -Force -Path "$out\PAUSE" | Out-Null
Write-Host "일시정지 요청함 - 지금 항목을 마치면 멈춥니다 (최대 10초)."
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  if ((Get-Content "$out\run.log" -Tail 1) -match 'paused') { Write-Host "멈췄습니다. PC 를 써도 됩니다. 다시 하려면 'Xactimate 수집 다시 시작'."; exit }
}
Write-Host "멈춤 표시는 남겨 두었습니다. 수집이 돌고 있지 않았거나 곧 멈춥니다."
