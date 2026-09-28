param([switch]$Force)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$uv = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
if (-not (Test-Path $uv)) { throw "uv is required. Install it from https://docs.astral.sh/uv/" }
$venv = Join-Path $root ".venv-gk2a"
if ($Force -and (Test-Path $venv)) { Remove-Item -LiteralPath $venv -Recurse -Force }
if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) { & $uv venv $venv --python 3.12 }
& $uv pip install --python (Join-Path $venv "Scripts\python.exe") -r (Join-Path $root "scripts\requirements-gk2a.txt")
Write-Host "Satellite decoders are ready. The manager will use $venv\Scripts\python.exe"
