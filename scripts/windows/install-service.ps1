$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Node = (Get-Command node -ErrorAction Stop).Source
$Startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$VbsPath = Join-Path $Startup "MY-BOT.vbs"


function Write-StartupLauncher {
  New-Item -ItemType Directory -Force -Path $Startup | Out-Null
  $repoVbs = $Repo.Replace("\", "\\")
  $nodeVbs = $Node.Replace("\", "\\")
  $vbs = @"
Set shell = CreateObject("Wscript.Shell")
shell.CurrentDirectory = "$repoVbs"
shell.Run "cmd /c mkdir data 2>nul & ""$nodeVbs"" scripts\start-all.mjs --prod >> data\mybot-console.log 2>&1", 0, False
"@
  Set-Content -Path $VbsPath -Value $vbs -Encoding ASCII
  Write-Host "Startup launcher written: $VbsPath"
  Write-Host "It starts MY-BOT hidden at logon."
}

Write-Host "Building production app in $Repo"
Push-Location $Repo
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm run build failed" }
Pop-Location

$registered = $false
try {
  $Command = "New-Item -ItemType Directory -Force -Path '$Repo\data' | Out-Null; Set-Location -LiteralPath '$Repo'; & '$Node' 'scripts/start-all.mjs' --prod *>> '$Repo\data\mybot-console.log'"
  $Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command $Command"
  $Trigger = New-ScheduledTaskTrigger -AtLogOn
  $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName "MY-BOT" -Action $Action -Trigger $Trigger -Settings $Settings -Description "MY-BOT lead radar on port 8001" -Force | Out-Null
  $registered = $true
  Write-Host "Scheduled task MY-BOT registered. Start now: Start-ScheduledTask -TaskName MY-BOT"
} catch {
  Write-Host "Scheduled task was not registered (access denied for a non-admin is normal)."
  Write-Host $_.Exception.Message
}

Write-StartupLauncher
if (-not $registered) {
  Write-Host "Using the Startup folder launcher instead of Task Scheduler."
}
