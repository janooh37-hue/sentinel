<#
.SYNOPSIS
    GSSGLT dev channel: branch `dev` in this worktree is a rebuildable preview of
    origin/main plus the feature branches under test. Nothing is written here.
.DESCRIPTION
    dev-channel.ps1 [open] [-Agent omp]  sync if clean, ensure the server is up, start the agent here
    dev-channel.ps1 preview <branch>     put a feature branch on the dev URL (or refresh it), then publish
    dev-channel.ps1 drop <branch>        take a feature branch off the dev URL, then publish
    dev-channel.ps1 sync                 rebuild on latest origin/main + the latest of every previewed branch
    dev-channel.ps1 publish              build frontend, migrate, restart
    dev-channel.ps1 restart              restart the dev server on 127.0.0.1:8765
    dev-channel.ps1 status               main, previewed branches, stray work, server health

    preview/drop/sync take -NoPublish to rebuild the branch without building or restarting.
    What that leaves undone (or a failed build leaves undone) is remembered, and the
    next preview, drop, sync or publish finishes it.

    A feature branch is cut from origin/main and goes to main through its own PR.
    `dev` is never promoted, pushed, or committed to: every rebuild resets it to
    origin/main and re-merges the previewed branches, so work that exists only
    here would be lost. The script refuses to rebuild or publish over such work.
    See docs/dev-channel.md, ADR 0004 and .agents/skills/dev-cycle/SKILL.md.
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('open', 'preview', 'drop', 'sync', 'publish', 'restart', 'status')]
    [string] $Command = 'open',
    [Parameter(Position = 1)]
    [string] $Branch,
    [string] $Agent = 'omp',
    [switch] $NoPublish
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Py = Join-Path $Root 'venv\Scripts\python.exe'
$Port = 8765
$Log = Join-Path $Root '.tmp\dev-server.log'
# Branches live on dtop (remote `desk`) while they are written and on origin once pushed.
$Remotes = @('desk', 'origin')
Set-Location $Root

# Native commands do not throw on failure; check the exit code.
function Invoke-Native([scriptblock] $Block) {
    & $Block
    if ($LASTEXITCODE) { throw "Failed (exit $LASTEXITCODE): $Block" }
}

function Get-Dirty { @(git status --porcelain) }

