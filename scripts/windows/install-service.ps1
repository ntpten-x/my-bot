$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Node = (Get-Command node -ErrorAction Stop).Source
$Startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$VbsPath = Join-Path $Startup "MY-BOT.vbs"

$env:OLLAMA_MAX_LOADED_MODELS = "2"
$env:OLLAMA_KEEP_ALIVE = "30m"
setx OLLAMA_MAX_LOADED_MODELS "2" | Out-Null
setx OLLAMA_KEEP_ALIVE "30m" | Out-Null
Write-Host "OLLAMA_MAX_LOADED_MODELS=2"
Write-Host "OLLAMA_KEEP_ALIVE=30m"

function Write-StartupLauncher {
  New-Item -ItemType Directory -Force -Path $Startup | Out-Null
  $repoVbs = $Repo.Replace("\", "\\")
  $nodeVbs = $Node.Replace("\", "\\")
  $vbs = @"
Set shell = CreateObject("Wscript.Shell")
shell.Environment("PROCESS").Item("OLLAMA_HOST") = "127.0.0.1:41434"
shell.Environment("PROCESS").Item("OLLAMA_BASE_URL") = "http://127.0.0.1:41434"
shell.Environment("PROCESS").Item("OLLAMA_MAX_LOADED_MODELS") = "2"
shell.Environment("PROCESS").Item("OLLAMA_KEEP_ALIVE") = "30m"
shell.Run "cmd /c set OLLAMA_HOST=127.0.0.1:41434&& set OLLAMA_MAX_LOADED_MODELS=2&& set OLLAMA_KEEP_ALIVE=30m&& ollama serve", 0, False
WScript.Sleep 1500
shell.CurrentDirectory = "$repoVbs"
shell.Run "cmd /c set OLLAMA_HOST=127.0.0.1:41434&& set OLLAMA_MAX_LOADED_MODELS=2&& set OLLAMA_KEEP_ALIVE=30m&& set OLLAMA_BASE_URL=http://127.0.0.1:41434&& ""$nodeVbs"" scripts\start-all.mjs --prod", 0, False
"@
  Set-Content -Path $VbsPath -Value $vbs -Encoding ASCII
  Write-Host "Startup launcher written: $VbsPath"
  Write-Host "It starts Ollama on 127.0.0.1:41434 and MY-BOT hidden at logon."
}

Write-Host "Building production app in $Repo"
Push-Location $Repo
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm run build failed" }
Pop-Location

$registered = $false
try {
  $Command = "Set-Location -LiteralPath '$Repo'; & '$Node' 'scripts/start-all.mjs' --prod"
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
