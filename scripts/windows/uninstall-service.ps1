$ErrorActionPreference = "Continue"
try {
  Unregister-ScheduledTask -TaskName "MY-BOT" -Confirm:$false -ErrorAction Stop
  Write-Host "Removed scheduled task MY-BOT"
} catch {
  Write-Host "No scheduled task removed (it may be missing or need an admin shell)."
}
$VbsPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\MY-BOT.vbs"
if (Test-Path $VbsPath) {
  Remove-Item -LiteralPath $VbsPath -Force
  Write-Host "Removed Startup launcher $VbsPath"
} else {
  Write-Host "No Startup launcher found"
}
