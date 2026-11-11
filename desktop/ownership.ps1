$script:DesktopOwnerMarker = '/etc/mybot-desktop-owner'
$script:DesktopOwnerValue = 'MYBOT-Desktop-V1'

function Invoke-DesktopWslRoot([string]$Distribution, [string]$LinuxCommand) {
    # Native wsl/cat failures must not become terminating errors under $ErrorActionPreference Stop,
    # or incomplete installs cannot be detected and resumed.
    $Previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # bash -lc keeps the Linux path literal (avoids MSYS rewriting /etc/...).
        $Output = & wsl.exe -d $Distribution -u root -- bash -lc $LinuxCommand 2>$null
        return @{ ExitCode = [int]$LASTEXITCODE; Output = $Output }
    } finally {
        $ErrorActionPreference = $Previous
    }
}

function Get-DesktopOwnerMarker([string]$Distribution = 'MYBOT-Desktop-V1') {
    $Result = Invoke-DesktopWslRoot -Distribution $Distribution -LinuxCommand "if [ -f '$script:DesktopOwnerMarker' ]; then cat '$script:DesktopOwnerMarker'; else exit 2; fi"
    if ($Result.ExitCode -ne 0) { return $null }
    return (($Result.Output | Out-String).Trim())
}

function Set-DesktopOwnerMarker([string]$Distribution = 'MYBOT-Desktop-V1') {
    $Result = Invoke-DesktopWslRoot -Distribution $Distribution -LinuxCommand "printf '%s\n' '$script:DesktopOwnerValue' > '$script:DesktopOwnerMarker'"
    if ($Result.ExitCode -ne 0) { throw 'Could not record MY-BOT Desktop ownership.' }
}

function Test-DesktopOwnedDistro([string]$Distribution = 'MYBOT-Desktop-V1') {
    return (Get-DesktopOwnerMarker -Distribution $Distribution) -ceq $script:DesktopOwnerValue
}

function Test-DesktopMybotUser([string]$Distribution = 'MYBOT-Desktop-V1') {
    $Result = Invoke-DesktopWslRoot -Distribution $Distribution -LinuxCommand 'id -u mybot >/dev/null 2>&1'
    return $Result.ExitCode -eq 0
}

function Assert-DesktopOwnedDistro([string]$Distribution = 'MYBOT-Desktop-V1', [string]$Message = 'Desktop ownership could not be verified.') {
    if (-not (Test-DesktopOwnedDistro -Distribution $Distribution)) { throw $Message }
}

function Assert-DesktopOwnedOrResumable(
    [string]$Distribution = 'MYBOT-Desktop-V1',
    [switch]$ResumableByState,
    [string]$Message = 'Desktop ownership could not be verified.'
) {
    $Marker = Get-DesktopOwnerMarker -Distribution $Distribution
    if ($Marker -ceq $script:DesktopOwnerValue) { return 'owned' }
    if ($Marker) { throw $Message }
    if (-not $ResumableByState) { throw $Message }
    # Windows install-state already proves this incomplete distro is ours; stamp Linux ownership and resume.
    Set-DesktopOwnerMarker -Distribution $Distribution
    return 'resumed'
}
