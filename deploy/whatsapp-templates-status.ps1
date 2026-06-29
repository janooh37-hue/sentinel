<#
.SYNOPSIS
    List the WhatsApp templates (and approval status) for an Infobip sender.

.DESCRIPTION
    GET {BaseUrl}/whatsapp/2/senders/{Sender}/templates with the Infobip
    "App {ApiKey}" auth header. Prints each template's name / language / status
    / category so you can confirm the six GSSG templates are APPROVED before
    flipping GSSG_WHATSAPP_ENABLED=true. Read-only — it does not create anything
    (create templates in the Infobip web portal; see deploy/WHATSAPP-SETUP.md).

.PARAMETER BaseUrl
    Your Infobip base URL, e.g. https://xxxxx.api.infobip.com (no trailing slash).

.PARAMETER ApiKey
    Your Infobip API key.

.PARAMETER Sender
    Your registered WhatsApp sender number, international format, digits only
    (e.g. 447860099299).

.EXAMPLE
    ./whatsapp-templates-status.ps1 -BaseUrl https://abc.api.infobip.com -ApiKey xxxx -Sender 447860099299
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $BaseUrl,
    [Parameter(Mandatory)] [string] $ApiKey,
    [Parameter(Mandatory)] [string] $Sender
)

$ErrorActionPreference = 'Stop'
$uri = "{0}/whatsapp/2/senders/{1}/templates" -f $BaseUrl.TrimEnd('/'), $Sender
$headers = @{ Authorization = "App $ApiKey" }

$WANT = @(
    'leave_approved_en', 'leave_approved_ar',
    'duty_resumption_en', 'duty_resumption_ar',
    'violation_en', 'violation_ar'
)

try {
    $resp = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
} catch {
    $detail = $_.ErrorDetails.Message
    if (-not $detail) { $detail = $_.Exception.Message }
    Write-Host ("Request failed: {0}" -f $detail) -ForegroundColor Red
    exit 1
}

$templates = @($resp.templates)
if (-not $templates) {
    Write-Host 'No templates found for this sender.' -ForegroundColor Yellow
    exit 0
}

$templates | Sort-Object name, language |
    Format-Table name, language, status, category -AutoSize

# Highlight which of the six GSSG templates are still missing or not approved.
$approved = @{}
foreach ($t in $templates) {
    if ($t.status -eq 'APPROVED') { $approved["$($t.name)|$($t.language)"] = $true }
}
$missing = @()
foreach ($n in $WANT) {
    $base = $n -replace '_(en|ar)$', ''
    $lang = $n.Substring($n.Length - 2)
    if (-not $approved["$base|$lang"]) { $missing += $n }
}
if ($missing.Count -eq 0) {
    Write-Host 'All six GSSG templates are APPROVED — ready to enable.' -ForegroundColor Green
} else {
    Write-Host ("Not yet APPROVED / missing: {0}" -f ($missing -join ', ')) -ForegroundColor Yellow
}
