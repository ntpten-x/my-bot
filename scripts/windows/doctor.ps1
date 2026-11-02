$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $Repo
npx tsx scripts/doctor.ts
exit $LASTEXITCODE
