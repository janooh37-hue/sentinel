# SMS Notifications Setup (on-site Android SIM gateway)

Employee SMS notifications for leave approvals, duty resumptions, and
violations. Messages are text-only, bilingual (Arabic default, English per
employee), sent manually by an admin via the "Notify by SMS" button on each
record. Delivery goes through an **Android phone on the LAN running SMS Gate**
(local mode), which sends the SMS from its own SIM — no carrier sender
registration and no trade license required.

## 1. Prepare the Android phone

1. Install **SMS Gate** (sms-gate.app) on the company Android phone.
2. Enable the **Local Server** and set a **username + password**.
3. Note the phone's **LAN IP** and give it a **static IP** (or a DHCP
   reservation on the router) so the address never changes.
4. Grant the app the **send SMS** permission and **disable battery
   optimization** for it so it keeps running.
5. Ensure the SIM has SMS balance/allowance.
6. Keep the phone **on the office Wi-Fi and charging**.

Quick check from the server (replace IP/creds):

    curl -X POST -u USER:PASS -H "Content-Type: application/json" \
      -d '{"textMessage":{"text":"test"},"phoneNumbers":["+9715XXXXXXXX"]}' \
      http://192.168.1.50:8080/message

## 2. Configure the app (env vars)

Set these in `C:\Users\Admin\sentinel\.env`:

| Variable | Purpose | Example |
|---|---|---|
| `GSSG_SMS_ENABLED` | Master on/off; button hidden until `true` | `true` |
| `GSSG_SMS_GATEWAY_URL` | SMS Gate local-server base URL | `http://192.168.1.50:8080` |
| `GSSG_SMS_USERNAME` | Local-server Basic auth user | `gssg` |
| `GSSG_SMS_PASSWORD` | Local-server Basic auth password | `secret` |
| `GSSG_SMS_COUNTRY_CODE` | Default CC for normalizing employee phones | `971` |

Or run `deploy\configure-sms.ps1` (below) to validate + write these.
After editing `.env`, run `mng restart`.

## 3. Test end-to-end

1. Put a test employee's mobile in their **contact** field.
2. With `.env` set + `mng restart` done, approve that employee's leave and
   click **Notify by SMS** → the phone sends the SMS and the badge shows
   `Sent ✓`.

## Notes

- The sender appears as the **SIM's phone number** (no branded sender).
- Consumer-SIM **fair-use** applies — low-volume manual notifications only.
- Each Arabic message is ~3–4 SMS segments (UCS-2 encoding).
- All gateway-specific HTTP lives in `backend/app/services/sms_client.py`.

## Troubleshooting

- **Button not showing:** `GSSG_SMS_ENABLED=true` and service restarted; the
  user has the `employees.notify` capability.
- **"No valid phone number":** the employee's contact field is empty/unparseable.
- **Connection errors:** the phone is off Wi-Fi / asleep / IP changed, or
  battery optimization killed SMS Gate. Verify with the curl check above.
- **401:** username/password mismatch with the SMS Gate local server.
