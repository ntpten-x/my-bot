$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $Repo

function Have-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WithWinget([string]$Id, [string]$Label) {
  if (-not (Have-Command "winget")) {
    Write-Host ("winget is missing. Install " + $Label + " by hand, then rerun this script.")
    return $false
  }
  Write-Host ("Installing " + $Label + " via winget...")
  & winget install --id $Id -e --accept-package-agreements --accept-source-agreements
  return ($LASTEXITCODE -eq 0)
}

function Read-OptionalSecret([string]$Name) {
  Write-Host ("Optional " + $Name + " (press Enter to skip):")
  $secure = Read-Host -AsSecureString
  if ($null -eq $secure -or $secure.Length -eq 0) { return "" }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Set-EnvKey([string]$Path, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path -LiteralPath $Path) { $lines = @(Get-Content -LiteralPath $Path) }
  $pattern = "^" + [regex]::Escape($Key) + "="
  $found = $false
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    if ($line -match $pattern) {
      $out.Add($Key + '="' + $Value + '"')
      $found = $true
    } else {
      $out.Add($line)
    }
  }
  if (-not $found) { $out.Add($Key + '="' + $Value + '"') }
  Set-Content -LiteralPath $Path -Value $out -Encoding ASCII
}

function Test-PortExcluded([int]$Port) {
  $raw = & netsh int ipv4 show excludedportrange protocol=tcp 2>$null
  if (-not $raw) { return $false }
  foreach ($line in $raw) {
    if ($line -match '^\s*(\d+)\s+(\d+)\s*$') {
      $start = [int]$Matches[1]
      $end = [int]$Matches[2]
      if ($Port -ge $start -and $Port -le $end) { return $true }
    }
  }
  return $false
}

function Test-PortBusy([int]$Port) {
  $pattern = ":" + $Port + "\s"
  $hit = netstat -ano -p tcp | Select-String -Pattern $pattern
  return [bool]$hit
}

Write-Host "MY-BOT setup"
Write-Host ("Folder: " + $Repo)

if (-not (Have-Command "node")) {
  Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS" | Out-Null
  if (-not (Have-Command "node")) {
    throw "Node.js is still missing. Install the LTS from https://nodejs.org and open a new PowerShell."
  }
}
$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) { throw "Node 20 or newer is required." }
Write-Host ("Node " + (node -v))

if (-not (Have-Command "git")) {
  Install-WithWinget "Git.Git" "Git" | Out-Null
  if (-not (Have-Command "git")) {
    Write-Host "Git is still missing. Install it from https://git-scm.com if you need to pull updates."
  }
}

Write-Host "npm install"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

if (-not (Test-Path -LiteralPath ".env")) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Host "Created .env from .env.example"
}

$discord = Read-OptionalSecret "DISCORD_WEBHOOK_URL"
if ($discord) { Set-EnvKey ".env" "DISCORD_WEBHOOK_URL" $discord }

$dbLine = (Get-Content -LiteralPath ".env" | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1)
if (-not $dbLine -or $dbLine -notmatch 'postgres(ql)?://' -or $dbLine -match 'YOUR-PASSWORD') {
  Write-Host "Supabase: Project > Connect > Connection string > Transaction pooler (port 6543)."
  Write-Host "Paste it (it may still contain [YOUR-PASSWORD]):"
  $pooler = (Read-Host).Trim().Trim('"')
  if ($pooler -notmatch '^postgres(ql)?://') { throw "That is not a postgresql:// connection string." }
  if ($pooler -match '\[YOUR-PASSWORD\]') {
    Write-Host "Supabase database password (hidden):"
    $pw = Read-OptionalSecret "database password"
    if (-not $pw) { throw "The database password is required." }
    $pooler = $pooler.Replace('[YOUR-PASSWORD]', [Uri]::EscapeDataString($pw))
  }
  $base = ($pooler -split '\?')[0]
  Set-EnvKey ".env" "DATABASE_URL" ($base + "?pgbouncer=true&connection_limit=5")
  Set-EnvKey ".env" "DIRECT_URL" ($base -replace ':6543/', ':5432/')
  Write-Host "Saved DATABASE_URL and DIRECT_URL to .env (not shown)."
}

Write-Host "Database migrate and seed"
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed. Check internet access and the Supabase password in .env." }
npx tsx prisma/seed.ts
if ($LASTEXITCODE -ne 0) { throw "database seed failed" }

Write-Host "npm run build"
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

$auto = Read-Host "Enable hidden autostart at logon? [y/N]"
if ($auto -eq "y" -or $auto -eq "Y") {
  $startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
  New-Item -ItemType Directory -Force -Path $startup | Out-Null
  $node = (Get-Command node).Source.Replace("\", "\\")
  $repoVbs = $Repo.Replace("\", "\\")
  $vbs = @"
Set shell = CreateObject("Wscript.Shell")
shell.CurrentDirectory = "$repoVbs"
shell.Run "cmd /c mkdir data 2>nul & ""$node"" scripts\start-all.mjs --prod >> data\mybot-console.log 2>&1", 0, False
"@
  Set-Content -LiteralPath (Join-Path $startup "MY-BOT.vbs") -Value $vbs -Encoding ASCII
  Write-Host "Wrote Startup\MY-BOT.vbs"
}

Write-Host ""
Write-Host "Extension token: open http://localhost:8001/settings after you set the owner password."
Write-Host "Open Chrome -> chrome://extensions -> Developer mode -> Load unpacked"
Write-Host ("Select folder: " + (Join-Path $Repo "extension"))
Write-Host "Paste the token into the MY-BOT popup. API base: http://localhost:8001"
Write-Host "Start the app with: npm run dev    or    npm run start:prod"
Write-Host "First visit http://localhost:8001 and set the owner password."
Write-Host "Thai guide: docs\SETUP.th.md and http://localhost:8001/guide"
