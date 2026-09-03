<#
.SYNOPSIS
    mng - GSSG Manager service control + health CLI.

.DESCRIPTION
    One friendly command to run, inspect, and update the GSSG Manager backend
    (the "GSSGManager" Windows service running backend\serve.py).

    Usage:
        mng                 # status (default)
        mng status          # service state, health, uptime, version, RAM, URL
        mng health          # quick up/down + version + uptime
        mng start           # start the service          (elevates if needed)
        mng stop            # stop the service            (elevates if needed)
        mng restart         # restart the service         (elevates if needed)
        mng build           # rebuild the frontend bundle into backend\app\static
        mng deploy          # sync deps + backup DB (if due) + build + migrate + smoke check + restart
        mng update          # git pull; if changed -> sync deps + deploy (skips untouched frontend)
        mng logs            # tail the service log   (-Tail N, -Stderr)
        mng open            # open the app in the default browser
        mng help            # this help

.NOTES
    Service : GSSGManager  (NSSM)  ->  venv\Scripts\python.exe backend\serve.py
    Health  : GET /api/v1/system/health
    Build   : uses `pnpm run build` with the committed api.types.ts (no schema
              regeneration) - see the note in `mng help`.
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('status', 'health', 'start', 'stop', 'restart', 'build',
        'deploy', 'update', 'logs', 'open', 'help')]
    [string] $Command = 'status',

    [int]    $Tail = 40,        # for `mng logs`
    [switch] $Stderr,           # `mng logs -Stderr` -> the error log
    [switch] $FromElevation     # internal: set when relaunched elevated
)

$ErrorActionPreference = 'Stop'

# -- Paths / constants --------------------------------------------------------
$Service     = 'GSSGManager'
$Root        = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path $Root 'frontend'
$StaticDir   = Join-Path $Root 'backend\app\static'
$DistDir     = Join-Path $FrontendDir 'dist'
$LogDir      = Join-Path $Root 'data\logs'
$StdoutLog   = Join-Path $LogDir 'service-stdout.log'
$StderrLog   = Join-Path $LogDir 'service-stderr.log'

# Free commit (MB) the frontend build needs. `tsc -b` peaks a few hundred MB and
# `vite build` ~1 GB on this project; 1800 leaves margin for the service and OS.
$MinBuildMB  = 1800

# Pre-migration DB backups copy the whole data dir (can be multi-GB) and are
# only needed often enough to bound data loss on a failed migration - reuse a
# recent one instead of burning disk on every update/deploy.
$BackupDir        = Join-Path $Root 'data\backups\auto'
$BackupMaxAgeDays = 7

# -- Small helpers ------------------------------------------------------------
function Write-Row($label, $value, $color = 'White') {
    Write-Host ("  {0,-11}: " -f $label) -NoNewline -ForegroundColor Gray
    Write-Host $value -ForegroundColor $color
}

function Get-Port {
    $envFile = Join-Path $Root '.env'
    if (Test-Path $envFile) {
        $m = Select-String -Path $envFile -Pattern '^\s*GSSG_PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { return [int] $m.Matches[0].Groups[1].Value }
    }
    if ($env:GSSG_PORT -match '^\d+$') { return [int] $env:GSSG_PORT }
    return 8765
}

function Format-Uptime([double] $seconds) {
    if ($seconds -lt 0) { return 'n/a' }
    $ts = [TimeSpan]::FromSeconds($seconds)
    if ($ts.TotalDays -ge 1) { return ('{0}d {1}h {2}m' -f [int]$ts.TotalDays, $ts.Hours, $ts.Minutes) }
    if ($ts.TotalHours -ge 1) { return ('{0}h {1}m' -f $ts.Hours, $ts.Minutes) }
    if ($ts.TotalMinutes -ge 1) { return ('{0}m {1}s' -f $ts.Minutes, $ts.Seconds) }
    return ('{0}s' -f [int]$ts.TotalSeconds)
}

function Format-MB([double] $bytes) { return ('{0:N1} MB' -f ($bytes / 1MB)) }

