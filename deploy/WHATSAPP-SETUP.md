# WhatsApp Notifications Setup (via Infobip)

Employee WhatsApp notifications for leave approvals, duty resumptions, and
violations. Messages are text-only, bilingual (Arabic by default, English per
employee), and sent manually by an admin via the "Notify on WhatsApp" button on
each record. Delivery goes through **Infobip** (a WhatsApp Business provider),
which avoids Meta's direct developer-account onboarding.

---

## 1. Enable the feature (env vars)

Set these in the service environment or `C:\Users\Admin\sentinel\.env`:

| Variable | Purpose | Example |
|---|---|---|
| `GSSG_WHATSAPP_ENABLED` | Master on/off; button hidden until `true` | `true` |
| `GSSG_WHATSAPP_TOKEN` | **Infobip API key** (secret) | `a1b2c3...` |
| `GSSG_WHATSAPP_API_BASE` | **Infobip base URL** (no trailing slash) | `https://xxxxx.api.infobip.com` |
| `GSSG_WHATSAPP_SENDER` | Registered WhatsApp **sender number**, international format, digits only | `447860099299` |
| `GSSG_WHATSAPP_COUNTRY_CODE` | Default country code for normalizing employee phone numbers | `971` |

**Where to find these in the Infobip portal:**
- **API key + Base URL:** Infobip homepage → *Developers* / *API Keys* (the base URL is shown as `https://<your-subdomain>.api.infobip.com`).
- **Sender number:** *Channels and Numbers → WhatsApp → Senders*. On a free trial Infobip gives you a shared **test sender**; for production you register your own number.

**Example `.env` snippet:**
```
GSSG_WHATSAPP_ENABLED=true
GSSG_WHATSAPP_TOKEN=your-infobip-api-key
GSSG_WHATSAPP_API_BASE=https://xxxxx.api.infobip.com
GSSG_WHATSAPP_SENDER=447860099299
GSSG_WHATSAPP_COUNTRY_CODE=971
```

After editing `.env`, run `mng restart`.

---

## 2. Register the six templates (Infobip portal)

In the Infobip portal: **Channels and Numbers → WhatsApp → Templates → Create
template**. Create **six** templates (3 events × 2 languages). For each:

- **Category:** `Utility`
- **Name:** exactly as below (lowercase + underscores)
- **Language:** English or Arabic as indicated
- **Body:** paste the text exactly, keeping the `{{1}} {{2}} …` placeholders in order
- **Sample values:** use the examples given (Infobip requires a sample per placeholder for approval)

> The placeholder **order is the contract** — it must match what the app sends
> (`backend/app/services/whatsapp_templates.py`). Don't reorder or renumber.

### leave_approved_en — English
```
Dear {{1}},
Your {{2}} leave has been approved.
Start: {{3}} ({{4}})
End: {{5}} ({{6}})
Duration: {{7}} day(s).
Al Wathba Rehabilitation Centre
```
Samples: `John Smith`, `Annual`, `05/07/2026`, `Sunday`, `09/07/2026`, `Thursday`, `5`

### leave_approved_ar — Arabic
```
عزيزي {{1}}،
تمت الموافقة على إجازتك ({{2}}).
تاريخ البداية: {{3}} ({{4}})
تاريخ النهاية: {{5}} ({{6}})
المدة: {{7}} يوم.
إدارة مركز الإصلاح والتأهيل بالوثبة
```
Samples: `جون سميث`, `سنوية`, `05/07/2026`, `الأحد`, `09/07/2026`, `الخميس`, `5`

### duty_resumption_en — English
```
Dear {{1}},
Your return to duty on {{2}} ({{3}}) has been recorded.
Welcome back.
Al Wathba Rehabilitation Centre
```
Samples: `John Smith`, `10/07/2026`, `Friday`

### duty_resumption_ar — Arabic
```
عزيزي {{1}}،
تم تسجيل مباشرتك للعمل بتاريخ {{2}} ({{3}}).
أهلاً بعودتك.
إدارة مركز الإصلاح والتأهيل بالوثبة
```
Samples: `جون سميث`, `10/07/2026`, `الجمعة`

### violation_en — English
```
Dear {{1}},
A {{2}} has been recorded on {{3}} ({{4}}).
Action: {{5}}.
Please contact HR for any clarification.
Al Wathba Rehabilitation Centre
```
Samples: `John Smith`, `Sleeping on Duty`, `01/07/2026`, `Wednesday`, `2 day(s) deduction`

### violation_ar — Arabic
```
عزيزي {{1}}،
تم تسجيل {{2}} بتاريخ {{3}} ({{4}}).
الإجراء: {{5}}.
يرجى مراجعة الموارد البشرية لأي استفسار.
إدارة مركز الإصلاح والتأهيل بالوثبة
```
Samples: `جون سميث`, `النوم أثناء الخدمة`, `01/07/2026`, `الأربعاء`, `خصم 2 يوم`

Templates are submitted to WhatsApp and enter **PENDING**, then **APPROVED**
(usually minutes to a few hours for Utility). Check status with the helper:

```
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\whatsapp-templates-status.ps1 `
  -BaseUrl https://xxxxx.api.infobip.com -ApiKey YOUR_KEY -Sender 447860099299
```

It prints each template's status and tells you when all six are APPROVED.

---

## 3. Test it end-to-end

1. In the Infobip portal, add **your own mobile** as a test recipient (trial
   senders can only message verified test numbers).
2. Make sure that mobile is in a test employee's **contact** field.
3. With `.env` set and `mng restart` done, approve that employee's leave and
   click **Notify on WhatsApp** → you should receive the message.

---

## Notes

- **Languages:** each message uses the employee's `msg_language` (Arabic by
  default; change per employee in the edit form). The app sends Infobip the
  language code `ar` or `en`, which must match the registered template language.
- **Text-only:** no attachments.
- **Permissions:** sending requires the `employees.notify` capability.
- **Audit:** every attempt (success or failure) is logged in `whatsapp_messages`;
  the record shows `Sent ✓ <date>` or `Failed – <reason>`.
- **Provider isolation:** all Infobip-specific HTTP lives in
  `backend/app/services/whatsapp_client.py`. Switching providers again means
  editing only that one file.

## Troubleshooting

- **Button not showing:** `GSSG_WHATSAPP_ENABLED=true` and the service restarted.
- **"No valid phone number":** the employee's contact field is empty/unparseable.
- **Template/parameter errors from Infobip:** the template isn't APPROVED, the
  name/language doesn't match, or the placeholder count differs from what the
  app sends. Re-check against section 2.
- **Connectivity:** the server needs outbound HTTPS to your Infobip base URL.
  Test: `Test-NetConnection -ComputerName xxxxx.api.infobip.com -Port 443`.
