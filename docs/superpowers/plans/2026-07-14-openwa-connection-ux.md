# OpenWA Connection UX (inline on Send-to-Group) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface the WhatsApp-gateway connection state directly on the Send-to-Group page, distinguish a real error from an empty group list, and let an admin (re)connect by scanning a QR in-app — closing the "no connection UX" gap.

**Architecture:** Everything lives on the existing `/messages/broadcast` page (user chose inline, no Settings card). Two new backend proxy endpoints on the announcements router expose a **4-state** gateway status and the gateway's QR (the browser can't reach the localhost Docker gateway). The page polls status, splits `isError`/`empty`, shows a group-specific blocked banner (no SMS-fallback claim), and — for `settings.edit` admins only — a Connect/Re-scan dialog that rotates the QR and polls until connected, then invalidates the group list.

**Tech Stack:** FastAPI, httpx (+ `httpx.MockTransport` in tests), React 19 + React Query, Radix + Tailwind, lucide-react icons. Generated `api.types.ts` via `pnpm gen:api`.

## Global Constraints (from Fable's consult + project rules)

- **QR is a hijack primitive** — the QR endpoint + the in-app QR dialog/button MUST be gated on `settings.edit` (admin), NOT `messages.broadcast`. A non-admin broadcast user sees status + "ask your administrator", never the QR.
- **4-state status enum:** `disabled` (not `openwa_enabled`) | `unreachable` (enabled but gateway HTTP fails — Docker down; Re-scan won't help) | `disconnected` (gateway reachable, session not linked — Re-scan fixes it) | `connected`. Do NOT collapse `unreachable` and `disconnected`.
- **No SMS-fallback copy on the send page** — group messages have NO SMS fallback. The blocked banner says group sends can't go out until reconnected. (The "falls back to SMS" line is only true for individual notifications and does not belong here.)
- **error ≠ empty:** a status query error / not-connected → amber blocked banner; a *connected* gateway returning `[]` groups → neutral "this number is in no groups" copy. Two distinct states, two messages.
- **QR rotates (~20–60s):** the dialog re-fetches the QR on an interval AND polls status (~3s) to flip to connected; on connect, invalidate the `announce-groups` query so the list fills behind the dialog. Polling happens ONLY while the dialog is open; the page-level status uses fetch-on-mount + manual refresh (staleTime ~30s). No background polling.
- **lucide icons, not emoji.** Bilingual parity mandatory (en/ar identical keys; translated error/status strings; no English leaking into Arabic); logical CSS + `dir="auto"` on free-text. After UI/locale changes run `i18n-rtl-reviewer`.
- Type resync required after backend route/schema changes: `dump_openapi.py` → `pnpm gen:api` → `tsc`; commit `api.types.ts` only (`openapi.json` gitignored).
- Strict gates: ruff + format; mypy (no NEW errors vs 47 baseline); pytest (`filterwarnings=error`); vitest; tsc. Run Python via `venv\Scripts\...`. This checkout is live; ships behind the existing `openwa_enabled` gate.

## Verified facts

- `openwa_client.health() -> bool` (`backend/app/services/openwa_client.py`) GETs `{base}/api/sessions/{session}` and returns True iff status ∈ {CONNECTED, READY, WORKING} — collapses unreachable+disconnected into False. `_base()`, `_headers()`, `_client()` (httpx, `_transport` overridable in tests), `get_settings().openwa_enabled/openwa_session`. Gateway QR: `GET /api/sessions/{session}/qr` → base64 image (per `deploy/openwa/README.md`).
- Announcements router `backend/app/api/v1/announcements.py` (prefix `/announcements`, mounted under `/api/v1` with `auth_gate`); `require_capability` from `app.api.deps`; `get_db` from `app.db.session`. `announce_service.groups_available(db)` returns `[]` when disabled.
- Frontend page `frontend/src/pages/announcements/SendToGroupPage.tsx`: `useQuery(['announce-groups'], api.listGroups)`; empty state currently `!groups || groups.length === 0` (the bug — error and empty share it). api.ts: `request<T>('METHOD','/path')`; `useCapabilities().has(cap)`; Radix `Dialog` used elsewhere (mirror an existing dialog). Latest migration `0053` (no migration needed here — no schema change).

---

### Task 1: `openwa_client.session_state()` (4-state) + `fetch_qr()`

**Files:**
- Modify: `backend/app/services/openwa_client.py`
- Test: `backend/tests/test_openwa_client_state.py`

**Interfaces:**
- `session_state() -> str` — returns one of `"disabled" | "unreachable" | "disconnected" | "connected"`. `disabled` when not `get_settings().openwa_enabled` (no HTTP call). Else GET the session endpoint: transport error or non-2xx → `"unreachable"`; 2xx with status ∈ {CONNECTED, READY, WORKING} (case-insensitive) → `"connected"`; 2xx otherwise → `"disconnected"`. Never raises.
- `fetch_qr() -> str | None` — GET `{base}/api/sessions/{session}/qr`; return the base64/data-url string the gateway provides (parse `data.get("qr") or data.get("data") or resp.text`), or `None` on any error/non-2xx. Never raises.
- Keep `health()` as-is (still used by the scheduler health ping).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_openwa_client_state.py
import httpx
from app.services import openwa_client as wa


def teardown_function():
    wa._transport = None


def _cfg(monkeypatch, enabled=True):
    monkeypatch.setattr(wa, "get_settings", lambda: __import__("types").SimpleNamespace(
        openwa_enabled=enabled, openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"))


def test_state_disabled(monkeypatch):
    _cfg(monkeypatch, enabled=False)
    assert wa.session_state() == "disabled"


def test_state_unreachable_on_error(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(500, text="down"))
    assert wa.session_state() == "unreachable"


def test_state_disconnected(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"status": "UNPAIRED"}))
    assert wa.session_state() == "disconnected"


def test_state_connected(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"status": "CONNECTED"}))
    assert wa.session_state() == "connected"