function Get-Commit {
    # Windows refuses new page commits once the system-wide commit charge reaches
    # the commit limit (physical RAM + pagefile). On this 8 GB host that ceiling -
    # not node's own 2 GB heap cap - is what kills the frontend build: V8 aborts
    # inside its allocator and dumps a raw native stack trace with exit 134.
    # Win32_OperatingSystem is used instead of Get-Counter because performance
    # counter names are localized and would break on a non-English Windows.
    $os      = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $limitMB = [int] ($os.TotalVirtualMemorySize / 1KB)   # commit limit
    $availMB = [int] ($os.FreeVirtualMemory      / 1KB)   # commit available
    $usedPct = if ($limitMB -gt 0) { [math]::Round(100 * ($limitMB - $availMB) / $limitMB, 1) } else { 0 }
    return [pscustomobject]@{ AvailableMB = $availMB; LimitMB = $limitMB; UsedPct = $usedPct }
}

function Get-TopCommitters([int] $count = 4) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Sort-Object PrivatePageCount -Descending | Select-Object -First $count |
        ForEach-Object { '{0} (pid {1}) {2:N0} MB' -f $_.Name, $_.ProcessId, ($_.PrivatePageCount / 1MB) }
}

function Assert-BuildMemory {
    $m = Get-Commit
    if ($m.AvailableMB -ge $MinBuildMB) {
        Write-Host ('  Memory OK - {0:N0} MB commit available.' -f $m.AvailableMB) -ForegroundColor DarkGray
        return
    }
    Write-Host ('  Only {0:N0} MB commit available ({1}% of {2:N0} MB used); build needs ~{3:N0} MB.' -f
        $m.AvailableMB, $m.UsedPct, $m.LimitMB, $MinBuildMB) -ForegroundColor Yellow

    # An idle WSL VM is the largest reclaimable block on this host and is not part
    # of the product (the app is Windows Python + Word COM). It restarts on next
    # use, so releasing it costs nothing beyond an idle VM's in-memory state.
    if (Get-Process -Name 'vmmemWSL', 'vmmem' -ErrorAction SilentlyContinue) {
        Write-Host '  Releasing the idle WSL VM (wsl --shutdown) ...' -ForegroundColor Yellow
        try { & wsl.exe --shutdown 2>&1 | Out-Null } catch { }
        Start-Sleep -Seconds 3
        $m = Get-Commit
        Write-Host ('  Reclaimed - {0:N0} MB commit now available.' -f $m.AvailableMB) -ForegroundColor Yellow
    }
    if ($m.AvailableMB -ge $MinBuildMB) { return }

    $msg = 'not enough memory to build: {0:N0} MB commit available, need ~{1:N0} MB. ' -f $m.AvailableMB, $MinBuildMB
    $msg += 'Close what you can, then rerun: mng deploy. Largest consumers: '
    $msg += (Get-TopCommitters) -join '; '
    throw $msg
}

function Get-LatestBackup([string] $destDir) {
    # Newest gssg-backup-<timestamp> dir under $destDir, or $null if none exist
    # yet (fresh install) or a custom backup -Dest bypasses this default path.
    if (-not (Test-Path $destDir)) { return $null }
    $latest = Get-ChildItem -Path $destDir -Directory -Filter 'gssg-backup-*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if (-not $latest -or $latest.Name -notmatch 'gssg-backup-(\d{8}-\d{6})') { return $null }
    $stamp = [datetime]::ParseExact($Matches[1], 'yyyyMMdd-HHmmss', $null)
    return [pscustomobject]@{ Name = $latest.Name; Age = (Get-Date) - $stamp }
}

function Get-AppProcesses {
    # Every python process whose command line runs serve.py (the service's
    # process + any child worker it spawned).
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'serve\.py' }
}

