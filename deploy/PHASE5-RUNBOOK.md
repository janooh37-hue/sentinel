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


---

## Public exposure — https://gssg.app via Cloudflare Tunnel (LIVE 2026-08-11)

The app is publicly reachable at **https://gssg.app** (and `www.gssg.app`,
301-redirected to the apex by a Cloudflare Redirect Rule). Architecture:

```
staff anywhere ──HTTPS──> Cloudflare edge (TLS, DDoS, per-zone WAF)
                              │  outbound-only tunnel (no inbound ports)
                              ▼
                        cloudflared (this host)  ──>  uvicorn 127.0.0.1:8765
LAN devices ──HTTPS──> Caddy :443 (gssg.lan / gssgit.local, internal CA) ──┘
```

- **Tunnel**: name `gssg`, config in `deploy/cloudflared/config.yml`; runs as
  the NSSM service `Cloudflared` (`scripts/install-cloudflared-service.ps1`).
  Credentials JSON + `cert.pem` live in `C:\Users\Admin\.cloudflared\` — SECRET,
  never committed.
- **DNS**: zone hosted on Cloudflare (registrar stays GoDaddy). Apex + `www`
  are proxied CNAMEs to the tunnel. `.app` is HSTS-preloaded — HTTP never hits.
- **LAN fallback**: the Caddy path above is untouched; if the internet is down
  the office keeps working via `https://gssg.lan`. Word/WebDAV editing stays on
  the LAN URL (`GSSG_PUBLIC_BASE_URL=https://gssgit.local`) by design.
- **Proxy trust**: `backend/serve.py` pins `proxy_headers` +
  `forwarded_allow_ips=127.0.0.1` — both Caddy and cloudflared connect from
  loopback, so `request.client.host` is the real client IP (rate limiter) and
  the scheme is `https` (Secure cookies).

### Phase 6 gate status (as of go-live)

1. bcrypt truncation — resolved: explicit 72-byte cap in `core/security.py`.
2. Session cap / revoke-all — **still open**; 14-day sessions, accepted risk.
3. Register throttle — resolved: 5/min/IP limiter on `POST /auth/register`;
   admin pre-seed moot (production DB already has admin accounts).
4. XFF behind proxy — resolved (see proxy trust above).
5. Test auth bypass — unchanged; production app has no dependency overrides.

Identity gate (Cloudflare Access) was consciously deferred — the app's own
login + rate limiting is the only barrier. To add it later (~10 min, no server
changes): Zero Trust dashboard → Access → Applications → self-hosted app for
`gssg.app` with an email-OTP policy.