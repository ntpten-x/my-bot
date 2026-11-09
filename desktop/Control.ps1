param([ValidateSet('Start', 'Stop', 'Open', 'Status', 'Password', 'Resume', 'Uninstall', 'Purge', 'KeepAlive')][string]$Action = 'Open')
$ErrorActionPreference = 'Stop'
$Distro = 'MYBOT-Desktop-V1'
$StatePath = Join-Path $PSScriptRoot 'install-state.json'
if (-not (Test-Path -LiteralPath $StatePath)) { throw 'MY-BOT Desktop is not installed.' }
$State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
if ($State.distribution -ne $Distro -or $State.product -ne 'MY-BOT Desktop') { throw 'Invalid desktop installation.' }
. (Join-Path $PSScriptRoot 'ports.ps1')
$Ports = Get-DesktopPortSettings $State
$ViewerPort = $Ports.viewerPort
$Texts = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'strings.th.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$ViewerUrl = "http://localhost:$ViewerPort/vnc.html?host=localhost&port=$ViewerPort&resize=scale"
if ($Action -in @('Resume', 'Uninstall', 'Purge')) {
    Add-Type -AssemblyName System.Windows.Forms
    $Prompt = if ($Action -eq 'Resume') { $Texts.resumeConfirm } elseif ($Action -eq 'Purge') { $Texts.purgeConfirm } else { $Texts.uninstallConfirm }
    if ([Windows.Forms.MessageBox]::Show($Prompt, $Texts.title, [Windows.Forms.MessageBoxButtons]::YesNo) -ne [Windows.Forms.DialogResult]::Yes) { exit 0 }
}
if ($Action -eq 'KeepAlive') {
    $Guard = New-Object Threading.Mutex($false, 'Local\MYBOTDesktopRuntimeV1')
    $OwnsGuard = $false
    try {
        $OwnsGuard = $Guard.WaitOne(0)
        if (-not $OwnsGuard) { exit 0 }
        & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh keepalive
        if ($LASTEXITCODE -ne 0) { throw 'Desktop keep-alive ended. Inspect the desktop status before restarting.' }
    } finally {
        if ($OwnsGuard) { $Guard.ReleaseMutex() }
        $Guard.Dispose()
    }
    exit 0
}
if ($Action -in @('Start', 'Open')) {
    $ControlScript = Join-Path $PSScriptRoot 'Control.ps1'
    $Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $ControlScript + '" -Action KeepAlive'
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $Arguments -WindowStyle Hidden | Out-Null
    if ($Action -eq 'Start') { exit 0 }
    $Ready = $false
    $Detail = 'viewer not ready'
    for ($Attempt = 0; $Attempt -lt 45; $Attempt++) {
        try {
            $Response = Invoke-WebRequest -UseBasicParsing -Method Head -TimeoutSec 2 -Uri "http://localhost:$ViewerPort/vnc.html"
            if ($Response.StatusCode -eq 200) {
                $Report = & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh status
                if ($LASTEXITCODE -eq 0) {
                    $Data = ($Report -join "`n") | ConvertFrom-Json
                    if ($Data.supervisor.desktop -eq 'running' -and $Data.viewerPort -eq $ViewerPort -and $Data.vncPort -eq $Ports.vncPort -and $Data.viewerReady -and $Data.vncListening) { $Ready = $true; break }
                    $Detail = 'desktop=' + [string]$Data.supervisor.desktop + ' viewerReady=' + [string]$Data.viewerReady + ' vncListening=' + [string]$Data.vncListening
                } else { $Detail = 'status command failed' }
            }
        } catch { $Detail = $_.Exception.Message }
        Start-Sleep -Seconds 1
    }
    if (-not $Ready) { throw "The viewer is not ready ($Detail). Open $ViewerUrl manually; Chrome was not force-restarted." }
    try {
        Start-Process $ViewerUrl
    } catch {
        throw "Could not open the default browser for $ViewerUrl. $($_.Exception.Message)"
    }
    exit 0
}
if ($Action -eq 'Uninstall') {
    & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh disable
    if ($LASTEXITCODE -ne 0) { throw 'Stop failed. Startup files were not removed.' }
    $Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\MY-BOT-Desktop.vbs'
    if (Test-Path -LiteralPath $Startup) { Remove-Item -LiteralPath $Startup -Force }
    Write-Host 'MY-BOT Desktop autostart removed. Distro, browser profile, paired credentials and queued posts were retained. Use Purge to delete them.'
    exit 0
}
if ($Action -eq 'Purge') {
    & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh disable 2>$null
    $Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\MY-BOT-Desktop.vbs'
    if (Test-Path -LiteralPath $Startup) { Remove-Item -LiteralPath $Startup -Force }
    $Links = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MY-BOT Desktop'
    if (Test-Path -LiteralPath $Links) { Remove-Item -LiteralPath $Links -Recurse -Force }
    & wsl.exe --unregister $Distro
    if ($LASTEXITCODE -ne 0) { throw 'Could not unregister MYBOT-Desktop-V1. Local files were not deleted.' }
    $AppRoot = $PSScriptRoot
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $AppRoot -Force | Where-Object { $_.Name -ne 'Control.ps1' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host 'MY-BOT Desktop environment removed from this PC.'
    exit 0
}
$Command = $Action.ToLowerInvariant()
if ($Action -eq 'Status') {
    $Report = & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh status
    if ($LASTEXITCODE -ne 0) { throw 'Could not read desktop status.' }
    $Data = ($Report -join "`n") | ConvertFrom-Json
    $Ready = $Data.supervisor.phase -eq 'running' -and $Data.webReady -and $Data.vncListening -and $Data.viewerReady
    $Message = if ($Ready) { $Texts.statusReady } else { $Texts.statusAttention }
    $Detail = @(
        $State.serverOrigin,
        ('release=' + [string]$State.releaseId),
        ('viewer=' + $ViewerUrl),
        ('phase=' + [string]$Data.supervisor.phase),
        ('desktop=' + [string]$Data.supervisor.desktop),
        ('webReady=' + [string]$Data.webReady),
        ('viewerReady=' + [string]$Data.viewerReady),
        ('vncListening=' + [string]$Data.vncListening)
    ) -join "`r`n"
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($Message + "`r`n" + $Detail, $Texts.status) | Out-Null
    exit 0
}
& wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh $Command
if ($LASTEXITCODE -ne 0) { throw 'MY-BOT Desktop action failed. No profile or pending posts were deleted.' }
