# vibeediting installer for Windows (PowerShell).
#
#   irm https://vibeediting.app/install.ps1 | iex
#
# What it does (nothing needs admin rights):
#   1. Uses your Node.js if it is version 22.12 or newer. Otherwise downloads a private
#      copy of Node.js (official build from nodejs.org, checksum verified) into
#      %LOCALAPPDATA%\vibeediting\node. Your system is not changed.
#   2. Runs the vibeediting setup: asks for your license key, connects Claude Code,
#      Codex, Cursor and the Claude app, and downloads FFmpeg and the speech model.
#
# To give the key up front:  $env:VIBE_LICENSE_KEY = 'VIBE-XXXX-XXXX-XXXX-XXXX'; irm https://vibeediting.app/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$pkg = if ($env:VIBE_PACKAGE) { $env:VIBE_PACKAGE } else { '@vibeediting/mcp' }
$nodeDist = if ($env:VIBE_NODE_DIST) { $env:VIBE_NODE_DIST } else { 'https://nodejs.org/dist/latest-v24.x' }
$vibeDir = Join-Path $env:LOCALAPPDATA 'vibeediting'
$nodeDir = Join-Path $vibeDir 'node'

function Fail($msg) {
  Write-Host "vibeediting install failed: $msg" -ForegroundColor Red
  Write-Host 'Help: https://vibeediting.app/support'
  throw $msg
}

function Test-NodeOk($exe) {
  try {
    $v = (& $exe -p 'process.versions.node' 2>$null)
    if (-not $v) { return $false }
    $parts = $v.Trim().Split('.')
    $major = [int]$parts[0]; $minor = [int]$parts[1]
    return ($major -gt 22) -or ($major -eq 22 -and $minor -ge 12)
  } catch { return $false }
}

function Install-Node {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
  Write-Host 'Getting Node.js (one time, about 30 MB)...'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("vibeediting-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    try { $sums = (Invoke-WebRequest -UseBasicParsing "$nodeDist/SHASUMS256.txt").Content } catch { Fail 'could not reach nodejs.org (check your internet connection)' }
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $line = ($sums -split "`n") | Where-Object { $_ -match "\s(node-v[\d.]+-win-$arch\.zip)\s*$" } | Select-Object -First 1
    if (-not $line) { Fail "no Node.js build for win-$arch" }
    $sum = ($line.Trim() -split '\s+')[0]
    $file = ($line.Trim() -split '\s+')[1]
    $zip = Join-Path $tmp $file
    try { Invoke-WebRequest -UseBasicParsing "$nodeDist/$file" -OutFile $zip } catch { Fail 'Node.js download failed' }
    if ((Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower() -ne $sum.ToLower()) { Fail 'Node.js download did not match its checksum' }
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x') -Force
    New-Item -ItemType Directory -Path $vibeDir -Force | Out-Null
    if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
    Move-Item (Join-Path (Join-Path $tmp 'x') ($file -replace '\.zip$', '')) $nodeDir
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
  Write-Host "Node.js $(& (Join-Path $nodeDir 'node.exe') --version) is ready (private copy in $nodeDir)."
}

Write-Host ''
Write-Host 'Installing vibeediting...'

$node = $null
$systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $env:VIBE_FORCE_PORTABLE_NODE -and $systemNode -and (Test-NodeOk $systemNode.Source)) {
  $node = $systemNode.Source
} elseif ((Test-Path (Join-Path $nodeDir 'node.exe')) -and (Test-NodeOk (Join-Path $nodeDir 'node.exe'))) {
  $node = Join-Path $nodeDir 'node.exe'
} else {
  Install-Node
  $node = Join-Path $nodeDir 'node.exe'
}
$nodeBin = Split-Path -Parent $node
$env:Path = "$nodeBin;$env:Path"

# npx.cmd, not npx.ps1: works whatever the PowerShell script policy is.
$setupArgs = @('-y', $pkg, '--setup')
if ($env:VIBE_SETUP_ARGS) { $setupArgs += ($env:VIBE_SETUP_ARGS -split '\s+' | Where-Object { $_ }) }
$npx = Join-Path $nodeBin 'npx.cmd'
if (-not (Test-Path $npx)) { $npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source }
if (-not $npx) { Fail 'npx was not found next to Node.js' }
& $npx @setupArgs
if ($LASTEXITCODE -ne 0) { Write-Host "Setup ended with code $LASTEXITCODE." -ForegroundColor Yellow }
