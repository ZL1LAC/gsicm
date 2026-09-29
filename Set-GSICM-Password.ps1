param([switch]$Clear)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$passwordFile = Join-Path $PSScriptRoot '.gsicm-password'
if ($Clear) {
  Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
  Write-Host 'GSICM password login disabled for launcher starts.'
  exit
}
$secure = Read-Host 'Enter a local GSICM login password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if (-not $password) { throw 'Password cannot be empty.' }
Set-Content -LiteralPath $passwordFile -Value $password -NoNewline
Write-Host 'GSICM password login enabled. Restart GSICM to use it.'
