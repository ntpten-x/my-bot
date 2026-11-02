$ErrorActionPreference = "Stop"
Unregister-ScheduledTask -TaskName "MY-BOT" -Confirm:$false
Write-Host "เอางาน MY-BOT ออกจาก Task Scheduler แล้ว"
