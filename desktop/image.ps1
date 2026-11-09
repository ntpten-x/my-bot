# Validate public operating-system downloads before replacing the cached image.
function Get-DesktopImageStatus([string]$Path, [object]$Image) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @{ valid = $false; reason = 'missing'; bytes = 0 } }
    $File = Get-Item -LiteralPath $Path
    if (($File.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refusing an operating system cache link.' }
    $Stream = [IO.File]::OpenRead($Path)
    $Prefix = New-Object byte[] 512
    try { $Count = $Stream.Read($Prefix, 0, $Prefix.Length) } finally { $Stream.Dispose() }
    $Text = [Text.Encoding]::UTF8.GetString($Prefix, 0, $Count).TrimStart()
    if ($Text -match '^(?i:<!doctype\s+html|<html)') { return @{ valid = $false; reason = 'html'; bytes = $File.Length } }
    if ($Count -lt 2 -or $Prefix[0] -ne 31 -or $Prefix[1] -ne 139) { return @{ valid = $false; reason = 'format'; bytes = $File.Length } }
    if ($Image.sizeBytes -and $File.Length -ne $Image.sizeBytes) { return @{ valid = $false; reason = 'size'; bytes = $File.Length } }
    $Hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    return @{ valid = ($Hash -eq $Image.sha256); reason = if ($Hash -eq $Image.sha256) { 'verified' } else { 'checksum' }; bytes = $File.Length }
}

function Save-DesktopImage([string]$Path, [object]$Image,
    [scriptblock]$Download = { param($Url, $Target) Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 -MaximumRedirection 3 -Uri $Url -OutFile $Target },
    [scriptblock]$Pause = { Start-Sleep -Seconds 2 }) {
    if ((Get-DesktopImageStatus -Path $Path -Image $Image).valid) { return }
    $Temporary = $Path + '.download'
    if ((Test-Path -LiteralPath $Temporary) -and ((Get-Item -LiteralPath $Temporary).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refusing an operating system download link.' }
    for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
        $Blocked = $false
        try {
            & $Download $Image.url $Temporary | Out-Null
            $Status = Get-DesktopImageStatus -Path $Temporary -Image $Image
            if ($Status.valid) {
                if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($Temporary, $Path, [NullString]::Value) }
                else { [IO.File]::Move($Temporary, $Path) }
                return
            }
            if ($Status.reason -eq 'html') {
                $Blocked = $true
                throw 'The image server returned an HTML verification page, not an operating system image. No image was imported.'
            }
            if ($Status.reason -eq 'size') { throw ('Operating system image is incomplete: received ' + $Status.bytes + ' bytes; expected ' + $Image.sizeBytes + '. No image was imported.') }
            throw 'Operating system image format or checksum mismatch. No image was imported.'
        } catch {
            if ($Blocked -or $Attempt -eq 3) { throw }
            & $Pause | Out-Null
        }
    }
}