def test_fetch_qr_returns_string(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"qr": "data:image/png;base64,AAAA"}))
    assert wa.fetch_qr() == "data:image/png;base64,AAAA"


def test_fetch_qr_none_on_error(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(500, text="x"))
    assert wa.fetch_qr() is None
```

- [ ] **Step 2: Run to verify failure** — `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client_state.py -v` → FAIL.

- [ ] **Step 3: Implement** `session_state()` + `fetch_qr()` per the interface (reuse `_base`/`_headers`/`_client`; wrap in try/except → the safe fallbacks). Do not alter `health`.

- [ ] **Step 4: Run to verify pass** + the existing openwa suite: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client_state.py backend/tests/test_openwa_client.py backend/tests/test_openwa_client_groups.py -v` → all pass.

- [ ] **Step 5: Ruff + commit**
```bash
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client_state.py
git commit -m "feat(openwa): 4-state session_state() + fetch_qr() transport"
```

---

### Task 2: Status + QR API endpoints + resync

**Files:**
- Modify: `backend/app/schemas/announcement.py` (add `GatewayStatusOut`, `GatewayQrOut`)
- Modify: `backend/app/api/v1/announcements.py` (2 routes)
- Modify: `backend/openapi.json` (regenerated, NOT committed), `frontend/src/lib/api.types.ts`
- Test: `backend/tests/test_announcements_gateway.py`

**Interfaces:**
- `GET /announcements/status` → `GatewayStatusOut{state: str}` — gated `require_capability("messages.broadcast")`; `state = openwa_client.session_state()`.
- `GET /announcements/qr` → `GatewayQrOut{qr: str | None}` — gated `require_capability("settings.edit")` (admin only); `qr = openwa_client.fetch_qr()`.
- Reference `openwa_client` as a module attribute so tests can monkeypatch `announce_service`/`openwa_client`. (Call `openwa_client.session_state()` / `.fetch_qr()` directly in the router, importing `from app.services import openwa_client`.)

- [ ] **Step 1: Write the failing tests** (mirror `test_announcements_api.py` fixtures)

```python
# backend/tests/test_announcements_gateway.py
from app.services import openwa_client


def test_status(admin_client, monkeypatch):
    monkeypatch.setattr(openwa_client, "session_state", lambda: "connected")
    r = admin_client.get("/api/v1/announcements/status")
    assert r.status_code == 200 and r.json() == {"state": "connected"}


def test_qr_admin_only(admin_client, monkeypatch):
    monkeypatch.setattr(openwa_client, "fetch_qr", lambda: "data:image/png;base64,AAAA")
    r = admin_client.get("/api/v1/announcements/qr")
    assert r.status_code == 200 and r.json()["qr"].startswith("data:image")


def test_qr_requires_settings_edit(client):
    # `client` = manager role (has neither messages.broadcast nor settings.edit)
    r = client.get("/api/v1/announcements/qr")
    assert r.status_code in (401, 403)
```

- [ ] **Step 2: Run to verify failure** → 404.

