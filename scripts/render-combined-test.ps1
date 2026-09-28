$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$test = Join-Path $project 'data/combined-test'
$inputs = Join-Path $test 'inputs'
New-Item -ItemType Directory -Force $inputs | Out-Null
$definitions = @()
$observations = @()
foreach ($name in @('gk2a', 'goes18', 'goes19', 'himawari9')) {
    $decoded = Join-Path $project "data/$name-test/decoded"
    $images = @(Get-ChildItem -LiteralPath (Join-Path $decoded 'sanchez-input') -Filter '*.png')
    if ($images.Count -ne 1) { throw "Expected exactly one decoded observation for $name" }
    Copy-Item -LiteralPath $images[0].FullName -Destination $inputs
    $parsedDefinitions = Get-Content -LiteralPath (Join-Path $decoded 'satellites.json') -Raw | ConvertFrom-Json
    foreach ($definition in $parsedDefinitions) { $definitions += $definition }
    $metadata = Get-Content -LiteralPath (Join-Path $decoded 'decoded-metadata.json') -Raw | ConvertFrom-Json
    $observations += [PSCustomObject]@{ satellite = $name; start = $metadata.observation_start_utc; end = $metadata.observation_end_utc; input = $images[0].Name }
}
[System.IO.File]::WriteAllText((Join-Path $test 'satellites.json'), (ConvertTo-Json -InputObject $definitions -Depth 8))
ConvertTo-Json -InputObject $observations -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $test 'observations.json')
$common = @('-s', $inputs, '-D', (Join-Path $test 'satellites.json'), '-u', (Join-Path $project 'bin/Resources/world.200412.3x21600x10800.jpg'), '-r', '4', '-T', '2026-09-28T03:00:30', '-d', '2', '-m', '4', '-n', '-f')
Push-Location $test
try {
    $started = [DateTime]::UtcNow
    & (Join-Path $project 'bin/Sanchez.exe') reproject @common --nocrop -o (Join-Path $test 'four-satellite-map.jpg')
    $result = Get-Item -LiteralPath (Join-Path $test 'four-satellite-map.jpg')
    if ($LASTEXITCODE -ne 0 -or $result.Length -eq 0 -or $result.LastWriteTimeUtc -lt $started) { throw 'Combined map failed' }
    $started = [DateTime]::UtcNow
    & (Join-Path $project 'bin/Sanchez.exe') geostationary @common -l 180 -o (Join-Path $test 'four-satellite-pacific.jpg')
    $result = Get-Item -LiteralPath (Join-Path $test 'four-satellite-pacific.jpg')
    if ($LASTEXITCODE -ne 0 -or $result.Length -eq 0 -or $result.LastWriteTimeUtc -lt $started) { throw 'Combined globe failed' }
} finally { Pop-Location }
