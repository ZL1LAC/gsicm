param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or newer, then run this launcher again.' }
if ([int]((& node --version).TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24 or newer is required.' }
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
try { $existing = Invoke-RestMethod 'http://127.0.0.1:3210/api/state' -TimeoutSec 2 } catch { $existing = $null }
if (-not $existing) {
  $nodeExe = (Get-Command node).Source
  $entry = Join-Path $PSScriptRoot 'node_modules/tsx/dist/cli.mjs'
  $server = Join-Path $PSScriptRoot 'server/index.ts'
  $process = Start-Process -FilePath $nodeExe -ArgumentList @(('"' + $entry + '"'), ('"' + $server + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 60; $i++) { try { $state = Invoke-RestMethod 'http://127.0.0.1:3210/api/state' -TimeoutSec 1; break } catch { Start-Sleep -Milliseconds 500 } }
  if (-not $state) { throw 'Manager did not start. Run npm start in this folder for diagnostics.' }
  Write-Host "GSICM background process: $($process.Id). Closing the browser will not stop processing."
}
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:3210' }