- [ ] **Step 3: Schemas** — add `GatewayStatusOut{state: str}` and `GatewayQrOut{qr: str | None}` to `announcement.py`.

- [ ] **Step 4: Routes** — add the two GET routes to `announcements.py` with the gates above, importing `from app.services import openwa_client` and calling the module functions. No new router/mount needed.

- [ ] **Step 5: Run to verify pass** → PASS.

- [ ] **Step 6: Resync** — `venv\Scripts\python.exe -X utf8 scripts/dump_openapi.py` → `pnpm -C frontend run gen:api` → `pnpm -C frontend exec tsc -b --noEmit`. Confirm `GatewayStatusOut`/`GatewayQrOut` in `api.types.ts`. Do NOT commit `openapi.json`.

- [ ] **Step 7: Ruff + commit (tracked files only)**
```bash
git add backend/app/schemas/announcement.py backend/app/api/v1/announcements.py backend/tests/test_announcements_gateway.py frontend/src/lib/api.types.ts
git commit -m "feat(openwa): gateway status + admin-gated QR endpoints + resync"
```

---

### Task 3: Send-to-Group page — status, error-vs-empty split, blocked banner

**Files:**
- Modify: `frontend/src/pages/announcements/SendToGroupPage.tsx`
- Modify: `frontend/src/lib/api.ts` (`gatewayStatus`)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Modify/extend: `frontend/src/pages/announcements/SendToGroupPage.test.tsx`

