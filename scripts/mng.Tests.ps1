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
    'Get-UpdateGitAuthentication',
    'Invoke-AuthenticatedGitPull'
)
$definitions = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $functionNames -contains $node.Name
}, $true) | ForEach-Object { $_.Extent.Text }
. ([scriptblock]::Create(($definitions -join "`n")))

$savedUsername = [Environment]::GetEnvironmentVariable('MNG_GIT_USERNAME', 'Process')
$savedAskPass = [Environment]::GetEnvironmentVariable('GIT_ASKPASS', 'Process')
$savedTerminalPrompt = [Environment]::GetEnvironmentVariable('GIT_TERMINAL_PROMPT', 'Process')
$savedToken = [Environment]::GetEnvironmentVariable('MNG_GIT_TOKEN', 'Process')

Describe 'mng update repository authentication' {
    BeforeEach {
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

        $authentication = Get-UpdateGitAuthentication 'https://github.com/janooh37-hue/sentinel.git'

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
            'powershell.exe -NoProfile -Command "$m=[regex]::Match($env:GIT_ASKPASS, ''-File ''+[char]34+''(.+)''+[char]34); $p=$m.Groups[1].Value; $u=& powershell.exe -NoProfile -File $p ''Username for https://github.com:''; $t=& powershell.exe -NoProfile -File $p ''Password for https://github.com:''; if (($u -ne $env:MNG_UPDATE_GIT_USERNAME) -or ($t -ne $env:MNG_UPDATE_GIT_TOKEN)) { exit 1 }; exit 0"',
            'exit /b %ERRORLEVEL%'
        )
        $oldPath = $env:PATH
        try {
            $env:PATH = "$fakeGitDir;$oldPath"
            $result = @(Invoke-AuthenticatedGitPull $authentication)
        } finally {
            $env:PATH = $oldPath
        }

        $result | Should Be 0
        [Environment]::GetEnvironmentVariable('GIT_ASKPASS', 'Process') | Should Be $savedAskPass
        [Environment]::GetEnvironmentVariable('GIT_TERMINAL_PROMPT', 'Process') | Should Be $savedTerminalPrompt
    }
}
