<#
.SYNOPSIS
    Write the Infobip WhatsApp credentials into the project .env and (optionally)
    validate them against Infobip before you restart the service.

.DESCRIPTION
    Upserts the GSSG_WHATSAPP_* lines in C:\Users\Admin\sentinel\.env:
      GSSG_WHATSAPP_TOKEN     = Infobip API key
      GSSG_WHATSAPP_API_BASE  = Infobip base URL
      GSSG_WHATSAPP_SENDER    = registered WhatsApp sender number
      GSSG_WHATSAPP_ENABLED   = true only if -Enable is passed (default false)
    Existing lines are replaced in place; missing ones are appended. Other .env
    content is left untouched. The API key is never printed.

    Unless -NoValidate is given, it first calls Infobip
    (GET {BaseUrl}/whatsapp/2/senders/{Sender}/templates) to confirm the key,
    base URL, and sender actually work — so you find out now, not after a restart.

.PARAMETER ApiKey
    Your Infobip API key.

.PARAMETER BaseUrl
    Your Infobip base URL, e.g. https://xxxxx.api.infobip.com

.PARAMETER Sender
    Your registered WhatsApp sender number (international format, digits only).

.PARAMETER Enable
    Also set GSSG_WHATSAPP_ENABLED=true. Use this only once your six templates
    are APPROVED in Infobip.

.PARAMETER NoValidate
    Skip the Infobip connectivity/credential check.

.EXAMPLE
    ./configure-whatsapp.ps1 -ApiKey xxxx -BaseUrl https://abc.api.infobip.com -Sender 447860099299

.EXAMPLE
    ./configure-whatsapp.ps1 -ApiKey xxxx -BaseUrl https://abc.api.infobip.com -Sender 447860099299 -Enable
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $ApiKey,
    [Parameter(Mandatory)] [string] $BaseUrl,
    [Parameter(Mandatory)] [string] $Sender,
    [switch] $Enable,
    [switch] $NoValidate
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
if ($BaseUrl -notmatch '^https?://') { $BaseUrl = "https://$BaseUrl" }  # ensure scheme
$Sender = $Sender.TrimStart('+')   # Infobip wants digits (also in the URL path)
$envPath = 'C:\Users\Admin\sentinel\.env'

# --- Optional credential check ----------------------------------------------
if (-not $NoValidate) {
    $uri = "{0}/whatsapp/2/senders/{1}/templates" -f $BaseUrl, $Sender
    Write-Host 'Validating credentials against Infobip ...' -ForegroundColor Cyan
    try {
        $null = Invoke-RestMethod -Method Get -Uri $uri -Headers @{ Authorization = "App $ApiKey" }
        Write-Host '  OK - key, base URL, and sender accepted.' -ForegroundColor Green
    } catch {
        $detail = $_.ErrorDetails.Message
        if (-not $detail) { $detail = $_.Exception.Message }
        Write-Host ("  Validation FAILED: {0}" -f $detail) -ForegroundColor Red
        # A 3xx redirect means the base URL is wrong (usually the generic host).
        # The Location header reveals your real account-specific base URL.
        $loc = $null
        $resp = $_.Exception.Response
        if ($resp -and $resp.Headers) { try { $loc = $resp.Headers['Location'] } catch {} }
        if ($loc) {
            try { $correct = ([Uri]$loc).GetLeftPart([System.UriPartial]::Authority) }
            catch { $correct = $loc }
            Write-Host ("  Infobip redirected to: {0}" -f $loc) -ForegroundColor Cyan
            Write-Host ("  --> Use this as -BaseUrl: {0}" -f $correct) -ForegroundColor Green
        } else {
            Write-Host '  A redirect usually means -BaseUrl is the generic host. Use your' -ForegroundColor Yellow
            Write-Host '  account-specific URL from the Infobip portal (https://<subdomain>.api.infobip.com).' -ForegroundColor Yellow
        }
        Write-Host '  Nothing was written. (Re-run with -NoValidate to write .env anyway.)' -ForegroundColor Yellow
        exit 1
    }
}

# --- Upsert the values into .env --------------------------------------------
$values = [ordered]@{
    'GSSG_WHATSAPP_ENABLED'  = $(if ($Enable) { 'true' } else { 'false' })
    'GSSG_WHATSAPP_TOKEN'    = $ApiKey
    'GSSG_WHATSAPP_API_BASE' = $BaseUrl
    'GSSG_WHATSAPP_SENDER'   = $Sender
}

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
Write-Host ("  GSSG_WHATSAPP_ENABLED  = {0}" -f $values['GSSG_WHATSAPP_ENABLED'])
Write-Host  "  GSSG_WHATSAPP_TOKEN    = ******** (hidden)"
Write-Host ("  GSSG_WHATSAPP_API_BASE = {0}" -f $values['GSSG_WHATSAPP_API_BASE'])
Write-Host ("  GSSG_WHATSAPP_SENDER   = {0}" -f $values['GSSG_WHATSAPP_SENDER'])
Write-Host ''
if (-not $Enable) {
    Write-Host 'Note: GSSG_WHATSAPP_ENABLED=false. Re-run with -Enable once your six templates are APPROVED.' -ForegroundColor Yellow
}
Write-Host 'Next: restart the service ->  mng restart' -ForegroundColor Cyan
