$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../desktop/image.ps1')
$Root = Join-Path ([IO.Path]::GetTempPath()) ('mybot-image-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Root | Out-Null
function Assert-Test([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
try {
    $Good = Join-Path $Root 'fixture.gz'
    [IO.File]::WriteAllBytes($Good, [byte[]]@(31, 139, 8, 1, 2, 3, 4, 5))
    $Image = [pscustomobject]@{ url = 'https://fixture.invalid/image'; sizeBytes = 8; sha256 = (Get-FileHash $Good -Algorithm SHA256).Hash.ToLowerInvariant() }
    $Cache = Join-Path $Root 'cached.wsl'
    [IO.File]::WriteAllText($Cache, '<!DOCTYPE html><html><title>I Challenge Thee</title></html>')
    Assert-Test ((Get-DesktopImageStatus $Cache $Image).reason -eq 'html') 'HTML was not detected'
    $script:Calls = 0
    $DownloadGood = { param($Url, $Target) $script:Calls++; Copy-Item -LiteralPath $Good -Destination $Target -Force }
    Save-DesktopImage -Path $Cache -Image $Image -Download $DownloadGood -Pause { }
    Assert-Test ((Get-DesktopImageStatus $Cache $Image).valid) 'Verified bytes were not promoted'
    Save-DesktopImage -Path $Cache -Image $Image -Download { throw 'Valid cache should not download again' }
    Assert-Test ($script:Calls -eq 1) 'Valid cache was downloaded again'

    $Bad = Join-Path $Root 'bad.wsl'
    [IO.File]::WriteAllText($Bad, 'old cache')
    $HtmlDownload = { param($Url, $Target) [IO.File]::WriteAllText($Target, '<html>verification required</html>') }
    $ErrorText = ''
    try { Save-DesktopImage -Path $Bad -Image $Image -Download $HtmlDownload -Pause { } } catch { $ErrorText = $_.Exception.Message }
    Assert-Test ($ErrorText -like '*HTML verification page*') 'HTML failure was not actionable'
    Assert-Test ([IO.File]::ReadAllText($Bad) -eq 'old cache') 'Bad download replaced the original cache'

    $script:Tries = 0
    $Truncated = { param($Url, $Target) $script:Tries++; [IO.File]::WriteAllBytes($Target, [byte[]]@(31, 139)) }
    $ErrorText = ''
    try { Save-DesktopImage -Path $Bad -Image $Image -Download $Truncated -Pause { } } catch { $ErrorText = $_.Exception.Message }
    Assert-Test ($ErrorText -like '*incomplete*') 'Truncated image was not detected'
    Assert-Test ($script:Tries -eq 3) 'Transient retry bound was not preserved'
    Assert-Test ([IO.File]::ReadAllText($Bad) -eq 'old cache') 'Partial download replaced cache'

    $Wrong = [pscustomobject]@{ url = $Image.url; sizeBytes = 8; sha256 = ('0' * 64) }
    $ErrorText = ''
    try { Save-DesktopImage -Path $Bad -Image $Wrong -Download $DownloadGood -Pause { } } catch { $ErrorText = $_.Exception.Message }
    Assert-Test ($ErrorText -like '*checksum mismatch*') 'Wrong SHA-256 was accepted'
    Assert-Test ([IO.File]::ReadAllText($Bad) -eq 'old cache') 'Wrong checksum replaced cache'
    Write-Output 'PASS: HTML, truncation, checksum, verified cache reuse and atomic promotion'
} finally { Remove-Item -LiteralPath $Root -Recurse -Force }
