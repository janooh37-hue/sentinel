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
        mng deploy          # build + restart  (apply local code changes)
        mng update          # git pull; if anything changed -> deploy
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

function Invoke-Build {
    if (-not (Test-Path (Join-Path $FrontendDir 'node_modules\.bin'))) {
        throw "frontend\node_modules missing. Run 'pnpm install' in $FrontendDir first."
    }
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
        if ($LASTEXITCODE -ne 0) { throw "frontend build failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path $DistDir)) { throw "build produced no dist\ at $DistDir" }

    Write-Host '  Copying dist -> backend\app\static ...' -ForegroundColor Cyan
    if (Test-Path $StaticDir) {
        Get-ChildItem -Path $StaticDir -Force | Remove-Item -Recurse -Force
    } else {
        New-Item -ItemType Directory -Path $StaticDir | Out-Null
    }
    Copy-Item -Path (Join-Path $DistDir '*') -Destination $StaticDir -Recurse -Force
    Write-Host '  Build complete.' -ForegroundColor Green
}

function Invoke-Migrate {
    # Apply any pending Alembic migrations so a deploy that ships a new migration
    # can't leave the live DB behind the code (a mismatch that manifests as
    # "no such column" 500s once the new code queries the not-yet-added column).
    # Additive migrations are safe to run while the old code is still serving.
    Write-Host '  Applying DB migrations (alembic upgrade head) ...' -ForegroundColor Cyan
    $venvPy = Join-Path $Root 'venv\Scripts\python.exe'
    if (-not (Test-Path $venvPy)) { throw "venv python not found at $venvPy" }
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

function Invoke-Deploy {
    Assert-Admin 'deploy'
    Invoke-Build
    Invoke-Migrate
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
    } finally {
        Pop-Location
    }
    if ($before -eq $after) {
        Write-Host '  Already up to date - nothing to deploy.' -ForegroundColor Green
        Show-Status
        return
    }
    Write-Host ("  Updated {0} -> {1}. Deploying ..." -f $before.Substring(0, 7), $after.Substring(0, 7)) -ForegroundColor Cyan
    Invoke-Build
    Invoke-Migrate
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
    Write-Host '    mng deploy      build + restart (apply local code changes)'
    Write-Host '    mng update      git pull; if changed -> build + restart'
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
