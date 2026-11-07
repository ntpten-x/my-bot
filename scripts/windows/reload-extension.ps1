# Opens Chrome's extensions page so the owner can Reload MY-BOT (unpacked).
# Chrome does not auto-reload unpacked extensions after file changes.
$ErrorActionPreference = "Stop"
Write-Host "Opening chrome://extensions ..."
Write-Host "Find MY-BOT Lead Radar and click Reload until the version shows 1.10.5"
Start-Process "chrome" "chrome://extensions/"
