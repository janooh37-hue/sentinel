# PostToolUse hook — guard against a split Alembic history.
#
# Fires after Edit/Write/MultiEdit. If the edited file is an Alembic revision
# (backend/app/db/migrations/versions/*.py), it runs `alembic heads` and, when
# MORE THAN ONE head exists, emits a warning on stderr and exits 2 so the
# message is fed back to Claude. This catches the exact class of bug that once
# forced the emergency 0048 merge (two sibling 0047_* revisions).
#
# A single head -> exit 0 (silent). Any tooling failure -> exit 0 (advisory
# only; never block an edit on a broken alembic invocation).
$ErrorActionPreference = 'SilentlyContinue'

$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }
try { $payload = $raw | ConvertFrom-Json } catch { exit 0 }

$path = $payload.tool_input.file_path
if (-not $path) { exit 0 }
# Only care about Alembic revision files.
if ($path -notmatch 'migrations[\\/]versions[\\/].*\.py$') { exit 0 }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$alembic  = Join-Path $repoRoot 'venv\Scripts\alembic.exe'
if (-not (Test-Path $alembic)) { exit 0 }  # no venv alembic -> stay out of the way
$ini = Join-Path $repoRoot 'alembic.ini'

Push-Location $repoRoot
try {
    $out = & $alembic -c "$ini" heads 2>$null
} finally {
    Pop-Location
}
if (-not $out) { exit 0 }

# Each head prints on its own line ending in "(head)". Count them.
$heads = @($out | Where-Object { $_ -match '\(head\)' })
if ($heads.Count -le 1) { exit 0 }

$list = ($heads | ForEach-Object { "  - " + ($_ -replace '\s*\(head\)\s*$', '') }) -join "`n"
[Console]::Error.WriteLine(@"
Alembic history has $($heads.Count) heads -- the migration chain is split:
$list

A single linear head is required before deploy. Either point the new revision's
down_revision at the current tip, or add a merge revision:
  venv\Scripts\alembic.exe merge -m "merge heads" <rev_a> <rev_b>
See the /new-migration skill for the safe path.
"@)
exit 2