function Get-Health {
    try { Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/system/health" -TimeoutSec 3 } catch { $null }
}

if ((git branch --show-current) -ne 'dev') { throw "$Root is not on branch dev; this script only drives the dev channel." }

# .githooks/pre-commit rejects commits made on dev. core.hooksPath is per clone, so set it here.
if ((Test-Path (Join-Path $Root '.githooks')) -and (git config --get core.hooksPath) -ne '.githooks') {
    Invoke-Native { git config core.hooksPath .githooks }
}

# -- Preview list (git config devchannel.preview, one value per branch) --------
function Get-Preview { @(git config --local --get-all devchannel.preview) | Where-Object { $_ } }

function Set-Preview([string[]] $Names) {
    git config --local --unset-all devchannel.preview   # exit 5 when the key is absent
    foreach ($n in $Names) { Invoke-Native { git config --local --add devchannel.preview $n } }
}

function Update-Remotes {
    Invoke-Native { git fetch -q --prune origin }
    if (@(git remote) -contains 'desk') {
        git fetch -q --prune desk
        if ($LASTEXITCODE) { Write-Warning 'Could not reach dtop (remote desk); using the branches fetched last time.' }
    }
}

# The newest tip of a branch across desk and origin, or $null when it exists on neither.
function Resolve-Tip([string] $Name) {
    $tips = @(foreach ($r in $Remotes) {
        $sha = git rev-parse -q --verify "refs/remotes/$r/$Name^{commit}"
        if (-not $LASTEXITCODE) { [pscustomobject]@{ Remote = $r; Sha = $sha } }
    })
    if (-not $tips) { return $null }
    if ($tips.Count -eq 1 -or $tips[0].Sha -eq $tips[1].Sha) { return $tips[0] }
    git merge-base --is-ancestor $tips[0].Sha $tips[1].Sha
    if (-not $LASTEXITCODE) { return $tips[1] }
    git merge-base --is-ancestor $tips[1].Sha $tips[0].Sha
    if (-not $LASTEXITCODE) { return $tips[0] }
    throw "$Name has different commits on desk and on origin, and neither contains the other. Make them agree on dtop (pull, then push), then retry."
}

# True when the branch is merged (by merge commit, squash or rebase) or has no
# work yet: at some commit main has reached since the branch forked, merging the
# branch in would have changed nothing. Looking only at main's tip is not enough:
# once main changes the same lines again after a squash merge, the old branch tip
# conflicts with today's main and would look like unmerged work forever.
function Test-AddsNothing([string] $Sha) {
    git merge-base --is-ancestor $Sha origin/main
    if (-not $LASTEXITCODE) { return $true }
    $base = git merge-base origin/main $Sha
    if ($LASTEXITCODE) { return $false }   # unrelated history
    # Newest first, so the usual case (main's tip) is answered by the first merge.
    foreach ($c in @(git rev-list --first-parent --max-count=300 "$base..origin/main")) {
        $tree = git merge-tree --write-tree $c $Sha
        if (-not $LASTEXITCODE -and $tree -eq (git rev-parse "$c^{tree}")) { return $true }
    }
    $false
}

# Commits made on dev itself, which a rebuild would discard: direct commits,
# cherry-picks, and merges that carry edits of their own. A merge is only safe to
# discard when its tree is exactly the automatic merge of its two parents; one
# committed with extra edits or a hand-resolved conflict holds work found nowhere else.
function Get-Stray {
    foreach ($line in @(git rev-list --first-parent --parents origin/main..HEAD)) {
        $sha, $parents = $line -split ' '
        if (@($parents).Count -eq 2) {
            $auto = git merge-tree --write-tree $parents[0] $parents[1]
            if (-not $LASTEXITCODE -and $auto -eq (git rev-parse "$sha^{tree}")) { continue }
        }
        git log -1 --format='%h %s' $sha
    }
}

function Assert-NoStray([string] $Consequence) {
    $stray = @(Get-Stray)
    if ($stray) {
        throw ("dev holds $($stray.Count) commit(s) that are on no feature branch; $Consequence`n  " +
            ($stray -join "`n  ") +
            "`nMove each one to the branch it belongs to (cherry-pick it in that branch's worktree and push; for a merge listed here, recreate the edits it added there), then run: git reset --hard origin/main; dev-channel.ps1 sync")
    }
}

# -- Unfinished steps (git config devchannel.pending, one value per step) ------
# A rebuild records what the new tree still needs: pip, pnpm, frontend (a build),
# publish (migrate + restart). Each is cleared only when it succeeds, so a later
# run finishes what -NoPublish deferred or a failure cut short, even though the
# tree no longer differs from the one before.
function Get-Pending { @(git config --local --get-all devchannel.pending) | Where-Object { $_ } }

function Add-Pending([string] $Step) {
    if ((Get-Pending) -notcontains $Step) { Invoke-Native { git config --local --add devchannel.pending $Step } }
}

function Clear-Pending([string] $Step) {
    if ((Get-Pending) -contains $Step) { Invoke-Native { git config --local --unset-all devchannel.pending "^$Step`$" } }
}

function Install-Pending {
    if ((Get-Pending) -contains 'pip') {
        Invoke-Native { & $Py -m pip install -q --disable-pip-version-check -r requirements.txt }
        Clear-Pending 'pip'
    }
    if ((Get-Pending) -contains 'pnpm') {
        Invoke-Native { pnpm -C frontend install --frozen-lockfile }
        Clear-Pending 'pnpm'
    }
}

function Assert-NothingToLose([string] $Action) {
    Assert-NoStray "$Action would discard them:"
    $dirty = Get-Dirty
    if ($dirty) {
        throw ("The dev worktree has uncommitted changes; $Action needs a clean tree:`n  " + ($dirty -join "`n  ") +
            "`nEdits belong in the feature branch's worktree, not here. Word re-saves of templates: git checkout -- backend/templates")
    }
}

# -- Server --------------------------------------------------------------------
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
    Install-Pending
    if ($Frontend -or (Get-Pending) -contains 'frontend') {
        Invoke-Native { pnpm -C frontend run build --logLevel warn }
        Remove-Item (Join-Path $Root 'backend\app\static\assets') -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item (Join-Path $Root 'frontend\dist\*') (Join-Path $Root 'backend\app\static') -Recurse -Force
        Clear-Pending 'frontend'
    }
    # Dev data is a throwaway snapshot; restore a fresh one if this ever goes wrong.
    Invoke-Native { & $Py -m alembic upgrade head }
    Restart-Server
    Clear-Pending 'publish'
}

