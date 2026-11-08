# Read-only Windows resources for MY-BOT desktop planning. ASCII for PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$env:SystemDrive'"
$vmms = Get-Service vmms -ErrorAction SilentlyContinue
[pscustomobject]@{
    Windows = $os.Caption
    RamGB = [math]::Round($cs.TotalPhysicalMemory / 1GB)
    FreeRamGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
    LogicalProcessors = $cs.NumberOfLogicalProcessors
    HypervisorPresent = $cs.HypervisorPresent
    HyperVModuleAvailable = [bool](Get-Module -ListAvailable Hyper-V)
    HyperVService = $(if ($vmms) { [string]$vmms.Status } else { 'Missing' })
    SystemDriveFreeGB = [math]::Round($disk.FreeSpace / 1GB, 1)
} | ConvertTo-Json -Compress
