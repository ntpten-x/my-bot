param([switch]$CheckOnly, [switch]$CheckPorts)
$ErrorActionPreference = 'Stop'
$Distro = 'MYBOT-Desktop-V1'
$PackageDir = $PSScriptRoot
$Metadata = Get-Content -LiteralPath (Join-Path $PackageDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Texts = Get-Content -LiteralPath (Join-Path $PackageDir 'strings.th.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Image = Get-Content -LiteralPath (Join-Path $PackageDir 'rootfs.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Check-Package {
    if ($Metadata.format -ne 1 -or $Metadata.name -ne 'MY-BOT Desktop' -or $Metadata.releaseId -notmatch '^[a-f0-9]{24}$') { throw 'Invalid desktop package.' }
    $Origin = [Uri]$Metadata.serverOrigin
    if ($Origin.Scheme -ne 'https' -or $Origin.UserInfo -or $Origin.AbsolutePath -ne '/' -or $Origin.Query -or $Origin.Fragment -or $Origin.IsLoopback) { throw 'Use a production HTTPS origin.' }
    if ($Image.distribution -ne $Distro -or $Image.architecture -ne 'amd64' -or $Image.sha256 -notmatch '^[a-f0-9]{64}$' -or $Image.commit -notmatch '^[a-f0-9]{40}$' -or $Image.format -ne 'gzip' -or $Image.sizeBytes -lt 1MB -or $Image.sizeBytes -gt 1GB) { throw 'Invalid pinned operating system image.' }
    $ExpectedUrl = 'https://raw.githubusercontent.com/debuerreotype/docker-debian-artifacts/' + $Image.commit + '/trixie/oci/blobs/rootfs.tar.gz'
    if ($Image.url -cne $ExpectedUrl) { throw 'Invalid immutable operating system source.' }
    foreach ($File in $Metadata.files) {
        if ($File.path -notmatch '^[a-zA-Z0-9_./-]+$' -or $File.path -match '(^|/)\.\.(/|$)' -or $File.path.StartsWith('/') -or $File.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid package path or hash.' }
        $Target = Join-Path $PackageDir $File.path
        if ((Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $File.sha256) { throw 'Package verification failed. Download it again.' }
    }
}
Check-Package
if ($CheckOnly) { Write-Host 'PASS: package hashes, HTTPS server and pinned image metadata. No installation performed.'; exit 0 }
. (Join-Path $PackageDir 'ports.ps1')
. (Join-Path $PackageDir 'image.ps1')
if ($CheckPorts) { Select-DesktopPorts | ConvertTo-Json -Compress; exit 0 }
Add-Type -AssemblyName System.Windows.Forms
function Confirm-Install([string]$Message) {
    return [Windows.Forms.MessageBox]::Show($Message, $Texts.title, [Windows.Forms.MessageBoxButtons]::YesNo, [Windows.Forms.MessageBoxIcon]::Question) -eq [Windows.Forms.DialogResult]::Yes
}
function Run-Wsl([string[]]$WslArguments) {
    & wsl.exe @WslArguments
    if ($LASTEXITCODE -ne 0) { throw 'WSL command failed. Installation stopped without deleting existing browser data.' }
}
$InstallLock = New-Object Threading.Mutex($false, 'Local\MYBOTDesktopInstallV1')
$OwnsLock = $false
try {
    $OwnsLock = $InstallLock.WaitOne(0)
    if (-not $OwnsLock) { throw 'Another MY-BOT Desktop installer is running.' }
    $Architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ([Environment]::OSVersion.Version.Build -lt 22000 -or $Architecture -ne 'AMD64') { throw $Texts.unsupported }
    if (-not (Confirm-Install ($Texts.consent + "`r`n`r`n" + $Metadata.serverOrigin))) { exit 0 }
    $Wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if ($Wsl) { & wsl.exe --status *> $null; $WslReady = $LASTEXITCODE -eq 0 } else { $WslReady = $false }
    if (-not $WslReady) {
        if (Confirm-Install $Texts.wslMissing) {
            Start-Process -FilePath 'wsl.exe' -ArgumentList '--install --no-distribution --no-launch' -Verb RunAs -Wait
        }
        throw $Texts.wslMissing
    }
    $AppRoot = Join-Path $env:LOCALAPPDATA 'MY-BOT Desktop'
    $DriveName = ([IO.Path]::GetPathRoot($AppRoot)).TrimEnd('\').TrimEnd(':')
    $Drive = Get-PSDrive -Name $DriveName
    if ($Drive.Free -lt 4GB) { throw 'At least 4 GB of free disk space is required for initial setup.' }
    $StatePath = Join-Path $AppRoot 'install-state.json'
    $State = if (Test-Path -LiteralPath $StatePath) { Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json } else { $null }
    $Distros = ((& wsl.exe --list --quiet) -replace "`0", '') | ForEach-Object { $_.Trim() }
    if ($LASTEXITCODE -ne 0) { throw 'Cannot list WSL distributions.' }
    $Exists = $Distros -contains $Distro
    if ($Exists -and (-not $State -or $State.distribution -ne $Distro -or $State.product -ne 'MY-BOT Desktop')) { throw $Texts.existingUnknown }
    if ($State -and $State.serverOrigin -ne $Metadata.serverOrigin) { throw 'This install belongs to another server. Existing pairing was not changed.' }
    if ($Exists) {
        & wsl.exe -d $Distro -u root -- test -f /etc/mybot-desktop-owner 2>$null
        if ($LASTEXITCODE -eq 0) {
            & wsl.exe -d $Distro -u mybot -- bash -lc 'export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user is-active --quiet mybot-workstation.service' 2>$null
            if ($LASTEXITCODE -eq 0) { throw $Texts.updateBlocked }
        }
    }
    $Ports = Select-DesktopPorts -Existing $State
    $NewState = @{ product = 'MY-BOT Desktop'; distribution = $Distro; serverOrigin = $Metadata.serverOrigin; releaseId = $Metadata.releaseId; vncPort = $Ports.vncPort; viewerPort = $Ports.viewerPort }
    New-Item -ItemType Directory -Force -Path $AppRoot | Out-Null
    $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $AppRoot /inheritance:r /grant:r "*${UserSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect the local installation directory.' }
    if (-not $Exists) {
        Write-Host $Texts.downloading
        $ImagePath = Join-Path $AppRoot 'debian.wsl'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Save-DesktopImage -Path $ImagePath -Image $Image
        Run-Wsl -WslArguments @('--import', $Distro, (Join-Path $AppRoot 'linux'), $ImagePath, '--version', '2')
        # Record ownership immediately so an interrupted setup can resume without adopting another distro.
        $NewState | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    }
    Write-Host $Texts.provisioning
    $WindowsSource = $PackageDir
    $LinuxSource = ((& wsl.exe -d $Distro -u root -- wslpath -u $WindowsSource) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $LinuxSource.StartsWith('/')) { throw 'Cannot locate the downloaded package in WSL.' }
    Run-Wsl -WslArguments @('-d', $Distro, '-u', 'root', '--', 'bash', "$LinuxSource/provision.sh", $LinuxSource, [string]$Ports.vncPort, [string]$Ports.viewerPort)
    # Only the dedicated, owned distro is restarted; never wsl --shutdown.
    Run-Wsl -WslArguments @('--terminate', $Distro)
    Copy-Item -LiteralPath (Join-Path $PackageDir 'Control.ps1') -Destination (Join-Path $AppRoot 'Control.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PackageDir 'ports.ps1') -Destination (Join-Path $AppRoot 'ports.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PackageDir 'strings.th.json') -Destination (Join-Path $AppRoot 'strings.th.json') -Force
    $NewState | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    Write-Host $Texts.password
    & (Join-Path $AppRoot 'Control.ps1') -Action Password
    & (Join-Path $AppRoot 'Control.ps1') -Action Start
    $Shell = New-Object -ComObject WScript.Shell
    $Links = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MY-BOT Desktop'
    New-Item -ItemType Directory -Force -Path $Links | Out-Null
    foreach ($Item in @(@($Texts.viewer, 'Open'), @($Texts.start, 'Start'), @($Texts.stop, 'Stop'), @($Texts.status, 'Status'), @($Texts.resume, 'Resume'), @($Texts.uninstall, 'Uninstall'))) {
        $Link = $Shell.CreateShortcut((Join-Path $Links ($Item[0] + '.lnk')))
        $Link.TargetPath = (Join-Path $PSHOME 'powershell.exe')
        $Link.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $AppRoot 'Control.ps1') + '" -Action ' + $Item[1]
        $Link.WorkingDirectory = $AppRoot
        $Link.WindowStyle = if ($Item[1] -eq 'Status') { 1 } else { 7 }
        $Link.Save()
    }
    $Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\MY-BOT-Desktop.vbs'
    $StartCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $AppRoot 'Control.ps1') + '" -Action Start'
    $VbsCommand = $StartCommand.Replace('"', '""')
    Set-Content -LiteralPath $Startup -Encoding Unicode -Value "Set shell = CreateObject(""Wscript.Shell"")`r`nshell.Run ""$VbsCommand"", 0, False"
    $NewState | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    [Windows.Forms.MessageBox]::Show($Texts.done, $Texts.title) | Out-Null
    & (Join-Path $AppRoot 'Control.ps1') -Action Open
} catch {
    Write-Host $_.Exception.Message
    [Windows.Forms.MessageBox]::Show($Texts.failed + "`r`n" + $_.Exception.Message, $Texts.title) | Out-Null
    exit 1
} finally {
    if ($OwnsLock) { $InstallLock.ReleaseMutex() }
    $InstallLock.Dispose()
}
