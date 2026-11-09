$ErrorActionPreference = "Stop"
$Launcher = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\MY-BOT-WSL.vbs"
if (Test-Path -LiteralPath $Launcher) {
  Remove-Item -LiteralPath $Launcher -Force
  Write-Host "Removed MY-BOT-WSL logon launcher. Running services and browser credentials were left unchanged."
} else {
  Write-Host "MY-BOT-WSL logon launcher is not installed."
}
