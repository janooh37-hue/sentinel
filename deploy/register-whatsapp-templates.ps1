<#
.SYNOPSIS
    Register the six GSSG WhatsApp message templates with Meta's Graph API.

.DESCRIPTION
    Creates (POST .../message_templates) the six UTILITY templates the app sends:
      leave_approved_en / _ar, duty_resumption_en / _ar, violation_en / _ar
    The body text, the {{1}}..{{n}} variable ORDER, and the signature line match
    exactly what backend/app/services/whatsapp_templates.py produces. Do not edit
    the bodies here without changing the code (and vice-versa) — the order is the
    contract.

    Templates must be APPROVED by Meta before live sends succeed. This script
    only submits them (they enter PENDING). Check status in WhatsApp Manager or
    via GET .../message_templates.

.PARAMETER WabaId
    Your WhatsApp Business Account ID (NOT the phone-number-id, NOT the app id).

.PARAMETER Token
    An access token with the `whatsapp_business_management` permission.

.PARAMETER Version
    Graph API version. Defaults to v21.0 (matches GSSG_WHATSAPP_API_BASE).

.EXAMPLE
    ./register-whatsapp-templates.ps1 -WabaId 1234567890 -Token EAAB...
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $WabaId,
    [Parameter(Mandatory)] [string] $Token,
    [string] $Version = 'v21.0'
)

$ErrorActionPreference = 'Stop'
$uri = "https://graph.facebook.com/$Version/$WabaId/message_templates"

# Each entry: name, language, body text, and one example value-set (one string
# per {{n}} variable, in order). Example values are required by Meta for any
# template that contains variables.
$templates = @(
    @{
        name = 'leave_approved_en'; language = 'en'
        body = "Dear {{1}},`nYour {{2}} leave has been approved.`nStart: {{3}} ({{4}})`nEnd: {{5}} ({{6}})`nDuration: {{7}} day(s).`nAl Wathba Rehabilitation Centre"
        example = @('John Smith', 'Annual', '05/07/2026', 'Sunday', '09/07/2026', 'Thursday', '5')
    },
    @{
        name = 'leave_approved_ar'; language = 'ar'
        body = "عزيزي {{1}}،`nتمت الموافقة على إجازتك ({{2}}).`nتاريخ البداية: {{3}} ({{4}})`nتاريخ النهاية: {{5}} ({{6}})`nالمدة: {{7}} يوم.`nإدارة مركز الإصلاح والتأهيل بالوثبة"
        example = @('جون سميث', 'سنوية', '05/07/2026', 'الأحد', '09/07/2026', 'الخميس', '5')
    },
    @{
        name = 'duty_resumption_en'; language = 'en'
        body = "Dear {{1}},`nYour return to duty on {{2}} ({{3}}) has been recorded.`nWelcome back.`nAl Wathba Rehabilitation Centre"
        example = @('John Smith', '10/07/2026', 'Friday')
    },
    @{
        name = 'duty_resumption_ar'; language = 'ar'
        body = "عزيزي {{1}}،`nتم تسجيل مباشرتك للعمل بتاريخ {{2}} ({{3}}).`nأهلاً بعودتك.`nإدارة مركز الإصلاح والتأهيل بالوثبة"
        example = @('جون سميث', '10/07/2026', 'الجمعة')
    },
    @{
        name = 'violation_en'; language = 'en'
        body = "Dear {{1}},`nA {{2}} has been recorded on {{3}} ({{4}}).`nAction: {{5}}.`nPlease contact HR for any clarification.`nAl Wathba Rehabilitation Centre"
        example = @('John Smith', 'Sleeping on Duty', '01/07/2026', 'Wednesday', '2 day(s) deduction')
    },
    @{
        name = 'violation_ar'; language = 'ar'
        body = "عزيزي {{1}}،`nتم تسجيل {{2}} بتاريخ {{3}} ({{4}}).`nالإجراء: {{5}}.`nيرجى مراجعة الموارد البشرية لأي استفسار.`nإدارة مركز الإصلاح والتأهيل بالوثبة"
        example = @('جون سميث', 'النوم أثناء الخدمة', '01/07/2026', 'الأربعاء', 'خصم 2 يوم')
    }
)

$headers = @{ Authorization = "Bearer $Token" }
$ok = 0; $fail = 0

foreach ($t in $templates) {
    $payload = @{
        name             = $t.name
        language         = $t.language
        category         = 'UTILITY'
        parameter_format = 'POSITIONAL'
        # Let Meta correct the category instead of hard-rejecting on a mismatch.
        allow_category_change = $true
        components       = @(
            @{
                type    = 'BODY'
                text    = $t.body
                example = @{ body_text = @(, $t.example) }  # [[...]] — array of one value-set
            }
        )
    }
    $json = $payload | ConvertTo-Json -Depth 10
    Write-Host ("-> {0} ({1}) ..." -f $t.name, $t.language) -ForegroundColor Cyan
    try {
        $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers `
            -ContentType 'application/json; charset=utf-8' -Body $json
        Write-Host ("   created: id={0} status={1}" -f $resp.id, $resp.status) -ForegroundColor Green
        $ok++
    } catch {
        $detail = $_.ErrorDetails.Message
        if (-not $detail) { $detail = $_.Exception.Message }
        Write-Host ("   FAILED: {0}" -f $detail) -ForegroundColor Red
        $fail++
    }
}

Write-Host ''
Write-Host ("Done. {0} submitted, {1} failed. Templates enter PENDING — check approval in WhatsApp Manager." -f $ok, $fail) `
    -ForegroundColor $(if ($fail) { 'Yellow' } else { 'Green' })
