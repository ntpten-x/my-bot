# One-shot repair for an install that finished runtime/password but failed Thai Start Menu links.
# WScript.Shell cannot Save()/Open() .lnk paths that contain Thai; create ASCII then Rename-Item.
$ErrorActionPreference = 'Stop'
$AppRoot = Join-Path $env:LOCALAPPDATA 'MY-BOT Desktop'
if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'Control.ps1'))) { throw 'MY-BOT Desktop is not installed.' }
$Texts = Get-Content -LiteralPath (Join-Path $AppRoot 'strings.th.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Shell = New-Object -ComObject WScript.Shell
$Links = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MY-BOT Desktop'
New-Item -ItemType Directory -Force -Path $Links | Out-Null
foreach ($Item in @(@($Texts.viewer, 'Open'), @($Texts.start, 'Start'), @($Texts.stop, 'Stop'), @($Texts.status, 'Status'), @($Texts.resume, 'Resume'), @($Texts.rollback, 'Rollback'), @($Texts.uninstall, 'Uninstall'), @($Texts.purge, 'Purge'))) {
    $FinalName = $Item[0] + '.lnk'
    $TempPath = Join-Path $Links ('MY-BOT Desktop - ' + $Item[1] + '.tmp.lnk')
    $FinalPath = Join-Path $Links $FinalName
    if (Test-Path -LiteralPath $TempPath) { Remove-Item -LiteralPath $TempPath -Force }
    if (Test-Path -LiteralPath $FinalPath) { Remove-Item -LiteralPath $FinalPath -Force }
    $Link = $Shell.CreateShortcut($TempPath)
    $Link.TargetPath = (Join-Path $PSHOME 'powershell.exe')
    $Link.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $AppRoot 'Control.ps1') + '" -Action ' + $Item[1]
    $Link.WorkingDirectory = $AppRoot
    $Link.Description = $Item[0]
    $Link.WindowStyle = if ($Item[1] -eq 'Status') { 1 } else { 7 }
    $Link.Save()
    Rename-Item -LiteralPath $TempPath -NewName $FinalName
    $VerifyCopy = Join-Path $Links ('MY-BOT Desktop - ' + $Item[1] + '.verify.lnk')
    Copy-Item -LiteralPath $FinalPath -Destination $VerifyCopy -Force
    $Read = $Shell.CreateShortcut($VerifyCopy)
    $Ok = $Read.TargetPath -and ($Read.Arguments -like ('*-Action ' + $Item[1] + '*'))
    Remove-Item -LiteralPath $VerifyCopy -Force
    if (-not $Ok) { throw ('Shortcut repair incomplete for action ' + $Item[1]) }
}
$Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\MY-BOT-Desktop.vbs'
$StartCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $AppRoot 'Control.ps1') + '" -Action Start'
$VbsCommand = $StartCommand.Replace('"', '""')
Set-Content -LiteralPath $Startup -Encoding Unicode -Value "Set shell = CreateObject(""Wscript.Shell"")`r`nshell.Run ""$VbsCommand"", 0, False"
Write-Host 'PASS: Start Menu shortcuts and Startup launcher repaired.'