function Get-Health([int] $port) {
    try {
        return Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/v1/system/health" -f $port) -TimeoutSec 4
    } catch {
        return $null
    }
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal] $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Admin([string] $verb) {
    if (Test-Admin) { return }
    Write-Host "  '$verb' needs administrator rights - relaunching elevated..." -ForegroundColor Yellow
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath),
        $verb, '-FromElevation')
    if ($verb -eq 'logs') {
        $psArgs += @('-Tail', $Tail)
        if ($Stderr) { $psArgs += '-Stderr' }
    }
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $psArgs
    } catch {
        Write-Host "  Elevation cancelled. Run mng from an admin PowerShell instead." -ForegroundColor Red
    }
    exit
}

# -- Commands -----------------------------------------------------------------
function Show-Status {
    $port = Get-Port
    $svc  = Get-Service -Name $Service -ErrorAction SilentlyContinue

    Write-Host ''
    Write-Host '  GSSG Manager' -ForegroundColor Cyan

    if (-not $svc) {
        Write-Row 'Service' "$Service (not installed?)" 'Red'
        Write-Host ''
        return
    }

    $running   = $svc.Status -eq 'Running'
    Write-Row 'Service' $svc.Status ($(if ($running) { 'Green' } else { 'Red' }))

    $health = if ($running) { Get-Health $port } else { $null }
    if ($health) {
        Write-Row 'Health' ("ok  (v{0})" -f $health.version) 'Green'
        Write-Row 'Uptime' (Format-Uptime $health.uptime_seconds)
    } elseif ($running) {
        Write-Row 'Health' 'service up, HTTP not responding yet' 'Yellow'
    } else {
        Write-Row 'Health' 'down' 'Red'
    }

    Write-Row 'URL' ("http://localhost:{0}" -f $port) 'Cyan'

    $procs = @(Get-AppProcesses)
    if ($procs.Count -gt 0) {
        $ids = ($procs | ForEach-Object { $_.ProcessId }) -join ', '
        $ram = 0
        foreach ($p in $procs) {
            $po = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
            if ($po) { $ram += $po.WorkingSet64 }
        }
        Write-Row 'PID(s)' $ids
        Write-Row 'Memory' (Format-MB $ram)

        $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) { Write-Row 'Listening' ("{0}:{1}" -f $listener.LocalAddress, $listener.LocalPort) }
    }

    Write-Row 'Logs' $LogDir
    Write-Host ''
}

function Show-Health {
    $port = Get-Port
    $h = Get-Health $port
    if ($h) {
        Write-Host ("UP   v{0}   uptime {1}" -f $h.version, (Format-Uptime $h.uptime_seconds)) -ForegroundColor Green
        exit 0
    }
    Write-Host ("DOWN   (no response on http://127.0.0.1:{0})" -f $port) -ForegroundColor Red
    exit 1
}

function Invoke-Start {
    Assert-Admin 'start'
    Write-Host "  Starting $Service ..." -ForegroundColor Cyan
    Start-Service -Name $Service
    Wait-Healthy
    Show-Status
}

function Invoke-Stop {
    Assert-Admin 'stop'
    Write-Host "  Stopping $Service ..." -ForegroundColor Cyan
    Stop-Service -Name $Service -Force
    Write-Host '  Stopped.' -ForegroundColor Yellow
}

function Invoke-Restart {
    Assert-Admin 'restart'
    Write-Host "  Restarting $Service ..." -ForegroundColor Cyan
    Restart-Service -Name $Service -Force
    Wait-Healthy
    Show-Status
}

function Wait-Healthy {
    $port = Get-Port
    for ($i = 0; $i -lt 20; $i++) {
        if (Get-Health $port) { return }
        Start-Sleep -Milliseconds 500
    }
}

function Sync-BackendDependencies {
    $venvPy      = Join-Path $Root 'venv\Scripts\python.exe'
    $requirements = Join-Path $Root 'requirements.txt'
    if (-not (Test-Path $venvPy)) { throw "venv python not found at $venvPy" }
    if (-not (Test-Path $requirements)) { throw "requirements file not found at $requirements" }

    Write-Host '  Syncing backend dependencies (pip install -r requirements.txt) ...' -ForegroundColor Cyan
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $venvPy -m pip install --disable-pip-version-check -r $requirements 2>&1 |
            ForEach-Object { Write-Host "    $_" }
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    if ($LASTEXITCODE -ne 0) {
        throw "backend dependency sync failed (exit $LASTEXITCODE) - service not restarted"
    }
    Write-Host '  Backend dependencies ready.' -ForegroundColor Green
}

