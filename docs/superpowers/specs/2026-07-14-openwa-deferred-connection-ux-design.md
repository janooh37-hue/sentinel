# OpenWA Deferred Connection UX — Design

**Date:** 2026-07-14
**Status:** Design approved; ready for implementation plan.
**Mockup:** `docs/openwa-deferred-ux-mockup.html` (EN/AR toggle, same card/pill language as the shipped connection-ux mockup).
**Design consult:** Fable (design-constraints brief, 2026-07-14).

## Goal

Close the three remaining deferred gaps from the shipped OpenWA connection-UX work
(commits `b2f18c8`→`b2b2bb1`): (1) an always-visible header indicator of WhatsApp
session state, (2) light background polling so the indicator and the Send-to-Group
banner reflect a session drop within ~60s, and (3) an admin **unlink / logout**
action so the office number can be switched. All ship **dormant behind
`openwa_enabled`**, consistent with the existing gateway feature.

**Delivery metrics is explicitly OUT of this spec** — it is its own follow-up
(separate endpoint, dashboard widget, privacy review); see *Deferred* below.

## Scope decision

- **In:** Component 1 (header indicator), Component 2 (background polling +
  server-side status guard), Component 3 (unlink/logout, dormant best-guess).
- **Out / follow-up:** Component 4 (delivery metrics dashboard widget).
- These three share the live `['gateway-status']` query and the Send-to-Group
  page, so they form one coherent unit. Metrics is a history surface over
  `OutboundMessage` and doesn't belong on the group page.

## Verified facts (grounding)

- `openwa_client.session_state() -> "disabled"|"unreachable"|"disconnected"|"connected"`
  and `fetch_qr() -> str|None` already exist (`backend/app/services/openwa_client.py`),
  both "never raise". Transport timeout is **10s** (`_TIMEOUT`). `health()` unchanged.
- `GET /announcements/status` → `{state}` (gated `messages.broadcast`) and
  `GET /announcements/qr` → `{qr}` (gated `settings.edit`) already exist on
  `backend/app/api/v1/announcements.py`.
- Frontend: `SendToGroupPage.tsx` uses `useQuery(['gateway-status'], api.gatewayStatus,
  {staleTime: 30_000})`; `GatewayConnectDialog.tsx` polls status at 3s while open and
  fetches QR at 20s. `useCapabilities().has(cap)`; api.ts `request<T>('METHOD','/path')`.
- Header shell is `TopNav.tsx` — right cluster is an `ms-auto` flex (auto-mirrors in
  RTL) holding ThemeToggle + NavBell. `MobileTopBar` is intentionally minimal.
- **Gateway contract is speculative and UNVERIFIED** (the stack has never run; the
  image is a placeholder; a real gateway — WAHA etc. — is still to be chosen). The
  README "Pin-the-contract" table (`deploy/openwa/README.md`) has **no logout
  endpoint**. Everything here therefore ships dormant behind `openwa_enabled`.
- Group sends log to `GroupAnnouncement`/`GroupAnnouncementSend`, **not**
  `OutboundMessage` (which is individual notifications only) — relevant only to the
  deferred metrics piece.

## Component 1 — Header connection indicator

**What:** a lucide `MessageCircle` icon-button in the `TopNav` right cluster with a
small corner status dot. **Awareness only** — tooltip + click navigates to
`/messages/broadcast`, where the banner / QR dialog / unlink already live. No QR or
management logic in the shell.

**States (never collapse red vs amber):**
| state | dot | tooltip intent |
|-------|-----|----------------|
| `connected` | quiet green | "WhatsApp connected · checked Xs ago" |
| `disconnected` | amber, gentle pulse | "session down — re-scan to reconnect" |
| `unreachable` | steady red | "gateway service not running — restart it" |
| `disabled` | — | **render nothing; do not mount; do not poll** |

**Gating:** rendered only for `messages.broadcast` holders (they alone can call
`GET /announcements/status`). No admin-only behavior in the indicator itself.

**RTL/bilingual:** right cluster mirrors via flex + logical margins; anchor the dot
with `inset-inline-end`. `aria-label` + tooltip from locale keys
(`gateway.indicator.{connected,disconnected,unreachable}` + an interpolated
"checked {count}s ago" key). Western digits + `tabular-nums`.

**Deferred within this component:** MobileTopBar indicator; any header popover.

## Component 2 — Background polling

**What:** no new machinery — one shared `['gateway-status']` cache key, three
observers with tiered intervals. A shared `useGatewayStatus()` hook centralizes the
query so the indicator, the page banner, and (future) surfaces stay consistent.

- Indicator observer: `refetchInterval: 60_000` + `refetchOnWindowFocus: true`.
- Page banner: reads the same cache (no own interval) — refreshes for free.
- Dialog: keeps `refetchInterval: 3_000` while open (React Query runs the smallest
  active interval).
- **Poll only when it matters:** signed in ∧ `messages.broadcast` ∧ tab visible
  (RQ pauses intervals on hidden tabs by default) ∧ state ≠ `disabled`. Implement
  `refetchInterval` as a function returning `false` once `disabled` is observed — a
  permanent stop so a dormant deployment does zero background work.