**Interfaces:**
- api.ts: `gatewayStatus: () => request<GatewayStatusOut>('GET', '/announcements/status')`.
- Page: `useQuery(['gateway-status'], api.gatewayStatus, {staleTime: 30_000})`. Derive UI:
  - `state === 'connected'` → normal group list; if `groups.length === 0` → NEUTRAL empty copy `noGroupsForNumber` ("this number isn't in any groups").
  - `state !== 'connected'` OR the groups query `isError` → amber blocked banner: `disabled` → "WhatsApp isn't enabled — ask your administrator"; `unreachable` → "the gateway service isn't running on the server"; `disconnected` → "WhatsApp isn't connected — reconnect to send". Group send is disabled while not connected. NO SMS-fallback text.
  - Banner shows a Connect/Re-scan button ONLY when `useCapabilities().has('settings.edit')` and state ∈ {disconnected} (and optionally `unreachable` shows "service down" with no QR button — QR won't help). For non-admins: "ask your administrator" copy, no button. (The button opens the dialog built in Task 4 — in THIS task, wire a placeholder `onConnect` prop/callback or a disabled button; Task 4 replaces it with the dialog.)
- Use lucide icons (`MessageCircle`, `AlertTriangle`, `QrCode`).

- [ ] **Step 1: i18n keys (both files, parity)** — `sendToGroup` additions: `statusConnected, statusChecking, gatewayDisabled, gatewayUnreachable, gatewayDisconnected, blockedTitle, blockedGroupsHint, noGroupsForNumber, reconnect, askAdmin`. Arabic translated; identical placeholders.

- [ ] **Step 2: Failing test** — extend `SendToGroupPage.test.tsx`: mock `api.gatewayStatus` → `{state:'disconnected'}` and assert the blocked banner text renders (and the group list is NOT shown); a second case with `{state:'connected'}` + `listGroups: []` asserts the NEUTRAL `noGroupsForNumber` copy (distinct from the blocked banner). Mirror the existing harness.

- [ ] **Step 3: Run to verify failure.**

- [ ] **Step 4: Implement** the status query + the derived states + banner (lucide icons, `dir="auto"` on any free text, logical CSS). Keep the existing compose form; disable the Send button while `state !== 'connected'`.

- [ ] **Step 5: Run test + tsc** → pass/clean.

- [ ] **Step 6: i18n review + commit** — run `i18n-rtl-reviewer` on the diff; fix; commit.
```bash
git add frontend/src/pages/announcements/SendToGroupPage.tsx frontend/src/lib/api.ts frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/pages/announcements/SendToGroupPage.test.tsx
git commit -m "feat(openwa): gateway status + error-vs-empty blocked banner on Send-to-Group"
```

---

### Task 4: In-app QR connect/re-scan dialog (admin-gated, rotation + polling)

**Files:**
- Create: `frontend/src/pages/announcements/GatewayConnectDialog.tsx`
- Modify: `frontend/src/pages/announcements/SendToGroupPage.tsx` (wire the Reconnect button → dialog)
- Modify: `frontend/src/lib/api.ts` (`gatewayQr`)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/announcements/GatewayConnectDialog.test.tsx`

**Interfaces:**
- api.ts: `gatewayQr: () => request<GatewayQrOut>('GET', '/announcements/qr')`.
- `<GatewayConnectDialog open onOpenChange />` (mirror an existing Radix `Dialog`): while open, `useQuery(['gateway-qr'], api.gatewayQr, {refetchInterval: 20_000})` renders the QR image; `useQuery(['gateway-status'], ..., {refetchInterval: 3_000})` polls; when status flips to `connected` → show success, invalidate `['announce-groups']` + `['gateway-status']`, and auto-close after a beat. Steps listed BEFORE the QR image (first-time linking). Only opened for `settings.edit` admins (the button that opens it is already admin-gated in Task 3).
- Re-scan while already connected is a secondary action with a confirm ("this disconnects the current link until you scan again") — for v1 the dialog is reached from a disconnected state, so a full unlink flow is out of scope; if the button is shown while connected, gate it behind a `window.confirm`-style Radix AlertDialog or simply label it clearly. (Keep v1 focused: primary path is disconnected → scan → connected.)

- [ ] **Step 1: i18n keys (both files)** — `sendToGroup.qr`: `dialogTitle, dialogHint, step1 ("Open WhatsApp on the office phone"), step2 ("Linked devices → Link a device"), step3 ("Scan this code"), waiting, connected, qrError, refreshing`.

- [ ] **Step 2: Failing test** — `GatewayConnectDialog.test.tsx`: mock `api.gatewayQr` → `{qr:'data:image/png;base64,AAAA'}` and `api.gatewayStatus` → `{state:'disconnected'}`; assert the QR img + the 3 steps render. (Timers/polling: use `vi.useFakeTimers` sparingly or assert initial render only, mirroring sibling tests.)

- [ ] **Step 3: Run to verify failure.**

- [ ] **Step 4: Implement** the dialog (Radix Dialog, lucide `QrCode`, `dir="auto"`), wire the Task-3 Reconnect button to open it, add `api.gatewayQr`. On `connected`, invalidate `['announce-groups']` + `['gateway-status']`.

- [ ] **Step 5: Test + tsc** → pass/clean.

- [ ] **Step 6: i18n review + commit** — run `i18n-rtl-reviewer`; fix; commit.
```bash
git add frontend/src/pages/announcements/GatewayConnectDialog.tsx frontend/src/pages/announcements/SendToGroupPage.tsx frontend/src/lib/api.ts frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/pages/announcements/GatewayConnectDialog.test.tsx
git commit -m "feat(openwa): in-app QR connect dialog (admin, rotation + status polling)"
```

---

### Task 5: Finalization — gates + reviews + merge/push

- [ ] Full backend gates (`pytest`, `mypy` no-new, `ruff` + `format` on touched files).
- [ ] Full frontend gates (`tsc`, `vitest`, `lint` on touched files).
- [ ] `i18n-rtl-reviewer` over the SendToGroupPage + GatewayConnectDialog + locale diffs; address findings.
- [ ] Whole-branch review (`requesting-code-review`, opus); address blocking findings.
- [ ] Merge to `main`, regenerate `api.types.ts` if `main` advanced, full suite on `main`, push to `origin/main`. Ships dormant behind `openwa_enabled`.

## Self-Review (against Fable's v1)

- **4-state status endpoint** → Task 1 (`session_state`) + Task 2 (`GET /status`). **Admin-gated QR proxy** → Task 1 (`fetch_qr`) + Task 2 (`GET /qr`, `settings.edit`). **error-vs-empty split + blocked banner (no SMS-fallback copy, group-specific)** → Task 3. **In-app QR dialog (rotation + polling + success handoff + group-list invalidation)** → Task 4. **Inline on Send-to-Group, no Settings card** (user's choice) → Tasks 3–4 all on `SendToGroupPage`. **lucide icons, bilingual+RTL** → Tasks 3–4. **Deferred** (global header indicator, background polling, unlink/logout, delivery metrics) → not built.
- **Security:** QR endpoint + button + dialog gated `settings.edit`; status gated `messages.broadcast`. Non-admin broadcast users get status + "ask your administrator", never the QR.
- **Type consistency:** `session_state`/`fetch_qr` (T1) → `GatewayStatusOut`/`GatewayQrOut` (T2) → `gatewayStatus`/`gatewayQr` (T3/T4) → page/dialog.