function Build-Frontend {
    # Compiles the frontend into frontend\dist without touching the live
    # backend\app\static bundle. Deploy/update publish it separately
    # (Publish-Frontend) only after migrate + smoke check succeed, so a
    # failure partway through never leaves a newer frontend live against an
    # older, un-migrated backend ("shipped only the frontend").
    if (-not (Test-Path (Join-Path $FrontendDir 'node_modules\.bin'))) {
        throw "frontend\node_modules missing. Run 'pnpm install' in $FrontendDir first."
    }
    Assert-BuildMemory
    Write-Host '  Building frontend (pnpm run build) ...' -ForegroundColor Cyan
    Push-Location $FrontendDir
    try {
        # pnpm/vite emit progress and warnings (notably the chunk-size notice)
        # on stderr. Under the script-wide $ErrorActionPreference='Stop',
        # PowerShell 5.1 promotes ANY native-command stderr line to a
        # terminating NativeCommandError — a false "build failed" even when the
        # build exits 0. Demote stderr to plain output for this call and judge
        # success solely by the exit code.
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            pnpm run build 2>&1 | ForEach-Object { Write-Host $_ }
        } finally {
            $ErrorActionPreference = $prevEAP
        }
        if ($LASTEXITCODE -eq 134) {
            # SIGABRT - V8 aborted on a failed allocation. Report it as memory
            # rather than letting the native stack trace above stand as the
            # explanation, because the fix is freeing memory, not the code.
            $m = Get-Commit
            throw ('frontend build ran out of memory (node aborted, exit 134); {0:N0} MB commit available now. Free memory and rerun: mng deploy' -f $m.AvailableMB)
        }
        if ($LASTEXITCODE -ne 0) { throw "frontend build failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path $DistDir)) { throw "build produced no dist\ at $DistDir" }
}

function Publish-Frontend {
    Write-Host '  Copying dist -> backend\app\static ...' -ForegroundColor Cyan
    if (Test-Path $StaticDir) {
        Get-ChildItem -Path $StaticDir -Force | Remove-Item -Recurse -Force
    } else {
        New-Item -ItemType Directory -Path $StaticDir | Out-Null
    }
    Copy-Item -Path (Join-Path $DistDir '*') -Destination $StaticDir -Recurse -Force
    Write-Host '  Build complete.' -ForegroundColor Green
}

function Invoke-Build {
    # Standalone `mng build`: compile and publish immediately (no migrate to
    # gate on). Deploy/update call Build-Frontend / Publish-Frontend
    # separately instead of this wrapper.
    Build-Frontend
    Publish-Frontend
}

function Invoke-Migrate {
    # Apply any pending Alembic migrations so a deploy that ships a new migration
    # can't leave the live DB behind the code (a mismatch that manifests as
    # "no such column" 500s once the new code queries the not-yet-added column).
    # Additive migrations are safe to run while the old code is still serving.
    $venvPy = Join-Path $Root 'venv\Scripts\python.exe'
    if (-not (Test-Path $venvPy)) { throw "venv python not found at $venvPy" }

    $recent = Get-LatestBackup $BackupDir
    if ($recent -and $recent.Age.TotalDays -lt $BackupMaxAgeDays) {
        # Skipping the backup removes its implicit "DB is reachable and there is
        # disk headroom" check, so do an explicit RAM check before migrating.
        Assert-BuildMemory
        Write-Host ('  Recent backup {0} is {1} old (< {2}d) - skipping a new pre-migration backup.' -f $recent.Name, (Format-Uptime $recent.Age.TotalSeconds), $BackupMaxAgeDays) -ForegroundColor DarkGray
    } else {
        # Back up the DB first: once alembic migrates, rolling back means restoring
        # data, and there is no other automatic copy. The CLI reads data_dir from
        # settings and copies the DB via SQLite's online-backup API (WAL-safe while
        # the service is running), then prunes old copies. The app package only
        # resolves with backend\ as the working directory.
        Write-Host '  Backing up the database before migrating ...' -ForegroundColor Cyan
        Push-Location (Join-Path $Root 'backend')
        try {
            # backup_service logs to stderr; same EAP demotion as the alembic call
            # below, judged by exit code alone.
            $prevEAP = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                & $venvPy -m app.services.backup_service 2>&1 | ForEach-Object { Write-Host "    $_" }
            } finally {
                $ErrorActionPreference = $prevEAP
            }
            if ($LASTEXITCODE -ne 0) { throw "pre-migration backup failed (exit $LASTEXITCODE) - migration aborted; fix the backup error above and rerun" }
        } finally {
            Pop-Location
        }
        Write-Host '  Pre-migration backup complete.' -ForegroundColor Green
    }

    Write-Host '  Applying DB migrations (alembic upgrade head) ...' -ForegroundColor Cyan
    Push-Location $Root
    try {
        # alembic logs to stderr; under $ErrorActionPreference='Stop' PS 5.1 would
        # promote those lines to a terminating error (same gotcha as Invoke-Build).
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $venvPy -m alembic upgrade head 2>&1 | ForEach-Object { Write-Host "    $_" }
        } finally {
            $ErrorActionPreference = $prevEAP
        }
        if ($LASTEXITCODE -ne 0) { throw "alembic upgrade head failed (exit $LASTEXITCODE) - DB not migrated; aborting before restart" }
    } finally {
        Pop-Location
    }
    Write-Host '  Migrations applied.' -ForegroundColor Green
}
function Invoke-SmokeCheck {
    # Restart is the point of no return: a dead-on-arrival import (syntax error,
    # bad router wiring) currently takes the service down with it. Building the
    # FastAPI app exercises every module import and router registration without
    # touching the DB or binding a port, so it is safe while the service runs.
    Write-Host '  Smoke-checking backend import (create_app) ...' -ForegroundColor Cyan
    $venvPy = Join-Path $Root 'venv\Scripts\python.exe'
    if (-not (Test-Path $venvPy)) { throw "venv python not found at $venvPy" }
    Push-Location (Join-Path $Root 'backend')
    try {
        # The app logs to stderr during startup; same EAP demotion as the
        # alembic/backup calls, judged by exit code alone.
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $venvPy -c "from app.main import create_app; create_app()" 2>&1 | ForEach-Object { Write-Host "    $_" }
        } finally {
            $ErrorActionPreference = $prevEAP
        }
        if ($LASTEXITCODE -ne 0) { throw "backend smoke check failed (exit $LASTEXITCODE) - fix the import error above before restarting the service" }
    } finally {
        Pop-Location
    }
    Write-Host '  Smoke check passed.' -ForegroundColor Green
}

