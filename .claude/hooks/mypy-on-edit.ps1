# PostToolUse hook — type-check the backend file that was just edited.
#
# Fires after Edit/Write/MultiEdit. Complements ruff-on-edit: ruff auto-fixes
# style/lint, this surfaces the strict-typing errors that ruff can't see. Runs
# `mypy` (project venv, pyproject strict config) on just the edited file with
# --follow-imports=silent so only errors IN that file are reported. If mypy
# finds errors it prints them on stderr and exits 2, feeding them back to Claude
# to fix. Clean file -> exit 0.
#
# Scope mirrors the mypy config (`files = backend/app, backend/main.py`; tests
# excluded). Anything outside that scope, or any tooling failure, exits 0.
$ErrorActionPreference = 'SilentlyContinue'

$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }
try { $payload = $raw | ConvertFrom-Json } catch { exit 0 }

$path = $payload.tool_input.file_path
if (-not $path) { exit 0 }
if ($path -notmatch '\.py$') { exit 0 }
# Only files mypy actually checks: backend/app/** or backend/main.py; skip tests.
$inScope = ($path -match 'backend[\\/]app[\\/]') -or ($path -match 'backend[\\/]main\.py$')
if (-not $inScope) { exit 0 }
if ($path -match 'backend[\\/]tests[\\/]') { exit 0 }
if (-not (Test-Path -LiteralPath $path)) { exit 0 }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$mypy = Join-Path $repoRoot 'venv\Scripts\mypy.exe'
if (-not (Test-Path $mypy)) { exit 0 }  # no venv mypy -> stay out of the way

Push-Location $repoRoot
try {
    $out = & $mypy --follow-imports=silent --no-error-summary --no-color-output "$path" 2>&1
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($code -eq 0) { exit 0 }
if (-not $out) { exit 0 }

[Console]::Error.WriteLine("mypy (strict) errors in the file you just edited:")
[Console]::Error.WriteLine(($out -join "`n"))
exit 2
