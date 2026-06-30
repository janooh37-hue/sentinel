<#
.SYNOPSIS
    Write the SMS Gate credentials into the project .env and (optionally)
    validate them against the gateway before you restart the service.

.DESCRIPTION
    Upserts the GSSG_SMS_* lines in C:\Users\Admin\sentinel\.env:
      GSSG_SMS_ENABLED      = true only if -Enable is passed (default false)
      GSSG_SMS_GATEWAY_URL  = SMS Gate local-server base URL
      GSSG_SMS_USERNAME     = Basic auth username
      GSSG_SMS_PASSWORD     = Basic auth password
      GSSG_SMS_COUNTRY_CODE = default country code for phone normalisation
    Existing lines are replaced in place; missing ones are appended. Other .env
    content is left untouched. The password is never printed.

    Unless -NoValidate is given, it first performs a GET to the gateway base URL
    with Basic auth to confirm the gateway is reachable and the credentials work:
    a 401 means bad creds; a connection failure means the phone is unreachable.

.PARAMETER GatewayUrl
    SMS Gate local-server base URL, e.g. http://192.168.1.50:8080

.PARAMETER Username
    Local-server Basic auth username.

.PARAMETER Password
    Local-server Basic auth password.

.PARAMETER CountryCode
    Default country code for normalizing employee phone numbers (digits only).
    Defaults to 971 (UAE).

.PARAMETER Enable
    Also set GSSG_SMS_ENABLED=true. Use this only once the phone is ready,
    tested, and on a static IP.

.PARAMETER NoValidate
    Skip the gateway connectivity/credential check.

.EXAMPLE
    ./configure-sms.ps1 -GatewayUrl http://192.168.1.50:8080 -Username gssg -Password secret

.EXAMPLE
    ./configure-sms.ps1 -GatewayUrl http://192.168.1.50:8080 -Username gssg -Password secret -Enable
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $GatewayUrl,
    [Parameter(Mandatory)] [string] $Username,
    [Parameter(Mandatory)] [string] $Password,
    [string] $CountryCode = '971',
    [switch] $Enable,
    [switch] $NoValidate
)

$ErrorActionPreference = 'Stop'
$GatewayUrl = $GatewayUrl.TrimEnd('/')
if ($GatewayUrl -notmatch '^https?://') { $GatewayUrl = "http://$GatewayUrl" }  # ensure scheme
$envPath = 'C:\Users\Admin\sentinel\.env'

# --- Optional credential check ----------------------------------------------
if (-not $NoValidate) {
    Write-Host 'Validating gateway reachability ...' -ForegroundColor Cyan
    try {
        $bytes = [System.Text.Encoding]::ASCII.GetBytes("${Username}:${Password}")
        $encoded = [Convert]::ToBase64String($bytes)
        $null = Invoke-RestMethod -Method Get -Uri $GatewayUrl -Headers @{ Authorization = "Basic $encoded" }
        Write-Host '  OK - gateway reachable and credentials accepted.' -ForegroundColor Green
    } catch {
        $status = $null
        $resp = $_.Exception.Response
        if ($resp) { $status = [int]$resp.StatusCode }
        if ($status -eq 401) {
            Write-Host '  401 Unauthorized - gateway is reachable but username/password is wrong.' -ForegroundColor Red
        } elseif ($null -ne $status) {
            Write-Host ("  HTTP {0} - gateway is reachable but returned an unexpected status (credentials may still be valid)." -f $status) -ForegroundColor Yellow
        } else {
            $detail = $_.Exception.Message
            Write-Host ("  Connection FAILED: {0}" -f $detail) -ForegroundColor Red
            Write-Host '  Check that the phone is on Wi-Fi and SMS Gate is running.' -ForegroundColor Yellow
        }
        Write-Host '  Nothing was written. (Re-run with -NoValidate to write .env anyway.)' -ForegroundColor Yellow
        exit 1
    }
}

# --- Upsert the values into .env --------------------------------------------
$values = [ordered]@{
    'GSSG_SMS_GATEWAY_URL'  = $GatewayUrl
    'GSSG_SMS_USERNAME'     = $Username
    'GSSG_SMS_PASSWORD'     = $Password
    'GSSG_SMS_COUNTRY_CODE' = $CountryCode
}
if ($Enable) { $values['GSSG_SMS_ENABLED'] = 'true' }

$lines = @()
if (Test-Path $envPath) { $lines = @(Get-Content -Path $envPath) }

foreach ($key in $values.Keys) {
    $line = "{0}={1}" -f $key, $values[$key]
    $idx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match ("^\s*{0}\s*=" -f [regex]::Escape($key))) { $idx = $i; break }
    }
    if ($idx -ge 0) { $lines[$idx] = $line } else { $lines += $line }
}

# Write back as UTF-8 (no BOM) so pydantic-settings reads it cleanly.
[System.IO.File]::WriteAllLines($envPath, $lines, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ''
Write-Host ("Updated {0}:" -f $envPath) -ForegroundColor Green
if ($Enable) {
    Write-Host '  GSSG_SMS_ENABLED      = true'
}
Write-Host ("  GSSG_SMS_GATEWAY_URL  = {0}" -f $values['GSSG_SMS_GATEWAY_URL'])
Write-Host ("  GSSG_SMS_USERNAME     = {0}" -f $values['GSSG_SMS_USERNAME'])
Write-Host  "  GSSG_SMS_PASSWORD     = ******** (hidden)"
Write-Host ("  GSSG_SMS_COUNTRY_CODE = {0}" -f $values['GSSG_SMS_COUNTRY_CODE'])
Write-Host ''
if (-not $Enable) {
    Write-Host 'Note: GSSG_SMS_ENABLED not written. Re-run with -Enable once the phone is ready and tested.' -ForegroundColor Yellow
}
Write-Host 'Next: restart the service ->  mng restart' -ForegroundColor Cyan