# -- Rebuild -------------------------------------------------------------------
# Reset dev to origin/main and merge the newest tip of each named branch. Branches
# that are gone or already in main leave the preview list. A branch that does not
# merge cleanly aborts the whole rebuild and puts dev back as it was.
function Rebuild([string[]] $Names) {
    Assert-NothingToLose 'a rebuild'
    # Resolve every tip before touching dev: Resolve-Tip throws on a branch whose
    # desk and origin copies have diverged, and that refusal must leave dev as it was.
    $plan = @(foreach ($n in $Names) {
        $tip = Resolve-Tip $n
        if (-not $tip) { Write-Warning "$n is gone from desk and origin; taken off the preview."; continue }
        if (Test-AddsNothing $tip.Sha) { Write-Host "$n adds nothing to main (merged, or no commits yet); taken off the preview." -ForegroundColor DarkGray; continue }
        [pscustomobject]@{ Name = $n; Tip = $tip }
    })
    $before = git rev-parse HEAD
    Invoke-Native { git reset -q --hard origin/main }
    $kept = @()
    foreach ($p in $plan) {
        $n = $p.Name
        $tip = $p.Tip
        git merge -q --no-ff -m "preview: $n" $tip.Sha
        if ($LASTEXITCODE) {
            $files = @(git diff --name-only --diff-filter=U)
            git merge --abort
            Invoke-Native { git reset -q --hard $before }
            $others = if ($kept) { 'main plus ' + ($kept -join ', ') } else { 'main' }
            throw ("$n does not merge cleanly onto $others; dev is unchanged. Conflicts:`n  " + ($files -join "`n  ") +
                "`nFix it on the branch (in its worktree: git fetch origin; git merge origin/main), or preview the conflicting branches one at a time (dev-channel.ps1 drop <branch>).")
        }
        Write-Host ("preview: {0} @ {1} ({2})" -f $n, $tip.Sha.Substring(0, 8), $tip.Remote) -ForegroundColor Cyan
        $kept += $n
    }
    Set-Preview $kept
    # Record what this tree still needs before doing any of it. The diff below is
    # empty on the next run, so the record is what lets that run finish the job.
    $changed = @(git diff --name-only $before HEAD)
    if ($changed) { Add-Pending 'publish' }
    if ($changed -contains 'requirements.txt') { Add-Pending 'pip' }
    if ($changed -match '^frontend/(package\.json|pnpm-lock\.yaml)$') { Add-Pending 'pnpm' }
    if ($changed -like 'frontend/*') { Add-Pending 'frontend' }
    if (-not (Get-Pending)) { Write-Host 'dev already matches main + the previewed branches, and it is published.' -ForegroundColor Green; return }
    # Dependencies are synced even with -NoPublish, so the tree is runnable as it stands.
    Install-Pending
    if ($NoPublish) { Write-Host 'Not published (-NoPublish): run dev-channel.ps1 publish to see it on the dev URL.' -ForegroundColor Yellow; return }
    # Builds the frontend only if a rebuild since the last successful build changed it.
    Publish $false
}

function Get-BranchArg {
    if (-not $Branch) { throw "Name the branch: dev-channel.ps1 $Command <branch>" }
    $Branch -replace '^(refs/remotes/|refs/heads/)?((desk|origin)/)?', ''
}

function Show-Status {
    Update-Remotes
    git status -sb | Select-Object -First 1
    $names = Get-Preview
    if (-not $names) { Write-Host 'Previewing: nothing (dev is plain main)' }
    foreach ($n in $names) {
        $tip = Resolve-Tip $n
        $state = if (-not $tip) { 'gone from desk and origin; sync will take it off' }
        elseif (Test-AddsNothing $tip.Sha) { 'merged into main; sync will take it off' }
        else {
            git merge-base --is-ancestor $tip.Sha HEAD
            if ($LASTEXITCODE) { "has newer commits ($($tip.Sha.Substring(0, 8)) on $($tip.Remote)); run preview $n" } else { 'up to date' }
        }
        Write-Host "Previewing: $n - $state"
    }
    $stray = Get-Stray
    if ($stray) { Write-Warning ("Commits made on dev itself, on no feature branch:`n  " + ($stray -join "`n  ")) }
    $dirty = Get-Dirty
    if ($dirty) { Write-Warning ("Uncommitted changes in the dev worktree:`n  " + ($dirty -join "`n  ")) }
    if (Get-Health) { Write-Host 'Server: up' -ForegroundColor Green } else { Write-Host 'Server: down' -ForegroundColor Yellow }
}

switch ($Command) {
    'status'  { Show-Status }
    'sync'    { Update-Remotes; Rebuild (Get-Preview) }
    'preview' {
        $name = Get-BranchArg
        Update-Remotes
        if (-not (Resolve-Tip $name)) {
            throw "No branch '$name' on desk or origin. Commit it in its worktree on dtop, or push it to origin, then retry."
        }
        Rebuild (@(Get-Preview) + $name | Select-Object -Unique)
    }
    'drop' {
        $name = Get-BranchArg
        Update-Remotes
        Rebuild (@(Get-Preview) | Where-Object { $_ -ne $name })
    }
    'publish' {
        # Publishing shows the user this tree. If it holds work that is on no
        # branch, the PR will not match what they tested.
        Assert-NoStray 'the PR would not match what gets tested:'
        $edits = @(Get-Dirty | Where-Object { $_ -notmatch 'backend/templates/.*\.docx' })
        if ($edits) {
            throw ("The dev worktree has edits that are on no branch, so the PR would not match what gets tested:`n  " + ($edits -join "`n  ") +
                "`nMake them in the feature branch's worktree, commit there, then run: dev-channel.ps1 preview <branch>")
        }
        Publish
    }
    'restart' { Restart-Server }
    'open' {
        Show-Status
        $behind = [int](git rev-list --count HEAD..origin/main)
        if ($behind -and -not (Get-Dirty) -and -not (Get-Stray)) { Rebuild (Get-Preview) }
        elseif ($behind) { Write-Warning "$behind commit(s) behind main, but the dev worktree holds work of its own (see above); sort that out, then run sync." }
        if (-not (Get-Health)) { Start-Server }
        & $Agent
    }
}
