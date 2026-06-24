# Phase 5 — PWA + Web Push + HTTPS Runbook

## Why HTTPS is mandatory

Service workers and Web Push **require a secure context** (HTTPS or localhost).
Opening the app on a phone via `http://<lan-ip>/` will:
- **Not** register the service worker → no push delivery.
- **Not** allow "Add to Home Screen" to create a proper PWA install (on iOS 16.4+).

You MUST set up a TLS terminator (Caddy, below) before push works on any phone.

---

## Cert strategy options

### (A) Real domain + automatic ACME (recommended)

1. Register a hostname (e.g. `gssg.company.ae`) and point an A-record to the
   LAN server's IP address.
2. Open port 80 (for the ACME HTTP-01 challenge) and port 443 on the firewall.
3. In `deploy/Caddyfile` uncomment the `gssg.company.ae { ... }` block.
4. Run `caddy run --config deploy/Caddyfile`.
5. Caddy fetches a free Let's Encrypt cert automatically; renewal is automatic.
6. **Phones trust it out of the box** — no manual cert install needed.

### (B) Internal CA / `tls internal` (no public domain needed)

1. Either use `tls internal` (Caddy generates its own CA) or provide a cert
   from your organisation's internal CA:
   - `tls /path/to/gssg.crt /path/to/gssg.key`
2. **Every phone must install and trust the CA cert** before HTTPS works.
   - Android: Settings → Security → Install a certificate → CA certificate.
   - iOS: AirDrop the `.crt`, then Settings → General → VPN & Device Management
     → trust the profile, then Settings → General → About → Certificate Trust
     Settings → enable full trust.
3. Tradeoff: no public domain needed, but phone setup is a manual step per device.

---

## Configuring uvicorn + the Secure cookie

When Caddy is in front, uvicorn should **bind to loopback only** so the raw
port is not directly reachable on the LAN:

```powershell
# scripts/dev.ps1 — change -Host to 127.0.0.1 when using Caddy
# (or set GSSG_HOST=127.0.0.1 in the service environment)
```

Set `GSSG_SECURE_COOKIES=1` in the service environment so login/logout cookies
carry the `Secure` flag (required by iOS when the page is served over HTTPS):

```powershell
$env:GSSG_SECURE_COOKIES = "1"
venv\Scripts\python.exe backend\main.py
```

Or add it to the Windows service / Task Scheduler action that starts the app.

---

## Firewall

- Open **443** (HTTPS) to the LAN subnet; block it from the internet.
- Open **80** only if using ACME strategy (A); block it after cert is obtained.
- Block the raw uvicorn port (default 8765) from reaching external interfaces.

---

## Security ACLs — protect the off-DB secret keys

The VAPID private key (`data/.vapid_key`) and the email encryption key
(`data/.email_key`) live on disk. Run the helper script once after first boot
to restrict access to the service account only:

```powershell
# Run as the account that runs GSSG Manager (Administrator or the service account)
.\scripts\secure_key_acls.ps1
```

This removes inherited ACEs and grants only the current user Full control
(`icacls`). See `scripts/secure_key_acls.ps1` for the exact commands.

Both key files are created lazily on first use; run the script after the
first successful login (which creates `.email_key`) and after the first push
subscribe (which creates `.vapid_key`).

---

## Before external exposure — Phase 6 hardening gates

Do NOT expose the app to the internet until these are addressed:

1. **bcrypt 72-byte truncation** — `core/security.py:18-23` uses raw bcrypt,
   which silently truncates passwords > 72 bytes. Prehash with sha256 + rehash
   on login, or reject passwords > 72 bytes.

2. **Sign out everywhere / session cap** — sessions last 14 days with no cap.
   Add an admin "revoke all sessions" endpoint; consider a shorter idle timeout.

3. **`/auth/register` throttle + admin pre-seed** — registration is unthrottled
   and the first account auto-becomes admin. Pre-seed the admin and throttle or
   gate registration before external exposure.

4. **Rate-limit behind a proxy** — the per-IP limiter keys on
   `request.client.host`. When behind Caddy, XFF carries the real IP; trust XFF
   ONLY behind the Caddy proxy you control (not set up yet — Phase 6).

5. **Test auth bypass** — `tests/conftest.py:55-64` overrides `get_optional_user`
   at import time. This only runs when the test suite is loaded; the production
   app has no `dependency_overrides`. Re-confirm this if you ever import the test
   conftest in a non-test path.

---

## Manual verification checklist

Run these on the actual server + a real phone on the LAN, then record results
in `docs/prototypes/lan-phase5-verify/NOTES.md`.

1. **TLS up** — `https://<server>/` loads with a valid lock in desktop Chrome.
   `GSSG_SECURE_COOKIES=1` is set; login `Set-Cookie` shows `Secure` in DevTools
   (Application → Cookies).

2. **Cert trust on phone** — (strategy B only) the CA cert is installed and fully
   trusted; no TLS warning at `https://<server>/`.

3. **PWA install** — on the phone, open `https://<server>/`, use "Add to Home
   Screen". Launch from the home-screen icon → opens standalone (no browser
   chrome), correct icon + app name.

4. **Push permission** — in the installed app, trigger the subscribe flow
   (Notification.requestPermission prompt → Allow). Confirm a `push_subscriptions`
   row exists:
   ```
   venv\Scripts\python.exe -c "
   from app.db.session import SessionLocal; from app.db.models import PushSubscription
   from sqlalchemy import select, text
   with SessionLocal() as db:
       rows = db.execute(text('SELECT user_id, substr(endpoint,1,40) FROM push_subscriptions')).all()
       print(rows)
   "
   ```

5. **Real push delivery** — from the server:
   ```
   venv\Scripts\python.exe -X utf8 -c "
   from app.db.session import SessionLocal
   from app.services import push_service
   with SessionLocal() as db:
       push_service.send_to_user(db, <uid>, 'Test', 'Hello from GSSG', '/books')
   "
   ```
   The phone shows the OS notification **with the app closed**; tapping it opens
   the app at `/books`.

6. **iOS caveat** — Web Push on iOS only works after Add-to-Home-Screen (iOS 16.4+).
   Document the iOS version tested.

7. **410 prune** — unsubscribe in the browser (or let an endpoint expire), send
   again → the dead row is pruned, no crash.

8. **Dedupe** — create a new awaiting-approval for the user → exactly one push
   within ~1 min; no repeat push on the next scheduler tick.

9. **Key ACLs** — after running `secure_key_acls.ps1`:
   - `icacls data\.vapid_key` shows only the service account.
   - `git ls-files | findstr vapid_key` → empty (not committed).
