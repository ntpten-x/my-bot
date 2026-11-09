$script:DesktopOwnerMarker = '/etc/mybot-desktop-owner'
$script:DesktopOwnerValue = 'MYBOT-Desktop-V1'

function Get-DesktopOwnerMarker([string]$Distribution = 'MYBOT-Desktop-V1') {
    $Output = & wsl.exe -d $Distribution -u root -- cat $script:DesktopOwnerMarker 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return (($Output | Out-String).Trim())
}

function Test-DesktopOwnedDistro([string]$Distribution = 'MYBOT-Desktop-V1') {
    return (Get-DesktopOwnerMarker -Distribution $Distribution) -ceq $script:DesktopOwnerValue
}

function Assert-DesktopOwnedDistro([string]$Distribution = 'MYBOT-Desktop-V1', [string]$Message = 'Desktop ownership could not be verified.') {
    if (-not (Test-DesktopOwnedDistro -Distribution $Distribution)) { throw $Message }
}
