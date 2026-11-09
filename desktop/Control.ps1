param([ValidateSet('Start', 'Stop', 'Open', 'Status', 'Password', 'Resume', 'Uninstall', 'KeepAlive')][string]$Action = 'Open')
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
if ($Action -in @('Resume', 'Uninstall')) {
    Add-Type -AssemblyName System.Windows.Forms
    $Prompt = if ($Action -eq 'Resume') { $Texts.resumeConfirm } else { $Texts.uninstallConfirm }
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
    for ($Attempt = 0; $Attempt -lt 45; $Attempt++) {
        try {
            $Response = Invoke-WebRequest -UseBasicParsing -Method Head -TimeoutSec 2 -Uri "http://localhost:$ViewerPort/vnc.html"
            if ($Response.StatusCode -eq 200) {
                $Report = & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh status
                if ($LASTEXITCODE -eq 0) {
                    $Data = ($Report -join "`n") | ConvertFrom-Json
                    if ($Data.supervisor.desktop -eq 'running' -and $Data.viewerPort -eq $ViewerPort -and $Data.vncPort -eq $Ports.vncPort -and $Data.viewerReady -and $Data.vncListening) { $Ready = $true; break }
                }
            }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $Ready) { throw 'The viewer is not ready. Use the status shortcut; Chrome was not force-restarted.' }
    Start-Process "http://localhost:$ViewerPort/vnc.html?host=localhost&port=$ViewerPort&resize=scale"
    exit 0
}
if ($Action -eq 'Uninstall') {
    & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh disable
    if ($LASTEXITCODE -ne 0) { throw 'Stop failed. Startup files were not removed.' }
    $Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\MY-BOT-Desktop.vbs'
    if (Test-Path -LiteralPath $Startup) { Remove-Item -LiteralPath $Startup -Force }
    $Links = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MY-BOT Desktop'
    if (Test-Path -LiteralPath $Links) { Remove-Item -LiteralPath $Links -Recurse -Force }
    Write-Host 'MY-BOT Desktop autostart removed. Browser profile, paired credentials and queued posts were retained.'
    exit 0
}
$Command = $Action.ToLowerInvariant()
if ($Action -eq 'Status') {
    $Report = & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh status
    if ($LASTEXITCODE -ne 0) { throw 'Could not read desktop status.' }
    $Data = ($Report -join "`n") | ConvertFrom-Json
    $Message = if ($Data.supervisor.phase -eq 'running' -and $Data.webReady -and $Data.vncListening -and $Data.viewerReady) { $Texts.statusReady } else { $Texts.statusAttention }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($Message + "`r`n" + $State.serverOrigin, $Texts.status) | Out-Null
    exit 0
}
& wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh $Command
if ($LASTEXITCODE -ne 0) { throw 'MY-BOT Desktop action failed. No profile or pending posts were deleted.' }
