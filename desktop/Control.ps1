param([ValidateSet('Start', 'Stop', 'Open', 'Status', 'Password', 'Resume', 'Rollback', 'Uninstall', 'Purge', 'KeepAlive')][string]$Action = 'Open')
$ErrorActionPreference = 'Stop'
$Distro = 'MYBOT-Desktop-V1'
$StatePath = Join-Path $PSScriptRoot 'install-state.json'
if (-not (Test-Path -LiteralPath $StatePath)) { throw 'MY-BOT Desktop is not installed.' }
$State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
if ($State.distribution -ne $Distro -or $State.product -ne 'MY-BOT Desktop') { throw 'Invalid desktop installation.' }
. (Join-Path $PSScriptRoot 'ports.ps1')
. (Join-Path $PSScriptRoot 'ownership.ps1')
$Ports = Get-DesktopPortSettings $State
$ViewerPort = $Ports.viewerPort
$Texts = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'strings.th.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$ViewerUrl = "http://localhost:$ViewerPort/vnc.html?host=localhost&port=$ViewerPort&resize=scale"
function Test-DesktopRuntimeReady($Data) {
    return [bool]($Data.supervisor.phase -eq 'running' -and $Data.supervisor.desktop -eq 'running' -and $Data.webReady -and $Data.viewerReady -and $Data.vncListening -and $Data.viewerPort -eq $Ports.viewerPort -and $Data.vncPort -eq $Ports.vncPort)
}
if ($Action -in @('Resume', 'Rollback', 'Uninstall', 'Purge')) {
    Add-Type -AssemblyName System.Windows.Forms
    $Prompt = if ($Action -eq 'Resume') { $Texts.resumeConfirm } elseif ($Action -eq 'Rollback') { $Texts.rollbackConfirm } elseif ($Action -eq 'Purge') { $Texts.purgeConfirm } else { $Texts.uninstallConfirm }
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
    Assert-DesktopOwnedDistro -Distribution $Distro -Message $Texts.existingUnknown
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
                    if (Test-DesktopRuntimeReady $Data) { $Ready = $true; break }
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
    Assert-DesktopOwnedDistro -Distribution $Distro -Message $Texts.existingUnknown
    & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh disable
    if ($LASTEXITCODE -ne 0) { throw 'Stop failed. Startup files were not removed.' }
    $Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\MY-BOT-Desktop.vbs'
    if (Test-Path -LiteralPath $Startup) { Remove-Item -LiteralPath $Startup -Force }
    Write-Host 'MY-BOT Desktop autostart removed. Distro, browser profile, paired credentials and queued posts were retained. Use Purge to delete them.'
    exit 0
}
if ($Action -eq 'Rollback') {
    Assert-DesktopOwnedDistro -Distribution $Distro -Message $Texts.existingUnknown
    & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh disable 2>$null
    & wsl.exe -d $Distro -u root -- bash /opt/mybot-desktop/current/desktop/rollback.sh
    if ($LASTEXITCODE -ne 0) { throw 'Rollback failed. Current release and profile were left unchanged.' }
    Write-Host $Texts.rollbackDone
    exit 0
}
if ($Action -eq 'Purge') {
    $Distros = ((& wsl.exe --list --quiet) -replace "`0", '') | ForEach-Object { $_.Trim() }
    $Exists = $Distros -contains $Distro
    if ($Exists) {
        # Never unregister a same-named distro unless Linux ownership matches exactly.
        Assert-DesktopOwnedDistro -Distribution $Distro -Message $Texts.purgeOwnership
        & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh disable 2>$null
    }
    $Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\MY-BOT-Desktop.vbs'
    if (Test-Path -LiteralPath $Startup) { Remove-Item -LiteralPath $Startup -Force }
    $Links = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MY-BOT Desktop'
    if (Test-Path -LiteralPath $Links) { Remove-Item -LiteralPath $Links -Recurse -Force }
    if ($Exists) {
        & wsl.exe --unregister $Distro
        if ($LASTEXITCODE -ne 0) { throw 'Could not unregister MYBOT-Desktop-V1. Local files were not deleted.' }
    }
    $AppRoot = $PSScriptRoot
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $AppRoot -Force | Where-Object { $_.Name -ne 'Control.ps1' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host 'MY-BOT Desktop environment removed from this PC.'
    exit 0
}
$Command = $Action.ToLowerInvariant()
if ($Action -eq 'Status') {
    Assert-DesktopOwnedDistro -Distribution $Distro -Message $Texts.existingUnknown
    $Report = & wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh status
    if ($LASTEXITCODE -ne 0) { throw 'Could not read desktop status.' }
    $Data = ($Report -join "`n") | ConvertFrom-Json
    $Ready = Test-DesktopRuntimeReady $Data
    $Message = if ($Ready) { $Texts.statusReady } else { $Texts.statusAttention }
    $InstalledVersion = [string]$State.desktopVersion
    $InstalledExtension = [string]$State.extensionVersion
    $ServerDesktop = ''
    $ServerExtension = ''
    try {
        $Health = Invoke-WebRequest -UseBasicParsing -Method Get -TimeoutSec 8 -Uri ($State.serverOrigin.TrimEnd('/') + '/api/v1/health')
        $ServerDesktop = [string]$Health.Headers['X-MYBOT-Desktop-Version']
        $ServerExtension = [string]$Health.Headers['X-MYBOT-Extension-Version']
    } catch { $ServerDesktop = ''; $ServerExtension = '' }
    $UpdateHint = if ($ServerDesktop -and $InstalledVersion -and $ServerDesktop -ne $InstalledVersion) {
        'มีรุ่น Desktop บนเซิร์ฟเวอร์ ' + $ServerDesktop + ' (เครื่องนี้ ' + $InstalledVersion + ') — หยุดบอทแล้วดาวน์โหลด ZIP ใหม่จากเว็บเดิม'
    } elseif ($ServerDesktop) { 'รุ่น Desktop บนเซิร์ฟเวอร์=' + $ServerDesktop } else { 'ตรวจรุ่น Desktop บนเซิร์ฟเวอร์ไม่ได้ตอนนี้' }
    $ExtensionHint = if ($ServerExtension -and $InstalledExtension -and $ServerExtension -ne $InstalledExtension) {
        'ส่วนขยายในเครื่อง ' + $InstalledExtension + ' ไม่ตรงเซิร์ฟเวอร์ ' + $ServerExtension + ' — คอมเมนต์อัตโนมัติอาจถูกปฏิเสธจนกว่าจะอัปเดต Desktop'
    } elseif ($InstalledExtension -and $ServerExtension) {
        'ส่วนขยายตรงกับเซิร์ฟเวอร์ (' + $InstalledExtension + ')'
    } elseif ($InstalledExtension) {
        'ส่วนขยายในเครื่อง=' + $InstalledExtension
    } else { 'ยังไม่บันทึกรุ่นส่วนขยายในเครื่อง — ติดตั้ง Desktop รุ่นใหม่เพื่อเปรียบเทียบ' }
    $Detail = @(
        $State.serverOrigin,
        ('release=' + [string]$State.releaseId),
        ('installed=' + $(if ($InstalledVersion) { $InstalledVersion } else { 'unknown' })),
        ('extension=' + $(if ($InstalledExtension) { $InstalledExtension } else { 'unknown' })),
        $UpdateHint,
        $ExtensionHint,
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
Assert-DesktopOwnedDistro -Distribution $Distro -Message $Texts.existingUnknown
& wsl.exe -d $Distro -u mybot -- bash /opt/mybot-desktop/current/desktop/control.sh $Command
if ($LASTEXITCODE -ne 0) { throw 'MY-BOT Desktop action failed. No profile or pending posts were deleted.' }
