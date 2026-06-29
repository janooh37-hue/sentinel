# WhatsApp Notifications Setup

Enable employee notifications via WhatsApp Business Cloud API for key HR events:
leave approvals, duty resumptions, and disciplinary violations. Messages are
text-only, bilingual (Arabic by default, English for opted-in employees), and
manually triggered by an admin "Send to employee" button on each record.

---

## Enable the feature

Set the following environment variables in the service startup or `.env`:

| Variable | Purpose | Default | Example |
|---|---|---|---|
| `GSSG_WHATSAPP_ENABLED` | Master on/off; button is hidden until `true` | `false` | `true` |
| `GSSG_WHATSAPP_TOKEN` | Meta permanent access token (secret) | empty | `EAABs… (100+ chars)` |
| `GSSG_WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business phone-number id from Meta | empty | `120201234567890` |
| `GSSG_WHATSAPP_API_BASE` | Meta Graph API base URL | `https://graph.facebook.com/v21.0` | (use default) |
| `GSSG_WHATSAPP_COUNTRY_CODE` | Default country code for normalizing phone numbers | `971` | (UAE: `971`, edit if different) |

**Example `.env` snippet:**
```
GSSG_WHATSAPP_ENABLED=true
GSSG_WHATSAPP_TOKEN=EAABs1234567890abcdef…
GSSG_WHATSAPP_PHONE_NUMBER_ID=120201234567890
GSSG_WHATSAPP_COUNTRY_CODE=971
```

---

## One-time Meta setup (outside the app)

1. **Create a Meta Business Account** and complete business verification.
   - Go to [business.facebook.com](https://business.facebook.com).

2. **Obtain a dedicated WhatsApp Business phone number** (not an existing personal WhatsApp).
   - This number will be used as the sender identity.

3. **Register and approve the six message templates** in WhatsApp Manager:
   - All templates are in the **Utility** category.
   - Register these six (3 event types × 2 languages):
     - `leave_approved_en` / `leave_approved_ar` — leave approval notifications
     - `duty_resumption_en` / `duty_resumption_ar` — return-to-duty notifications
     - `violation_en` / `violation_ar` — disciplinary record notifications
   - Each template must be approved by Meta before live sends succeed.
   - The template body and variable order are fixed; do not edit the template
     copy once approved.

4. **Provision the credentials into the app:**
   - Extract the `GSSG_WHATSAPP_TOKEN` from Meta's App → Tokens.
   - Extract the `GSSG_WHATSAPP_PHONE_NUMBER_ID` from WhatsApp Manager →
     Phone Numbers.
   - Set both in the service environment or `.env`.

5. **Restart the service** and confirm:
   - Any employee record with an approved leave/return/violation now shows a
     "Send to employee" button.
   - The button is only visible if the employee has a phone number in their
     contact field.

---

## Message details

- **Languages:** Messages respect the employee's `msg_language` setting (Arabic
  by default; change in the employee edit form for English speakers).
- **Text-only:** No attachments; file upload capability is designed for but not
  implemented.
- **Permissions:** Sending requires the `employees.notify` capability in the
  role-based permission system.
- **Audit:** Every send attempt (success or failure) logs a row in the
  `whatsapp_messages` table; the record view shows `Sent ✓ <date>` or
  `Failed – <reason>`.

---

## Troubleshooting

- **Button not showing:** Ensure `GSSG_WHATSAPP_ENABLED=true` and the service
  has restarted.
- **"No valid phone number" error:** The employee's contact field is empty,
  unparseable, or not in E.164 format. Verify the number starts with `+971` or
  another valid country code.
- **"Message rejected by API":** The template is not approved in Meta's
  WhatsApp Manager, or the variable order in the template does not match the
  app's registration. Check Meta's queue for approvals.
- **Send hangs or times out:** Outbound HTTPS must be open from the server to
  `https://graph.facebook.com`. Test:
  ```powershell
  Test-NetConnection -ComputerName graph.facebook.com -Port 443
  ```