function Invoke-Deploy {
    Assert-Admin 'deploy'
    Sync-BackendDependencies
    Build-Frontend
    Invoke-Migrate
    Invoke-SmokeCheck
    Publish-Frontend
    Write-Host "  Restarting $Service to load backend changes ..." -ForegroundColor Cyan
    Restart-Service -Name $Service -Force
    Wait-Healthy
    Show-Status
}

function Invoke-Update {
    Assert-Admin 'update'
    Push-Location $Root
    try {
        Write-Host '  Fetching latest from git ...' -ForegroundColor Cyan
        $before = (git rev-parse HEAD).Trim()
        git pull --ff-only
        if ($LASTEXITCODE -ne 0) { throw 'git pull failed (resolve manually, then run: mng deploy)' }
        $after = (git rev-parse HEAD).Trim()
        # Pathspecs are cwd-relative, so the frontend diff must run while we are
        # still at the repo root. `git diff --name-only` prints nothing when the
        # range left frontend/ untouched.
        $frontendFiles = @(git diff --name-only $before $after -- 'frontend/')
    } finally {
        Pop-Location
    }
    if ($before -eq $after) {
        Write-Host '  Already up to date - nothing to deploy.' -ForegroundColor Green
        Show-Status
        return
    }
    Write-Host ("  Updated {0} -> {1}. Deploying ..." -f $before.Substring(0, 7), $after.Substring(0, 7)) -ForegroundColor Cyan
    $builtFrontend = $false
    try {
        Sync-BackendDependencies
        if ($frontendFiles.Count -eq 0) {
            # The bundle in backend\app\static already matches this range, and a
            # rebuild needs commit headroom (see Assert-BuildMemory) for no gain - skip it.
            Write-Host '  No frontend changes in this range - skipping the frontend build.' -ForegroundColor DarkGray
        } else {
            Build-Frontend
            $builtFrontend = $true
        }
        Invoke-Migrate
        Invoke-SmokeCheck
        # Publish only after migrate + smoke check succeed, so a failure never
        # leaves a newer frontend live against an older, un-migrated backend.
        if ($builtFrontend) { Publish-Frontend }
    } catch {
        # The pull already moved the checkout forward. If the build or migration
        # fails the service keeps serving the PREVIOUS bundle, so the code on disk
        # is newer than what users see - say so rather than leave a silent mismatch.
        Write-Host ''
        Write-Host ('  DEPLOY ABORTED - checkout is now {0} but the service still serves the bundle built from {1}.' -f $after.Substring(0, 7), $before.Substring(0, 7)) -ForegroundColor Red
        Write-Host '  Nothing was restarted. Fix the error above, then run: mng deploy' -ForegroundColor Red
        throw
    }
    Restart-Service -Name $Service -Force
    Wait-Healthy
    Show-Status
}

