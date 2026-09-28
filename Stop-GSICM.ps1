$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
  Invoke-RestMethod 'http://127.0.0.1:3210/api/shutdown' -Method Post -ContentType 'application/json' -Body '{}' | Out-Null
  Write-Host 'GSICM shutdown requested.'
} catch { Write-Host 'No running GSICM manager was found on port 3210.' }
