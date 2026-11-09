# Public port configuration only. Never stop the process occupying another port.
function Get-DesktopPortSettings([object]$State) {
    $Vnc = 5905
    $Viewer = 6085
    if ($State -and ($null -ne $State.vncPort -or $null -ne $State.viewerPort)) {
        foreach ($Value in @($State.vncPort, $State.viewerPort)) {
            if (($Value -isnot [int] -and $Value -isnot [long]) -or $Value -lt 1024 -or $Value -gt 65535) { throw 'Invalid saved Desktop ports.' }
        }
        $Vnc = [int]$State.vncPort
        $Viewer = [int]$State.viewerPort
    }
    if ($Vnc -eq $Viewer) { throw 'Desktop ports must be different.' }
    return @{ vncPort = $Vnc; viewerPort = $Viewer }
}

function Test-DesktopPortAvailable([int]$Port) {
    $Client = New-Object Net.Sockets.TcpClient
    try {
        $Connection = $Client.ConnectAsync('127.0.0.1', $Port)
        if ($Connection.Wait(200) -and $Client.Connected) { return $false }
    } catch { } finally { $Client.Dispose() }
    # Also reject reserved/unbindable Windows ports, even without a listener.
    $Listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $Listener.Start(); return $true } catch { return $false } finally { $Listener.Stop() }
}

function Select-DesktopPorts([object]$Existing = $null, [scriptblock]$Available = { param($Port) Test-DesktopPortAvailable $Port }) {
    if ($Existing) {
        $Saved = Get-DesktopPortSettings $Existing
        if ((& $Available $Saved.vncPort) -and (& $Available $Saved.viewerPort)) { return $Saved }
    }
    for ($Index = 0; $Index -lt 20; $Index++) {
        $Vnc = 5915 + $Index
        $Viewer = 6095 + $Index
        if ((& $Available $Vnc) -and (& $Available $Viewer)) { return @{ vncPort = $Vnc; viewerPort = $Viewer } }
    }
    throw 'No free Desktop viewer ports were found. Existing applications were left running.'
}
