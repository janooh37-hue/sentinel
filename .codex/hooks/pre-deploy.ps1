$ErrorActionPreference = 'Stop'

$raw = [Console]::In.ReadToEnd()
try { $payload = $raw | ConvertFrom-Json } catch { exit 0 }

$command = $payload.tool_input.command
if (-not $command -or $command -notmatch 'mng\.ps1["'']?\s+(deploy|update)\b') { exit 0 }

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $root
try {
    $problems = @()
    if ((git branch --show-current) -ne 'main') { $problems += 'the live checkout is not on main' }
    if (git status --porcelain) { $problems += 'the live checkout has uncommitted changes' }

    $head = git rev-parse HEAD 2>$null
    $originMain = git rev-parse origin/main 2>$null
    if (-not $head -or -not $originMain -or $head -ne $originMain) {
        $problems += 'HEAD is not equal to origin/main; commit and push first'
    }
} finally {
    Pop-Location
}

if ($problems.Count) {
    [Console]::Error.WriteLine("Blocked production deploy/update: " + ($problems -join '; ') + '.')
    exit 2
}
