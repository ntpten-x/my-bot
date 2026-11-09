param(
  [Parameter(Mandatory = $true)][string]$Distro,
  [Parameter(Mandatory = $true)][string]$Repo
)
$ErrorActionPreference = "Stop"
foreach ($Value in @($Distro, $Repo)) {
  if ($Value -match '["\r\n]' -or [string]::IsNullOrWhiteSpace($Value)) {
    throw "Invalid launcher argument."
  }
}
if (-not $Repo.StartsWith("/")) {
  throw "Repo must be an absolute Linux path."
}
$Startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$Launcher = Join-Path $Startup "MY-BOT-WSL.vbs"
New-Item -ItemType Directory -Force -Path $Startup | Out-Null
$Command = 'wsl.exe -d "' + $Distro + '" --cd "' + $Repo + '" -- bash "' + $Repo + '/desktop/keepalive.sh"'
$VbsCommand = $Command.Replace('"', '""')
$Content = "Set shell = CreateObject(""Wscript.Shell"")`r`nshell.Run ""$VbsCommand"", 0, False`r`n"
# PowerShell stays ASCII; UTF-16 preserves a user's non-ASCII distro/repo path in VBS.
Set-Content -LiteralPath $Launcher -Value $Content -Encoding Unicode
Write-Host "Installed MY-BOT-WSL logon launcher. It starts web and isolated desktop, without a local worker."
Write-Host "Keep Windows/WSL awake. It runs at user logon, not before login."
Write-Host "Uninstall: powershell -ExecutionPolicy Bypass -File scripts\windows\uninstall-wsl-workstation.ps1"
if (Test-Path (Join-Path $Startup "MY-BOT.vbs")) {
  Write-Warning "Legacy MY-BOT.vbs also exists. Review it to avoid starting another app/worker. It was not changed."
}
