# Opens Chrome's extensions page so the owner can Reload MY-BOT (unpacked).
# Chrome does not auto-reload unpacked extensions after file changes.
$ErrorActionPreference = "Stop"
Write-Host "Opening chrome://extensions ..."
$manifestPath = Join-Path $PSScriptRoot "..\..\extension\manifest.json"
$version = (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).version
Write-Host "Find MY-BOT Lead Radar and click Reload until the version shows $version"
Start-Process "chrome" "chrome://extensions/"