function Show-Logs {
    $path = if ($Stderr) { $StderrLog } else { $StdoutLog }
    if (-not (Test-Path $path)) { Write-Host "No log at $path" -ForegroundColor Yellow; return }
    Write-Host ("==> {0}  (last {1} lines) <==" -f $path, $Tail) -ForegroundColor Cyan
    Get-Content -Path $path -Tail $Tail
}

function Open-App {
    $port = Get-Port
    Start-Process ("http://localhost:{0}" -f $port)
}

function Show-Help {
    Write-Host ''
    Write-Host '  mng - GSSG Manager control' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '    mng status      service state, health, uptime, version, RAM, URL'
    Write-Host '    mng health      quick UP/DOWN check (exit code 0/1)'
    Write-Host '    mng start       start the service'
    Write-Host '    mng stop        stop the service'
    Write-Host '    mng restart     restart the service'
    Write-Host '    mng build       rebuild frontend bundle -> backend\app\static'
    Write-Host '    mng deploy      sync deps + backup + build + migrate + smoke check + restart'
    Write-Host '    mng update      git pull; if changed -> sync deps + deploy (skips untouched frontend)'
    Write-Host '    mng logs        tail service log   (-Tail N, -Stderr)'
    Write-Host '    mng open        open the app in the browser'
    Write-Host ''
    Write-Host '  start/stop/restart/deploy/update auto-elevate (UAC) when needed.' -ForegroundColor Gray
    Write-Host '  build uses the committed api.types.ts (no OpenAPI regen) - to refresh' -ForegroundColor Gray
    Write-Host '  generated types, run scripts\build.ps1 instead.' -ForegroundColor Gray
    Write-Host ''
}

# -- Dispatch -----------------------------------------------------------------
try {
    switch ($Command) {
        'status'  { Show-Status }
        'health'  { Show-Health }
        'start'   { Invoke-Start }
        'stop'    { Invoke-Stop }
        'restart' { Invoke-Restart }
        'build'   { Invoke-Build }
        'deploy'  { Invoke-Deploy }
        'update'  { Invoke-Update }
        'logs'    { Show-Logs }
        'open'    { Open-App }
        'help'    { Show-Help }
    }
} catch {
    Write-Host ("  ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if ($FromElevation) { Read-Host '  Press Enter to close' }
    exit 1
}

if ($FromElevation) { Read-Host '  Press Enter to close' }
