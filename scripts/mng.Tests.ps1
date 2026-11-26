$scriptPath = Join-Path $PSScriptRoot 'mng.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $scriptPath,
    [ref]$tokens,
    [ref]$errors
)
if ($errors.Count -gt 0) {
    throw "Unable to parse mng.ps1: $($errors -join '; ')"
}

$functionNames = @(
    'Get-DotEnvValue',
    'Read-DotEnv',
    'Resolve-GitRemoteUrl',
    'Get-UpdateGitAuthentication',
    'Invoke-AuthenticatedGitFetch',
    'Get-CommitChecks',
    'Assert-CommitGreen',
    'Invoke-Update'
)
$definitions = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $functionNames -contains $node.Name
}, $true) | ForEach-Object { $_.Extent.Text }

function Invoke-TestGit {
    param(
        [string] $WorkingDirectory,
        [object] $Arguments
    )
    [string[]] $gitArguments = $Arguments
    Push-Location $WorkingDirectory
    try {
        $null = & git @gitArguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($exitCode -ne 0) {
        throw "git test fixture command failed (exit $exitCode): git $($gitArguments -join ' ')"
    }
}

# The update's post-pull deployment is intentionally stubbed in this suite.
# The pull itself remains a real git client operation against the fixture.
function Assert-Admin([string] $verb) {}
function Sync-BackendDependencies {}
function Invoke-Migrate {}
function Invoke-SmokeCheck {}
function Restart-Service([string] $Name) {}
function Wait-Healthy {}
function Show-Status {}
. ([scriptblock]::Create(($definitions -join "`n")))

$savedUsername = [Environment]::GetEnvironmentVariable('MNG_GIT_USERNAME', 'Process')
$savedAskPass = [Environment]::GetEnvironmentVariable('GIT_ASKPASS', 'Process')
$savedTerminalPrompt = [Environment]::GetEnvironmentVariable('GIT_TERMINAL_PROMPT', 'Process')
$savedToken = [Environment]::GetEnvironmentVariable('MNG_GIT_TOKEN', 'Process')

Describe 'mng update repository authentication' {
    BeforeEach {
        $script:Root = $TestDrive
        $Root = $TestDrive
        Remove-Item Env:MNG_GIT_USERNAME -ErrorAction SilentlyContinue
        Remove-Item Env:MNG_GIT_TOKEN -ErrorAction SilentlyContinue
    }

    AfterEach {
        if ($null -eq $savedUsername) {
            Remove-Item Env:MNG_GIT_USERNAME -ErrorAction SilentlyContinue
        } else {
            $env:MNG_GIT_USERNAME = $savedUsername
        }
        if ($null -eq $savedToken) {
            Remove-Item Env:MNG_GIT_TOKEN -ErrorAction SilentlyContinue
        } else {
            $env:MNG_GIT_TOKEN = $savedToken
        }
    }

    It 'does not require PAT credentials for SSH remotes' {
        $authentication = Get-UpdateGitAuthentication 'git@github.com:janooh37-hue/sentinel.git'

        $authentication | Should BeNullOrEmpty
    }

    It 'fails closed before supplying credentials to an unrelated HTTPS origin' {
        $token = 'sentinel-test-token-' + [Guid]::NewGuid().ToString('N')
        $env:MNG_GIT_USERNAME = 'sentinel-test-user'
        $env:MNG_GIT_TOKEN = $token
        $thrown = $false
        try {
            Get-UpdateGitAuthentication 'https://attacker.example.invalid/other/repository.git'
        } catch {
            $thrown = $true
            $message = $_.Exception.Message
        }

        $thrown | Should Be $true
        $message | Should Match 'unexpected HTTPS origin'
        $message | Should Not Match ([regex]::Escape($token))
    }

    It 'does not print credentials from a rejected HTTPS remote URL' {
        $remote = 'https://sentinel-user:sentinel-secret@github.com/janooh37-hue/sentinel.git'
        $thrown = $false
        try {
            Get-UpdateGitAuthentication $remote
        } catch {
            $thrown = $true
            $message = $_.Exception.Message
        }

        $thrown | Should Be $true
        $message | Should Match 'unexpected HTTPS origin'
        $message | Should Not Match ([regex]::Escape($remote))
        $message | Should Not Match 'sentinel-secret'
    }

    It 'fails closed when Git rewrites the canonical origin to an unrelated destination' {
        $repoRoot = Join-Path $TestDrive 'rewritten-origin'
        New-Item -ItemType Directory -Path $repoRoot | Out-Null
        Invoke-TestGit $repoRoot @('init', '-q')
        Invoke-TestGit $repoRoot @(
            'config',
            'url.https://attacker.example.invalid/.insteadOf',
            'https://github.com/janooh37-hue/'
        )
        $token = 'sentinel-rewrite-token-' + [Guid]::NewGuid().ToString('N')
        $script:Root = $repoRoot
        $env:MNG_GIT_USERNAME = 'sentinel-test-user'
        $Root = $repoRoot
        try {
            Get-UpdateGitAuthentication 'https://github.com/janooh37-hue/sentinel.git'
        } catch {
            $thrown = $true
            $message = $_.Exception.Message
        }

        $thrown | Should Be $true
        $message | Should Match 'unexpected HTTPS origin'
        $message | Should Not Match ([regex]::Escape($token))
        $message | Should Not Match 'attacker\.example'
    }

    It 'reports both missing HTTPS credential settings without exposing a value' {
        $envFile = Join-Path $TestDrive '.env'
        Set-Content -LiteralPath $envFile -Value 'GSSG_PORT=8765' -Encoding UTF8
        $thrown = $false
        try {
            Get-UpdateGitAuthentication 'https://github.com/janooh37-hue/sentinel.git'
        } catch {
            $thrown = $true
            $message = $_.Exception.Message
        }

        $thrown | Should Be $true
        $message | Should Match 'MNG_GIT_USERNAME.*MNG_GIT_TOKEN'
    }

    It 'loads configured credentials from the ignored env file' {
        $envFile = Join-Path $TestDrive '.env'
        $username = 'sentinel-test-user'
        $token = [Guid]::NewGuid().ToString('N')
        Set-Content -LiteralPath $envFile -Value @(
            'MNG_GIT_USERNAME="sentinel-test-user" # account',
            "MNG_GIT_TOKEN='$token'"
        ) -Encoding UTF8

        $authentication = Get-UpdateGitAuthentication 'https://github.com/janooh37-hue/sentinel'

        $authentication.Username | Should Be $username
        $authentication.Token | Should Be $token
    }

    It 'uses a temporary askpass helper and restores the process environment' {
        $token = [Guid]::NewGuid().ToString('N')
        $authentication = [pscustomobject]@{
            Username = 'sentinel-test-user'
            Token = $token
        }
        $fakeGitDir = Join-Path $TestDrive 'bin'
        New-Item -ItemType Directory -Path $fakeGitDir | Out-Null
        Set-Content -LiteralPath (Join-Path $fakeGitDir 'git.cmd') -Encoding ASCII -Value @(
            '@echo off',
            'powershell.exe -NoProfile -Command "$p=$env:GIT_ASKPASS; $u=& $p ''Username for https://github.com:''; $t=& $p ''Password for https://github.com:''; if (($u -ne $env:MNG_UPDATE_GIT_USERNAME) -or ($t -ne $env:MNG_UPDATE_GIT_TOKEN)) { exit 1 }; exit 0"',
            'exit /b %ERRORLEVEL%'
        )
        $oldPath = $env:PATH
        try {
            $env:PATH = "$fakeGitDir;$oldPath"
            $result = @(Invoke-AuthenticatedGitFetch $authentication)
        } finally {
            $env:PATH = $oldPath
        }

        $result | Should Be 0
        [Environment]::GetEnvironmentVariable('GIT_ASKPASS', 'Process') | Should Be $savedAskPass
        [Environment]::GetEnvironmentVariable('GIT_TERMINAL_PROMPT', 'Process') | Should Be $savedTerminalPrompt
    }

    It 'pulls a private Sentinel update with a real git client without leaking the token' {
        $repoRoot = Join-Path $TestDrive 'checkout'
        $seedRoot = Join-Path $TestDrive 'seed'
        $bareRoot = Join-Path $TestDrive 'sentinel.git'
        $serverScript = Join-Path $TestDrive 'auth-git-server.py'
        $serverOutput = Join-Path $TestDrive 'auth-git-server.out'
        $serverError = Join-Path $TestDrive 'auth-git-server.err'
        $username = 'sentinel-test-user'
        $token = 'sentinel-test-token-' + [Guid]::NewGuid().ToString('N')
        $expectedRemote = 'https://github.com/janooh37-hue/sentinel.git'
        $server = $null

        $pythonSource = @'
import base64
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit


class GitHandler(BaseHTTPRequestHandler):
    def _handle(self):
        expected = "Basic " + base64.b64encode(
            (os.environ["MNG_TEST_SERVER_USERNAME"] + ":" +
             os.environ["MNG_TEST_SERVER_TOKEN"]).encode("utf-8")
        ).decode("ascii")
        if self.headers.get("Authorization") != expected:
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="sentinel-test"')
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        split = urlsplit(self.path)
        cgi_env = os.environ.copy()
        cgi_env.update({
            "GATEWAY_INTERFACE": "CGI/1.1",
            "REQUEST_METHOD": self.command,
            "PATH_INFO": split.path,
            "QUERY_STRING": split.query,
            "REMOTE_ADDR": self.client_address[0],
            "REMOTE_USER": os.environ["MNG_TEST_SERVER_USERNAME"],
            "SERVER_PROTOCOL": self.request_version,
            "SERVER_NAME": self.server.server_address[0],
            "SERVER_PORT": str(self.server.server_address[1]),
            "GIT_PROJECT_ROOT": os.environ["MNG_TEST_SERVER_ROOT"],
            "GIT_HTTP_EXPORT_ALL": "1",
            "CONTENT_LENGTH": str(len(body)),
            "CONTENT_TYPE": self.headers.get("Content-Type", ""),
        })
        for key, value in self.headers.items():
            cgi_env["HTTP_" + key.upper().replace("-", "_")] = value

        result = subprocess.run(
            ["git", "http-backend"],
            input=body,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=cgi_env,
            check=False,
        )
        separator = b"\r\n\r\n"
        split_at = result.stdout.find(separator)
        separator_length = len(separator)
        if split_at < 0:
            separator = b"\n\n"
            split_at = result.stdout.find(separator)
            separator_length = len(separator)
        if split_at < 0:
            self.send_error(500, "git http-backend returned no headers")
            return

        header_bytes = result.stdout[:split_at]
        payload = result.stdout[split_at + separator_length:]
        status = 200
        headers = []
        for line in header_bytes.splitlines():
            key, value = line.decode("latin-1").split(":", 1)
            if key.lower() == "status":
                status = int(value.strip().split(" ", 1)[0])
            elif key.lower() not in ("connection", "transfer-encoding"):
                headers.append((key, value.strip()))
        self.send_response(status)
        for key, value in headers:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    do_GET = _handle
    do_POST = _handle

    def log_message(self, format, *args):
        pass


server = HTTPServer(("127.0.0.1", int(sys.argv[1])), GitHandler)
print("READY", flush=True)
server.serve_forever()
'@

        try {
            New-Item -ItemType Directory -Path $seedRoot | Out-Null
            Invoke-TestGit $TestDrive @('init', '--bare', '-q', $bareRoot)
            Invoke-TestGit $seedRoot @('init', '-q')
            Invoke-TestGit $seedRoot @('config', 'user.email', 'sentinel-test@example.invalid')
            Invoke-TestGit $seedRoot @('config', 'user.name', 'Sentinel Test')
            Set-Content -LiteralPath (Join-Path $seedRoot 'README.txt') -Value 'initial' -Encoding UTF8
            Invoke-TestGit $seedRoot @('add', 'README.txt')
            Invoke-TestGit $seedRoot @('commit', '-qm', 'initial fixture commit')
            Invoke-TestGit $seedRoot @('branch', '-M', 'main')
            Invoke-TestGit $seedRoot @('remote', 'add', 'origin', $bareRoot)
            Invoke-TestGit $seedRoot @('push', '-q', 'origin', 'main')
            Invoke-TestGit $TestDrive @('clone', '-q', '--branch', 'main', $bareRoot, $repoRoot)

            $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
            $portProbe.Start()
            $port = $portProbe.LocalEndpoint.Port
            $portProbe.Stop()
            Set-Content -LiteralPath $serverScript -Value $pythonSource -Encoding UTF8
            $env:MNG_TEST_SERVER_ROOT = $TestDrive
            $env:MNG_TEST_SERVER_USERNAME = $username
            $env:MNG_TEST_SERVER_TOKEN = $token
            $python = (Get-Command python.exe -ErrorAction Stop).Source
            $server = Start-Process -FilePath $python -ArgumentList @($serverScript, $port) `
                -WorkingDirectory $TestDrive -RedirectStandardOutput $serverOutput `
                -RedirectStandardError $serverError -PassThru
            $ready = $false
            for ($attempt = 0; $attempt -lt 100; $attempt++) {
                if ($server.HasExited) { throw "authenticated Git fixture server exited: $serverError" }
                if ((Test-Path $serverOutput) -and ((Get-Content -LiteralPath $serverOutput -Raw) -match 'READY')) {
                    $ready = $true
                    break
                }
                Start-Sleep -Milliseconds 50
            }
            $ready | Should Be $true

            $Root = $repoRoot
            $script:Root = $repoRoot
            $envFile = Join-Path $repoRoot '.env'
            Set-Content -LiteralPath $envFile -Encoding UTF8 -Value @(
                "MNG_GIT_USERNAME=$username"
                "MNG_GIT_TOKEN=$token"
            )
            $script:expectedRemoteForTest = $expectedRemote
            Mock Resolve-GitRemoteUrl {
                # Keep authentication pointed at the canonical origin while
                # Git's local url.*.insteadOf rule routes the pull to the fixture.
                param([string] $remoteUrl)
                return $script:expectedRemoteForTest
            }

            $staleHelper = Join-Path $TestDrive 'stale-credential-helper.cmd'
            $staleHelperMarker = Join-Path $TestDrive 'stale-credential-helper.used'
            Set-Content -LiteralPath $staleHelper -Encoding ASCII -Value @(
                '@echo off',
                "echo used > `"$staleHelperMarker`"",
                'echo username=stale-user',
                'echo password=stale-token'
            )
            Invoke-TestGit $repoRoot @('config', 'credential.helper', $staleHelper)
            Invoke-TestGit $repoRoot @('config', ('url.http://127.0.0.1:{0}/.insteadOf' -f $port), 'https://github.com/janooh37-hue/')
            Invoke-TestGit $repoRoot @('remote', 'set-url', 'origin', $expectedRemote)
            Set-Content -LiteralPath (Join-Path $seedRoot 'README.txt') -Value 'pulled update' -Encoding UTF8
            Invoke-TestGit $seedRoot @('add', 'README.txt')
            Invoke-TestGit $seedRoot @('commit', '-qm', 'authenticated fixture update')
            Invoke-TestGit $seedRoot @('push', '-q', 'origin', 'main')
            Mock Invoke-RestMethod {
                # The deploy gate is covered below; here the commit is green.
                if ($Uri -match '/check-runs') {
                    return [pscustomobject]@{
                        total_count = 1
                        check_runs = @([pscustomobject]@{ name = 'backend-tests'; status = 'completed'; conclusion = 'success' })
                    }
                }
                return [pscustomobject]@{ state = 'pending'; statuses = @() }
            }

            $pullOutput = & {
                Push-Location $repoRoot
                try {
                    Invoke-Update
                } finally {
                    Pop-Location
                }
            } 6>&1 2>&1 | Out-String
            Remove-Item -LiteralPath $envFile -Force
            (Test-Path -LiteralPath $envFile) | Should Be $false
            $pullOutput | Should Not Match ([regex]::Escape($token))
            (Get-Content -LiteralPath (Join-Path $repoRoot 'README.txt') -Raw) | Should Match 'pulled update'
            (Test-Path -LiteralPath $staleHelperMarker) | Should Be $false

            $fakeGitDir = Join-Path $TestDrive 'plain-pull-git'
            $helperMarker = Join-Path $TestDrive 'plain-pull-git.args'
            New-Item -ItemType Directory -Path $fakeGitDir | Out-Null
            Set-Content -LiteralPath (Join-Path $fakeGitDir 'git.cmd') -Encoding ASCII -Value @(
                '@echo off',
                "echo %* > `"$helperMarker`"",
                'exit /b 0'
            )
            $oldPath = $env:PATH
            try {
                $env:PATH = "$fakeGitDir;$oldPath"
                $helperResult = & {
                    Push-Location $repoRoot
                    try {
                        Invoke-AuthenticatedGitFetch $null
                    } finally {
                        Pop-Location
                    }
                } 6>&1 2>&1 | Out-String
            } finally {
                $env:PATH = $oldPath
            }
            $helperResult | Should Match '0'
            (Get-Content -LiteralPath $helperMarker -Raw) | Should Match 'fetch'
            (Get-Content -LiteralPath $helperMarker -Raw) | Should Not Match 'credential\.helper='
            (Get-Content -LiteralPath (Join-Path $repoRoot 'README.txt') -Raw) | Should Match 'pulled update'

            $repositoryText = @(
                Get-ChildItem -LiteralPath $repoRoot -File -Recurse -Force |
                    ForEach-Object {
                        try { Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop } catch {}
                    }
            ) -join "`n"
            $repositoryText | Should Not Match ([regex]::Escape($token))
            if (-not $server.HasExited) {
                Stop-Process -Id $server.Id -Force
                $server.WaitForExit()
            }
            $server = $null
            $serverLogs = (Get-Content -LiteralPath $serverOutput -Raw -ErrorAction SilentlyContinue) +
                (Get-Content -LiteralPath $serverError -Raw -ErrorAction SilentlyContinue)
            $serverLogs | Should Not Match ([regex]::Escape($token))
        } finally {
            if ($server -and -not $server.HasExited) {
                Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
                $server.WaitForExit()
            }
            Remove-Item Env:MNG_TEST_SERVER_ROOT -ErrorAction SilentlyContinue
            Remove-Item Env:MNG_TEST_SERVER_USERNAME -ErrorAction SilentlyContinue
            Remove-Item Env:MNG_TEST_SERVER_TOKEN -ErrorAction SilentlyContinue
        }
    }
}

function New-CheckRun([string] $name, [string] $status, [string] $conclusion) {
    return [pscustomobject]@{ name = $name; status = $status; conclusion = $conclusion }
}

function New-CommitStatus([string] $context, [string] $state) {
    return [pscustomobject]@{ context = $context; state = $state }
}

Describe 'mng update deploy gate' {
    BeforeEach {
        # origin is a local bare repository, so the update uses plain git with
        # no credentials; only the GitHub checks API is faked.
        $fixtureRoot = Join-Path $TestDrive ('gate-' + [Guid]::NewGuid().ToString('N'))
        $bareRoot = Join-Path $fixtureRoot 'origin.git'
        $seedRoot = Join-Path $fixtureRoot 'seed'
        $repoRoot = Join-Path $fixtureRoot 'checkout'
        New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
        Invoke-TestGit $fixtureRoot @('init', '--bare', '-q', $bareRoot)
        New-Item -ItemType Directory -Path $seedRoot | Out-Null
        Invoke-TestGit $seedRoot @('init', '-q')
        Invoke-TestGit $seedRoot @('config', 'user.email', 'sentinel-test@example.invalid')
        Invoke-TestGit $seedRoot @('config', 'user.name', 'Sentinel Test')
        Set-Content -LiteralPath (Join-Path $seedRoot 'README.txt') -Value 'deployed' -Encoding UTF8
        Invoke-TestGit $seedRoot @('add', 'README.txt')
        Invoke-TestGit $seedRoot @('commit', '-qm', 'deployed commit')
        Invoke-TestGit $seedRoot @('branch', '-M', 'main')
        Invoke-TestGit $seedRoot @('remote', 'add', 'origin', $bareRoot)
        Invoke-TestGit $seedRoot @('push', '-q', 'origin', 'main')
        Invoke-TestGit $TestDrive @('clone', '-q', '--branch', 'main', $bareRoot, $repoRoot)
        Set-Content -LiteralPath (Join-Path $seedRoot 'README.txt') -Value 'next release' -Encoding UTF8
        Invoke-TestGit $seedRoot @('add', 'README.txt')
        Invoke-TestGit $seedRoot @('commit', '-qm', 'next release')
        Invoke-TestGit $seedRoot @('push', '-q', 'origin', 'main')

        $script:gateBefore = (& git -C $repoRoot rev-parse HEAD).Trim()
        $script:gateTarget = (& git -C $seedRoot rev-parse HEAD).Trim()
        $script:gateRepo = $repoRoot
        $script:Root = $repoRoot
        $Root = $repoRoot
        $script:gateCheckRuns = @()
        $script:gateStatuses = @()
        $script:gateApiDown = $false
        # GitHub's total number of status contexts; $null means "as many as listed".
        $script:gateStatusTotal = $null

        Mock Invoke-RestMethod {
            if ($script:gateApiDown) { throw 'Unable to connect to the remote server' }
            if ($Uri -match '/check-runs') {
                return [pscustomobject]@{
                    total_count = @($script:gateCheckRuns).Count
                    check_runs = @($script:gateCheckRuns)
                }
            }
            # GitHub reports a combined state of "pending" when a commit has
            # no statuses at all; the gate must judge the statuses themselves.
            $statusTotal = @($script:gateStatuses).Count
            if ($null -ne $script:gateStatusTotal) { $statusTotal = $script:gateStatusTotal }
            return [pscustomobject]@{ state = 'pending'; total_count = $statusTotal; statuses = @($script:gateStatuses) }
        }
        Mock Sync-BackendDependencies {}
    }

    function Invoke-GateUpdate([switch] $Force) {
        $script:gateError = $null
        $output = & {
            Push-Location $script:gateRepo
            try {
                Invoke-Update -Force:$Force
            } catch {
                $script:gateError = $_.Exception.Message
            } finally {
                Pop-Location
            }
        } 6>&1 2>&1 | Out-String
        return $output
    }

    function Get-GateHead {
        return (& git -C $script:gateRepo rev-parse HEAD).Trim()
    }

    It 'deploys a commit whose checks all succeeded, were neutral or were skipped' {
        $script:gateCheckRuns = @(
            (New-CheckRun 'backend-tests' 'completed' 'success'),
            (New-CheckRun 'PR Agent - Review' 'completed' 'neutral'),
            (New-CheckRun 'ruff format (changed files)' 'completed' 'skipped')
        )
        $script:gateStatuses = @((New-CommitStatus 'external' 'success'))

        $output = Invoke-GateUpdate

        $script:gateError | Should BeNullOrEmpty
        Get-GateHead | Should Be $script:gateTarget
        $output | Should Match ([regex]::Escape($script:gateTarget.Substring(0, 7)))
        Assert-MockCalled Sync-BackendDependencies -Times 1 -Exactly -Scope It
    }

    It 'asks the public GitHub API, with no token, about the commit it would pull' {
        $script:gateCheckRuns = @((New-CheckRun 'backend-tests' 'completed' 'success'))

        Invoke-GateUpdate | Out-Null

        Assert-MockCalled Invoke-RestMethod -Scope It -ParameterFilter {
            $Uri -like "https://api.github.com/repos/janooh37-hue/sentinel/commits/$($script:gateTarget)/check-runs*"
        }
        Assert-MockCalled Invoke-RestMethod -Scope It -ParameterFilter {
            $Uri -like "https://api.github.com/repos/janooh37-hue/sentinel/commits/$($script:gateTarget)/status*"
        }
        Assert-MockCalled Invoke-RestMethod -Scope It -Times 0 -Exactly -ParameterFilter {
            ($Headers -and $Headers.ContainsKey('Authorization')) -or $Credential -or $Token
        }
    }

    It 'refuses a commit that is <Case>, naming the commit and changing nothing' -TestCases @(
        @{ Case = 'red (failed check run)'; Expected = 'red'
           CheckRuns = @((New-CheckRun 'backend-tests' 'completed' 'failure'), (New-CheckRun 'api-contract' 'completed' 'success'))
           Statuses = @(); ApiDown = $false },
        @{ Case = 'red (cancelled check run)'; Expected = 'red'
           CheckRuns = @((New-CheckRun 'backend-tests' 'completed' 'cancelled'))
           Statuses = @(); ApiDown = $false },
        @{ Case = 'red (failed commit status)'; Expected = 'red'
           CheckRuns = @((New-CheckRun 'backend-tests' 'completed' 'success'))
           Statuses = @((New-CommitStatus 'external' 'error')); ApiDown = $false },
        @{ Case = 'pending (check run in progress)'; Expected = 'pending'
           CheckRuns = @((New-CheckRun 'backend-tests' 'in_progress' $null), (New-CheckRun 'api-contract' 'completed' 'success'))
           Statuses = @(); ApiDown = $false },
        @{ Case = 'pending (commit status pending)'; Expected = 'pending'
           CheckRuns = @((New-CheckRun 'backend-tests' 'completed' 'success'))
           Statuses = @((New-CommitStatus 'external' 'pending')); ApiDown = $false },
        @{ Case = 'missing checks'; Expected = 'pending'
           CheckRuns = @(); Statuses = @(); ApiDown = $false },
        @{ Case = 'unreachable'; Expected = 'unreachable'
           CheckRuns = @(); Statuses = @(); ApiDown = $true },
        @{ Case = 'unreachable (GitHub listed 100 of 101 commit statuses)'; Expected = 'unreachable'
           CheckRuns = @((New-CheckRun 'backend-tests' 'completed' 'success'))
           Statuses = @(1..100 | ForEach-Object { New-CommitStatus ('external-{0}' -f $_) 'success' })
           StatusTotal = 101; ApiDown = $false }
    ) {
        param($Case, $Expected, $CheckRuns, $Statuses, $ApiDown, $StatusTotal)
        $script:gateCheckRuns = $CheckRuns
        $script:gateStatuses = $Statuses
        $script:gateApiDown = $ApiDown
        $script:gateStatusTotal = $StatusTotal

        $output = Invoke-GateUpdate

        $script:gateError | Should Match ([regex]::Escape($script:gateTarget.Substring(0, 7)))
        $script:gateError | Should Match "not green \($Expected"
        $script:gateError | Should Match 'mng update -Force'
        Get-GateHead | Should Be $script:gateBefore
        (Get-Content -LiteralPath (Join-Path $script:gateRepo 'README.txt') -Raw) | Should Match 'deployed'
        Assert-MockCalled Sync-BackendDependencies -Times 0 -Exactly -Scope It
    }

    It 'deploys anyway with -Force, with a warning, even when GitHub is unreachable' {
        $script:gateApiDown = $true

        $output = Invoke-GateUpdate -Force

        $script:gateError | Should BeNullOrEmpty
        Get-GateHead | Should Be $script:gateTarget
        $output | Should Match 'WARNING'
        $output | Should Match '-Force'
        $output | Should Match ([regex]::Escape($script:gateTarget.Substring(0, 7)))
        Assert-MockCalled Sync-BackendDependencies -Times 1 -Exactly -Scope It
    }

    It 'does not ask GitHub when there is nothing to pull' {
        Invoke-TestGit $script:gateRepo @('pull', '-q', '--ff-only')

        $output = Invoke-GateUpdate

        $script:gateError | Should BeNullOrEmpty
        $output | Should Match 'Already up to date'
        Assert-MockCalled Invoke-RestMethod -Times 0 -Exactly -Scope It
    }
}