**Server-side guard (the real work here):** N clients polling a dead gateway would
each pin a worker for the 10s transport timeout. Add:
1. a short **probe timeout (~3s)** used only by the status path (not the send path),
   and
2. a **~15s in-process TTL cache** on `GET /announcements/status` so bursts collapse
   to one upstream probe per window.

Detection budget: header ≤60s, dialog ≤3s — meets the ~30–60s target.

**Deferred:** SSE push of gateway state (the app has an SSE channel; elegant but
over-scoped); polling while logged out / lock screen.

## Component 3 — Unlink / logout (dormant, best-guess)

**What:** when `state === 'connected'` ∧ `has('settings.edit')`, show a compact
status row above the Send-to-Group form: green "connected" pill + "checked Xs ago" +
ghost `Re-scan QR` (opens the existing dialog) + ghost-**danger** `Unlink phone…`.
Non-admins see nothing extra while connected.

**Confirm + guardrails:** Radix `AlertDialog`; destructive button **not**
default-focused; plain-consequence copy — group sends stop and are **not** sent
another way (never "falls back to SMS" for groups); employee notifications stop and
eligible ones route to SMS (that claim is true for individuals and fine here).

**Backend:** `POST /announcements/unlink`, gated `settings.edit`, **audit-logged with
the acting user**. Calls a new `openwa_client.logout() -> bool` ("never raises", same
posture as siblings). On success the page invalidates `['gateway-status']` +
`['announce-groups']`, the banner appears, and the QR dialog **auto-opens** so
"switch numbers" is one continuous flow (unlink → scan new QR).

**Contract risk & handling (approved: build dormant, best-guess):**
- No logout endpoint is pinned. Best guess: `POST /api/sessions/{session}/logout`
  (fallback `DELETE /api/sessions/{session}` if the chosen gateway differs).
- `logout()` treats any non-2xx / transport error as failure and returns `False`
  without raising; the UI surfaces a soft "couldn't unlink — try again / restart the
  service" toast.
- Add a **Logout / unlink** row to the README "Pin-the-contract" table so it is
  verified before go-live. Ships dormant behind `openwa_enabled`.

**Deferred within this component:** showing the currently-linked number (needs a
gateway "me" probe); type-to-confirm.

## Interfaces (summary)

Backend
- `openwa_client.logout() -> bool` — POST the logout path; never raises; `False` on
  any error/non-2xx.
- `GET /announcements/status` — reuse; wrap in ~15s TTL cache + ~3s probe timeout.
- `POST /announcements/unlink` → `{ok: bool}` — `settings.edit`; audit-logged;
  `ok = openwa_client.logout()`.

Frontend
- `useGatewayStatus()` hook — shared `['gateway-status']` query; caller passes
  interval/focus options; auto-stops on `disabled`.
- `<GatewayIndicator />` — mounts in `TopNav` right cluster; gated
  `messages.broadcast`; hidden when `disabled`.
- `api.unlinkGateway()` → `POST /announcements/unlink`.
- Send-to-Group connected status row + `UnlinkConfirmDialog` (Radix AlertDialog).

## Error handling

- All gateway calls "never raise"; UI degrades to the appropriate blocked state.
- Unlink failure → soft toast, state unchanged (no optimistic flip).
- Status probe timeout / unreachable → `unreachable` state, red dot, no QR button.

## Testing

- Backend: `logout()` unit tests via `httpx.MockTransport` (2xx→True, 5xx/transport
  error→False); `POST /announcements/unlink` gating (settings.edit only) + audit
  entry; status TTL cache collapses N calls to one probe.
- Frontend: `GatewayIndicator` renders the right dot per state and nothing when
  `disabled`/non-capability; unlink confirm dialog calls the mutation and invalidates
  queries + auto-opens the QR dialog on success; `i18n-rtl-reviewer` on locale diffs.

## Constraints

- Bilingual en/ar key parity; no English leaking into Arabic; logical CSS
  (`ms-`/`me-`, `text-start`/`text-end`, `inset-inline-end`, `dir="auto"` on names);
  lucide icons, no emoji; Western digits + `tabular-nums`.
- 4-state enum intact end-to-end (indicator is the most tempting place to collapse
  red vs amber — don't).
- Type resync after backend route/schema change (`dump_openapi.py` → `pnpm gen:api`
  → `tsc`; commit `api.types.ts`, not `openapi.json`).
- Strict gates: ruff + format; mypy (no NEW errors vs baseline); pytest
  (`filterwarnings=error`); vitest; tsc. Python via `venv\Scripts\...`.
- Live checkout — commit **and push to `origin/main`**; ships dormant behind
  `openwa_enabled`.

## Deferred (out of scope — future plans)

- **Delivery metrics** (own follow-up plan): `GET /notifications/metrics?days=7`
  aggregating `OutboundMessage` (Sent/Delivered/Failed/Fell-back + pending + last
  failures), normalizing WA-lowercase vs SMS-capitalized `delivery_state`; dashboard
  widget (precedent `EmailSyncStatusWidget`); gated `messages.broadcast`; no phone
  numbers shown. Reuses the existing 5-min delivery poller — no new poller.
- MobileTopBar indicator; SSE push of gateway state; currently-linked-number display;
  group-announcement delivery aggregates; full notification history page.
