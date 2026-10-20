<#
.SYNOPSIS
    GSSGLT dev channel: branch `dev` in this worktree = origin/main + work branches under test.
.DESCRIPTION
    dev-channel.ps1 [open] [-Agent omp]  ensure the server is up, start the agent here
    dev-channel.ps1 rebuild [work/x ...] reset dev to origin/main, merge the listed work branches, sync deps, rebuild, migrate, restart
    dev-channel.ps1 publish              build frontend, migrate, restart (after merging a work branch)
    dev-channel.ps1 restart              restart the dev server on 127.0.0.1:8765
    dev-channel.ps1 status               branch vs origin/main + server health

    dev is disposable: never commit on it or PR from it. Each work branch has its own draft PR, marked ready when the user says so.
    See docs/dev-channel.md and ADR 0004.
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Position = 0)] [ValidateSet('open', 'rebuild', 'publish', 'restart', 'status')]
    [string] $Command = 'open',
    [string] $Agent = 'omp',
    [Parameter(ValueFromRemainingArguments)] [string[]] $Branches = @()
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Py = Join-Path $Root 'venv\Scripts\python.exe'
$Port = 8765
$Log = Join-Path $Root '.tmp\dev-server.log'
Set-Location $Root

# Native commands do not throw on failure; check the exit code.
function Invoke-Native([scriptblock] $Block) {
    & $Block
    if ($LASTEXITCODE) { throw "Failed (exit $LASTEXITCODE): $Block" }
}

function Test-Clean { -not (git status --porcelain) }

function Get-Health {
    try { Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/system/health" -TimeoutSec 3 } catch { $null }
}

if ((git branch --show-current) -ne 'dev') { throw "$Root is not on branch dev; this script only drives the dev channel." }

function Show-Status {
    Invoke-Native { git fetch -q origin }
    git status -sb | Select-Object -First 1
    if (Get-Health) { Write-Host 'Server: up' -ForegroundColor Green } else { Write-Host 'Server: down' -ForegroundColor Yellow }
}

function Stop-Server {
    for ($i = 0; $i -lt 10; $i++) {
        $listen = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $listen) { return }
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listen.OwningProcess)"
        if ($proc.CommandLine -notmatch 'serve\.py|uvicorn') {
            throw "Port $Port is held by PID $($proc.ProcessId) ($($proc.Name)), not a GSSG server; stop it yourself."
        }
        # The venv python.exe is a launcher; the listener is its child. Stop both.
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        if ($parent -and $parent.CommandLine -match 'serve\.py|uvicorn') { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 1
    }
    throw "Port $Port is still in use after stopping the old server."
}

function Start-Server {
    New-Item -ItemType Directory -Force (Split-Path $Log) | Out-Null
    # Hidden window of its own: survives closing this terminal or the agent session.
    Start-Process -FilePath $Py -ArgumentList 'backend\serve.py' -WorkingDirectory $Root -WindowStyle Hidden `
        -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"
    for ($i = 0; $i -lt 40; $i++) {
        if (Get-Health) { Write-Host 'Server: up' -ForegroundColor Green; return }
        Start-Sleep -Seconds 1
    }
    Get-Content "$Log.err" -Tail 30 -ErrorAction SilentlyContinue
    throw "Dev server did not become healthy; full log: $Log.err"
}

function Restart-Server { Stop-Server; Start-Server }

function Publish([bool] $Frontend = $true) {
    if ($Frontend) {
        Invoke-Native { pnpm -C frontend run build --logLevel warn }
        Remove-Item (Join-Path $Root 'backend\app\static\assets') -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item (Join-Path $Root 'frontend\dist\*') (Join-Path $Root 'backend\app\static') -Recurse -Force
    }
    # Dev data is a throwaway snapshot; restore a fresh one if this ever goes wrong.
    Invoke-Native { & $Py -m alembic upgrade head }
    Restart-Server
}

function Rebuild {
    if (-not (Test-Clean)) { throw 'Uncommitted changes in the dev worktree; move them to their work branch, then rebuild.' }
    Invoke-Native { git fetch -q origin }
    $before = git rev-parse HEAD
    Invoke-Native { git reset -q --hard origin/main }
    foreach ($branch in $Branches) {
        git merge -q --no-edit $branch
        if ($LASTEXITCODE) {
            git merge --abort
            throw "Merging $branch conflicted and was aborted; dev is origin/main plus the branches before it. Rebase $branch on origin/main, then rebuild."
        }
    }
    $changed = @(git diff --name-only $before HEAD)
    if (-not $changed) { Write-Host 'dev unchanged.' -ForegroundColor Green; return }
    if ($changed -contains 'requirements.txt') {
        Invoke-Native { & $Py -m pip install -q --disable-pip-version-check -r requirements.txt }
    }
    if ($changed -match '^frontend/(package\.json|pnpm-lock\.yaml)$') {
        Invoke-Native { pnpm -C frontend install --frozen-lockfile }
    }
    Publish ([bool]($changed -like 'frontend/*'))
}

switch ($Command) {
    'status'  { Show-Status }
    'rebuild' { Rebuild }
    'publish' { Publish }
    'restart' { Restart-Server }
    'open' {
        Show-Status
        if (-not (Get-Health)) { Start-Server }
        & $Agent
    }
}
