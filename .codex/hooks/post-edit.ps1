$ErrorActionPreference = 'Continue'

$raw = [Console]::In.ReadToEnd()
try { $payload = $raw | ConvertFrom-Json } catch { exit 0 }

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$inputJson = $payload.tool_input | ConvertTo-Json -Depth 20 -Compress
$paths = @()

if ($payload.tool_input.file_path) { $paths += [string]$payload.tool_input.file_path }
foreach ($match in [regex]::Matches($inputJson, '\*\*\* (?:Add|Update|Delete) File: ([^\\r\\n"]+)')) {
    $paths += $match.Groups[1].Value.Replace('\\n', '').Replace('\\r', '')
}

$failures = @()
$migrationTouched = $false
$localeTouched = $false

Push-Location $root
try {
    foreach ($path in $paths | Select-Object -Unique) {
        $candidate = if ([IO.Path]::IsPathRooted($path)) { $path } else { Join-Path $root $path }
        try { $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path } catch { continue }
        if (-not $resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { continue }

        if ($resolved -match '\.py$') {
            & "$root\venv\Scripts\ruff.exe" format $resolved | Out-Null
            & "$root\venv\Scripts\ruff.exe" check --fix $resolved | Out-Null
            if ($LASTEXITCODE) { $failures += "ruff failed: $path" }

            if ($resolved -match 'backend[\\/]app[\\/]' -and $resolved -notmatch 'backend[\\/]tests[\\/]') {
                & "$root\venv\Scripts\mypy.exe" --follow-imports=silent --no-error-summary --no-color-output $resolved 2>&1 |
                    ForEach-Object { [Console]::Error.WriteLine($_) }
                if ($LASTEXITCODE) { $failures += "mypy failed: $path" }
            }
        }

        if ($resolved -match 'backend[\\/]app[\\/]db[\\/]migrations[\\/]versions[\\/].*\.py$') {
            $migrationTouched = $true
        }
        if ($resolved -match 'frontend[\\/]src[\\/]locales[\\/](?:ar|en)\.json$') {
            $localeTouched = $true
        }
    }

    if ($migrationTouched) {
        $heads = @(& "$root\venv\Scripts\alembic.exe" heads 2>$null | Where-Object { $_ -match '\(head\)' })
        if ($heads.Count -ne 1) { $failures += "Alembic has $($heads.Count) heads; exactly one is required" }
    }

    if ($localeTouched) {
        & "$root\venv\Scripts\python.exe" "$PSScriptRoot\check-locale-parity.py"
        if ($LASTEXITCODE) { $failures += 'English/Arabic locale key parity failed' }
    }
} finally {
    Pop-Location
}

if ($failures.Count) {
    [Console]::Error.WriteLine(($failures -join "`n"))
    exit 2
}
