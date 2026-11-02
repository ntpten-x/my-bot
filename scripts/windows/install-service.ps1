$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Node = (Get-Command node -ErrorAction Stop).Source
Write-Host "สร้างชุดโปรดักชันที่ $Repo"
Push-Location $Repo
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm run build ไม่สำเร็จ" }
Pop-Location

$Command = "Set-Location -LiteralPath '$Repo'; & '$Node' 'scripts/start-all.mjs' --prod"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command $Command"
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "MY-BOT" -Action $Action -Trigger $Trigger -Settings $Settings -Description "MY-BOT lead radar on port 8001" -Force | Out-Null
Write-Host "ลงทะเบียนงาน MY-BOT ตอนล็อกอินแล้ว พอร์ต 8001"
Write-Host "เริ่มทันทีด้วย: Start-ScheduledTask -TaskName MY-BOT"
