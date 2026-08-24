# PostToolUse hook — auto-format + lint-fix the Python file that was just edited.
#
# Fires after Edit/Write/MultiEdit. Reads the tool-call payload (JSON) from
# stdin, and if the edited file is a .py file, runs `ruff format` then
# `ruff check --fix` on just that file using the project venv. Advisory only:
# it always exits 0 so it never blocks an edit or reports a "hook failure" —
# remaining unfixable lint is still caught by ruff/mypy at review/commit time.
$ErrorActionPreference = 'SilentlyContinue'

$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }
try { $payload = $raw | ConvertFrom-Json } catch { exit 0 }

$path = $payload.tool_input.file_path
if (-not $path) { exit 0 }
if ($path -notmatch '\.py$') { exit 0 }
if (-not (Test-Path -LiteralPath $path)) { exit 0 }

# Resolve ruff from the project venv (this script lives in .claude/hooks/).
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$ruff = Join-Path $repoRoot 'venv\Scripts\ruff.exe'
if (-not (Test-Path $ruff)) { $ruff = 'ruff' }  # fall back to PATH

& $ruff format "$path"       | Out-Null
& $ruff check --fix "$path"  | Out-Null
exit 0
