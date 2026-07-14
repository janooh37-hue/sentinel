# OpenWA Deferred Connection UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible header WhatsApp-session indicator, light app-wide status polling (with a server-side load guard), and an admin unlink/re-link action — closing the three deferred gaps from the shipped OpenWA connection UX.

**Architecture:** All three build on the existing `['gateway-status']` query + `openwa_client.session_state()`. A shared `useGatewayStatus()` hook centralizes the query so the indicator (polls 60s) and the Send-to-Group banner (piggybacks the shared cache) stay consistent; the status route gains a ~15s in-process TTL cache and a 3s probe timeout so N polling clients can't pin workers on a dead gateway. Unlink is a new admin-gated, audit-logged endpoint calling a best-guess gateway logout path, shipping dormant behind `openwa_enabled`.

**Tech Stack:** FastAPI, httpx (+ `httpx.MockTransport` in tests), React 19 + TanStack Query v5, Radix (`AlertDialog` via `ConfirmDialog`), Tailwind 4, lucide-react. Generated `api.types.ts` via `pnpm gen:api`.

**Spec:** `docs/superpowers/specs/2026-07-14-openwa-deferred-connection-ux-design.md`
**Mockup:** `docs/openwa-deferred-ux-mockup.html`

> **✅ UNBLOCKED — WAHA reconcile merged to `main`** (merge `f8c8b35`, tip `a20ba6c`,
> pushed; feature branch deleted). `openwa_client.py` is now WAHA-shaped
> (`/api/sendText`, `GET /api/{session}/auth/qr`; `session_state()` maps `WORKING`→
> connected). Build on the reconciled client:
> - `session_state()` and QR/status parsing are OWNED by the reconcile — Task 1 here
>   only wraps the existing call in the 3s probe timeout; do not re-derive the mapping.
> - `logout()` does NOT yet exist in the client — Task 1 adds it. Pin its path against
>   WAHA's `/api/docs` dump. WAHA's session logout is `POST /api/sessions/{session}/logout`
>   — verify, don't assume. Gateway IS chosen (WAHA), so no "best-guess/unverified" framing.

## Global Constraints

- **4-state enum, never collapsed:** `disabled | unreachable | disconnected | connected`. The indicator is the most tempting place to merge red (`unreachable`) vs amber (`disconnected`) — don't.
- **Gating:** status = `messages.broadcast`; QR + unlink = `settings.edit` (destructive/hijack primitives, admin only).
- **No "falls back to SMS" copy for group sends** — group messages have no SMS fallback. (The employee-notification→SMS claim IS true and is allowed only in the unlink confirm text, which is about individual notifications.)
- **Dormant:** everything ships behind `openwa_enabled`; when `disabled`, the indicator renders nothing and polling stops permanently.
- **Gateway is WAHA (post-reconcile):** pin `logout()` against WAHA's dumped OpenAPI — session logout is `POST /api/sessions/{session}/logout` (verify against `/api/docs`, don't assume). `openwa_client.logout()` must still be "never raises" like its siblings. Add a logout row to the README pin-the-contract table. Ships dormant behind `openwa_enabled` until the WAHA go-live checklist is done.
- **Bilingual parity:** en/ar identical keys, no English leaking into Arabic; logical CSS (`ms-`/`me-`, `text-start`/`text-end`, `inset-inline-end`, `dir="auto"` on free text/names); Western digits + `tabular-nums`; lucide icons, no emoji. Run `i18n-rtl-reviewer` after locale changes.
- **Type resync** after backend route/schema change: `venv\Scripts\python.exe -X utf8 scripts/dump_openapi.py` → `pnpm -C frontend run gen:api` → `pnpm -C frontend exec tsc -b --noEmit`. Commit `api.types.ts`, NOT `openapi.json` (gitignored).
- **Strict gates:** ruff + `format --check`; mypy (no NEW errors vs 47 baseline); pytest (`filterwarnings=error`); vitest; tsc. Python via `venv\Scripts\...`.
- **Live checkout:** commit **and push to `origin/main`** (do the work on a branch, merge when green).

## File Structure

- `backend/app/services/openwa_client.py` — add `logout()`, a 3s probe timeout used by `session_state()`, and a 15s-TTL `cached_session_state()` + `reset_status_cache()`.
- `backend/app/schemas/announcement.py` — add `GatewayUnlinkOut`.
- `backend/app/api/v1/announcements.py` — `/status` uses the cache; new `POST /unlink` (audit-logged).
- `backend/tests/test_openwa_client_state.py` — extend (logout, probe timeout, cache).
- `backend/tests/test_announcements_gateway.py` — add unlink tests + autouse cache reset.
- `frontend/src/lib/useGatewayStatus.ts` (new) — shared status hook + `pollInterval()` helper.
- `frontend/src/lib/useGatewayStatus.test.ts` (new).
- `frontend/src/components/shell/GatewayIndicator.tsx` (new) + `.test.tsx` (new); mounted in `TopNav.tsx`.
- `frontend/src/pages/announcements/SendToGroupPage.tsx` — use the shared hook; add the admin connected-status row + unlink flow.
- `frontend/src/lib/api.ts` — `unlinkGateway`.
- `frontend/src/locales/{en,ar}.json` — `gateway.indicator.*` + `sendToGroup.*` unlink/rescan keys.
- `deploy/openwa/README.md` — add the logout row to the pin-the-contract table.

---

### Task 1: `openwa_client.logout()` + 3s probe timeout on `session_state()`

**Files:**
- Modify: `backend/app/services/openwa_client.py`
- Test: `backend/tests/test_openwa_client_state.py`

**Interfaces:**
- Consumes: existing `_base()`, `_headers()`, `_transport`, `get_settings()`.
- Produces:
  - `logout() -> bool` — POST `{base}/api/sessions/{session}/logout`; `True` on 2xx, `False` on non-2xx or transport error. Never raises.
  - `_PROBE_TIMEOUT: httpx.Timeout` (= `httpx.Timeout(3.0)`) and `_probe_client() -> httpx.Client`; `session_state()` uses `_probe_client()` instead of `_client()`.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_openwa_client_state.py`)

```python
def test_logout_true_on_2xx(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": True}))
    assert wa.logout() is True


def test_logout_false_on_error(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(500, text="x"))
    assert wa.logout() is False


def test_logout_false_on_transport_error(monkeypatch):
    _cfg(monkeypatch)

    def boom(r):
        raise httpx.ConnectError("down")

    wa._transport = httpx.MockTransport(boom)
    assert wa.logout() is False


def test_probe_timeout_is_short():
    assert wa._PROBE_TIMEOUT.read == 3.0
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client_state.py -v`
Expected: FAIL (`module 'app.services.openwa_client' has no attribute 'logout' / '_PROBE_TIMEOUT'`).

- [ ] **Step 3: Implement** — in `backend/app/services/openwa_client.py`, add near `_TIMEOUT`:

```python
_PROBE_TIMEOUT = httpx.Timeout(3.0)  # status path only — keeps a dead gateway from pinning workers


def _probe_client() -> httpx.Client:
    return httpx.Client(transport=_transport, timeout=_PROBE_TIMEOUT)
```

In `session_state()`, change `with _client() as c:` to `with _probe_client() as c:` (only that function). Then add `logout()`:

```python
def logout() -> bool:
    """Unlink the current WhatsApp session on the gateway. Never raises.

    WAHA session logout (POST /api/sessions/{session}/logout) — confirm the path
    against the reconciled WAHA client / dumped OpenAPI. Returns False on any error.
    """
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/logout"
    try:
        with _client() as c:
            resp = c.post(url, headers=_headers())
    except httpx.HTTPError as e:
        log.warning("openwa: logout transport error: %s", e)
        return False
    return resp.status_code // 100 == 2
```

- [ ] **Step 4: Run to verify pass** (this suite + the existing openwa suites)

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client_state.py backend/tests/test_openwa_client.py backend/tests/test_openwa_client_groups.py -v`
Expected: PASS (all).

- [ ] **Step 5: Ruff + commit**

```bash
venv\Scripts\ruff.exe check backend/app/services/openwa_client.py backend/tests/test_openwa_client_state.py
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client_state.py
git commit -m "feat(openwa): logout() + 3s probe timeout on session_state()"
```

---

### Task 2: Status TTL cache + `POST /announcements/unlink` (audit-logged)

**Files:**
- Modify: `backend/app/services/openwa_client.py` (add `cached_session_state()` + `reset_status_cache()`)
- Modify: `backend/app/schemas/announcement.py` (add `GatewayUnlinkOut`)
- Modify: `backend/app/api/v1/announcements.py` (`/status` → cache; new `POST /unlink`)
- Modify: `backend/openapi.json` (regenerated, NOT committed), `frontend/src/lib/api.types.ts`
- Test: `backend/tests/test_openwa_client_state.py` (cache), `backend/tests/test_announcements_gateway.py` (unlink + autouse reset)

**Interfaces:**
- Consumes: `session_state()`, `logout()` (Task 1); `AuditLog` (`app.db.models`); `require_capability` (`app.api.deps`).
- Produces:
  - `cached_session_state() -> str` — returns `session_state()` but caches for 15s (module-global); `reset_status_cache() -> None` clears it.
  - `GatewayUnlinkOut{ok: bool}`.
  - `POST /announcements/unlink` → `GatewayUnlinkOut` — gated `settings.edit`; writes an `audit_log` row (`action="unlink_whatsapp"`, `entity_type="gateway"`); `ok = openwa_client.logout()`.

- [ ] **Step 1: Write the failing cache test** (append to `backend/tests/test_openwa_client_state.py`)

```python
def test_cached_session_state_collapses_calls(monkeypatch):
    wa.reset_status_cache()
    calls = {"n": 0}

    def counting():
        calls["n"] += 1
        return "connected"

    monkeypatch.setattr(wa, "session_state", counting)
    assert wa.cached_session_state() == "connected"
    assert wa.cached_session_state() == "connected"
    assert wa.cached_session_state() == "connected"
    assert calls["n"] == 1  # cached within the TTL window
    wa.reset_status_cache()
    assert wa.cached_session_state() == "connected"
    assert calls["n"] == 2  # re-probed after reset
```

- [ ] **Step 2: Write the failing unlink tests** (append to `backend/tests/test_announcements_gateway.py`)

```python
@pytest.fixture(autouse=True)
def _reset_status_cache():
    openwa_client.reset_status_cache()
    yield
    openwa_client.reset_status_cache()


def test_unlink_admin_ok(admin_client, monkeypatch, api_db):
    from app.db.models import AuditLog

    monkeypatch.setattr(openwa_client, "logout", lambda: True)
    r = admin_client.post("/api/v1/announcements/unlink")
    assert r.status_code == 200 and r.json() == {"ok": True}
    row = api_db.query(AuditLog).filter_by(action="unlink_whatsapp").one()
    assert row.entity_type == "gateway"


def test_unlink_requires_settings_edit(client):
    # `client` = manager role (no settings.edit)
    r = client.post("/api/v1/announcements/unlink")
    assert r.status_code in (401, 403)
```

- [ ] **Step 3: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client_state.py::test_cached_session_state_collapses_calls backend/tests/test_announcements_gateway.py -v`
Expected: FAIL (`no attribute 'reset_status_cache'` / 404 on `/unlink`).

- [ ] **Step 4: Implement the cache** — in `openwa_client.py` add `import time` (top) and, below `session_state()`:

```python
_STATUS_TTL = 15.0
_status_cache: tuple[float, str] | None = None


def reset_status_cache() -> None:
    global _status_cache
    _status_cache = None


def cached_session_state() -> str:
    """session_state() memoised for _STATUS_TTL seconds (per process).

    Collapses bursts of polling clients into one upstream probe per window so a
    dead gateway can't pin workers on the probe timeout. Never raises.
    """
    global _status_cache
    now = time.monotonic()
    if _status_cache is not None and now - _status_cache[0] < _STATUS_TTL:
        return _status_cache[1]
    state = session_state()
    _status_cache = (now, state)
    return state
```

- [ ] **Step 5: Implement the schema** — add to `backend/app/schemas/announcement.py` (mirror `GatewayStatusOut`):

```python
class GatewayUnlinkOut(BaseModel):
    ok: bool
```

- [ ] **Step 6: Implement the routes** — in `backend/app/api/v1/announcements.py`:
  - Change `/status` body to `return GatewayStatusOut(state=openwa_client.cached_session_state())`.
  - Add imports: `import json`, `from datetime import datetime`? (not needed — `AuditLog.ts` defaults). Add `from app.db.models import AuditLog, User` (User already imported — add `AuditLog`). Update the schema import to include `GatewayUnlinkOut`.
  - Add the route:

```python
@router.post("/unlink", response_model=GatewayUnlinkOut)
def gateway_unlink(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> GatewayUnlinkOut:
    """Unlink the current WhatsApp session (admin only). Audit-logged; dormant behind openwa_enabled."""
    ok = openwa_client.logout()
    db.add(
        AuditLog(
            actor=user.display_name or user.email,
            action="unlink_whatsapp",
            entity_type="gateway",
            entity_id=None,
            payload=json.dumps({"ok": ok}, ensure_ascii=False),
        )
    )
    db.commit()
    openwa_client.reset_status_cache()
    return GatewayUnlinkOut(ok=ok)
```

- [ ] **Step 7: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client_state.py backend/tests/test_announcements_gateway.py -v`
Expected: PASS (including the pre-existing `test_status`, thanks to the autouse cache reset).

- [ ] **Step 8: Resync types**

Run: `venv\Scripts\python.exe -X utf8 scripts/dump_openapi.py` → `pnpm -C frontend run gen:api` → `pnpm -C frontend exec tsc -b --noEmit`
Expected: `GatewayUnlinkOut` present in `frontend/src/lib/api.types.ts`; tsc clean.

- [ ] **Step 9: Ruff + commit (tracked files only)**

```bash
venv\Scripts\ruff.exe check backend/app/services/openwa_client.py backend/app/api/v1/announcements.py backend/app/schemas/announcement.py backend/tests/
git add backend/app/services/openwa_client.py backend/app/api/v1/announcements.py backend/app/schemas/announcement.py backend/tests/test_openwa_client_state.py backend/tests/test_announcements_gateway.py frontend/src/lib/api.types.ts
git commit -m "feat(openwa): status TTL cache + admin-gated audit-logged unlink endpoint"
```

---

### Task 3: `useGatewayStatus()` shared hook + `pollInterval()` helper

**Files:**
- Create: `frontend/src/lib/useGatewayStatus.ts`
- Create: `frontend/src/lib/useGatewayStatus.test.ts`
- Modify: `frontend/src/pages/announcements/SendToGroupPage.tsx` (replace its inline status query with the hook)

**Interfaces:**
- Consumes: `api.gatewayStatus` (`GET /announcements/status`), `useCapabilities` (`@/lib/useCapabilities`), `GatewayStatusOut` (`@/lib/api`).
- Produces:
  - `type GatewayState = 'disabled' | 'unreachable' | 'disconnected' | 'connected'`
  - `pollInterval(state: GatewayState | undefined): number | false` — `state === 'disabled' ? false : 60_000`.
  - `useGatewayStatus(opts?: { poll?: boolean }): UseQueryResult<GatewayStatusOut>` — query key `['gateway-status']`, `enabled` on `messages.broadcast`, `staleTime: 30_000`; when `opts.poll`, `refetchOnWindowFocus: true` and `refetchInterval: (q) => pollInterval(q.state.data?.state)`.

- [ ] **Step 1: Write the failing test** (`frontend/src/lib/useGatewayStatus.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { pollInterval } from './useGatewayStatus'

describe('pollInterval', () => {
  it('stops polling permanently when disabled', () => {
    expect(pollInterval('disabled')).toBe(false)
  })
  it('polls every 60s otherwise', () => {
    expect(pollInterval('connected')).toBe(60_000)
    expect(pollInterval('disconnected')).toBe(60_000)
    expect(pollInterval('unreachable')).toBe(60_000)
    expect(pollInterval(undefined)).toBe(60_000)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C frontend exec vitest run src/lib/useGatewayStatus.test.ts`
Expected: FAIL (cannot resolve `./useGatewayStatus`).

- [ ] **Step 3: Implement** (`frontend/src/lib/useGatewayStatus.ts`)

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { api, type GatewayStatusOut } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'

export type GatewayState = 'disabled' | 'unreachable' | 'disconnected' | 'connected'

/** 60s poll cadence, or a permanent stop once the feature is disabled (dormant). */
export function pollInterval(state: GatewayState | undefined): number | false {
  return state === 'disabled' ? false : 60_000
}

/**
 * Shared gateway-status query. All consumers hit the same ['gateway-status'] cache;
 * pass { poll: true } on the one always-mounted observer (the header indicator) to
 * drive app-wide refresh — other observers piggyback the shared cache for free.
 */
export function useGatewayStatus(opts?: { poll?: boolean }): UseQueryResult<GatewayStatusOut> {
  const { has } = useCapabilities()
  const poll = opts?.poll ?? false
  return useQuery({
    queryKey: ['gateway-status'],
    queryFn: api.gatewayStatus,
    enabled: has('messages.broadcast'),
    staleTime: 30_000,
    refetchOnWindowFocus: poll,
    refetchInterval: poll ? (q) => pollInterval(q.state.data?.state as GatewayState | undefined) : false,
  })
}
```

- [ ] **Step 4: Refactor `SendToGroupPage.tsx` to use the hook.** Replace the inline `useQuery({ queryKey: ['gateway-status'], ... })` (lines ~36-40) with:

```tsx
import { useGatewayStatus, type GatewayState } from '@/lib/useGatewayStatus'
// ...
const { data: gatewayData, isLoading: gatewayLoading } = useGatewayStatus()
```

Delete the now-duplicate local `type GatewayState = ...` (line ~25) in favour of the imported one. Leave all downstream logic (`gatewayState`, `isConnected`, banner) untouched.

- [ ] **Step 5: Run to verify pass** (hook test + existing page test + tsc)

Run: `pnpm -C frontend exec vitest run src/lib/useGatewayStatus.test.ts src/pages/announcements/SendToGroupPage.test.tsx` then `pnpm -C frontend exec tsc -b --noEmit`
Expected: PASS + clean. (If the existing page test doesn't already grant `messages.broadcast` via its `useCapabilities` mock, add it so `enabled` is true.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/useGatewayStatus.ts frontend/src/lib/useGatewayStatus.test.ts frontend/src/pages/announcements/SendToGroupPage.tsx
git commit -m "feat(openwa): shared useGatewayStatus hook (60s poll, dormant stop)"
```

---

### Task 4: Header connection indicator (`GatewayIndicator`) in TopNav

**Files:**
- Create: `frontend/src/components/shell/GatewayIndicator.tsx`
- Create: `frontend/src/components/shell/GatewayIndicator.test.tsx`
- Modify: `frontend/src/components/shell/TopNav.tsx` (mount it in the right cluster)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: `useGatewayStatus` (Task 3), `NavLink` (react-router), lucide `MessageCircle`.
- Produces: `<GatewayIndicator />` — renders `null` when the query is disabled/loading or `state ∈ {disabled}` or the user lacks the query (hook returns no data); otherwise a `NavLink` to `/messages/broadcast` with a `MessageCircle` icon and a status dot.

- [ ] **Step 1: i18n keys (both files, parity).** Add a `gateway` namespace:

`en.json`:
```json
"gateway": {
  "indicator": {
    "connected": "WhatsApp connected",
    "disconnected": "WhatsApp session down — reconnect",
    "unreachable": "WhatsApp service not running",
    "checkedAgo": "checked {{count}}s ago"
  }
}
```
`ar.json`:
```json
"gateway": {
  "indicator": {
    "connected": "واتساب متصل",
    "disconnected": "جلسة واتساب متوقفة — أعد الاتصال",
    "unreachable": "خدمة واتساب لا تعمل",
    "checkedAgo": "فُحِص قبل {{count}} ثانية"
  }
}
```

- [ ] **Step 2: Write the failing test** (`GatewayIndicator.test.tsx`) — mock the hook:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { GatewayIndicator } from './GatewayIndicator'

vi.mock('@/lib/useGatewayStatus', () => ({
  useGatewayStatus: vi.fn(),
}))
import { useGatewayStatus } from '@/lib/useGatewayStatus'

function mockState(state: string | undefined, extra: Record<string, unknown> = {}) {
  ;(useGatewayStatus as unknown as vi.Mock).mockReturnValue({
    data: state ? { state } : undefined,
    isLoading: false,
    dataUpdatedAt: Date.now(),
    ...extra,
  })
}

function renderIt() {
  return render(
    <MemoryRouter>
      <GatewayIndicator />
    </MemoryRouter>,
  )
}

describe('GatewayIndicator', () => {
  it('renders nothing when disabled', () => {
    mockState('disabled')
    const { container } = renderIt()
    expect(container.firstChild).toBeNull()
  })
  it('renders nothing while loading / no data', () => {
    mockState(undefined, { isLoading: true })
    const { container } = renderIt()
    expect(container.firstChild).toBeNull()
  })
  it('shows a connected indicator linking to broadcast', () => {
    mockState('connected')
    renderIt()
    const link = screen.getByRole('link', { name: /whatsapp connected/i })
    expect(link).toHaveAttribute('href', '/messages/broadcast')
    expect(link.querySelector('[data-state="connected"]')).not.toBeNull()
  })
  it('marks disconnected vs unreachable distinctly (no collapse)', () => {
    mockState('disconnected')
    const { rerender } = renderIt()
    expect(document.querySelector('[data-state="disconnected"]')).not.toBeNull()
    mockState('unreachable')
    rerender(
      <MemoryRouter>
        <GatewayIndicator />
      </MemoryRouter>,
    )
    expect(document.querySelector('[data-state="unreachable"]')).not.toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm -C frontend exec vitest run src/components/shell/GatewayIndicator.test.tsx`
Expected: FAIL (cannot resolve `./GatewayIndicator`).

- [ ] **Step 4: Implement** (`GatewayIndicator.tsx`)

```tsx
/**
 * GatewayIndicator — always-visible WhatsApp session dot in the TopNav right
 * cluster. Awareness only: click navigates to /messages/broadcast where the
 * banner / QR dialog / unlink live. Renders nothing when the feature is dormant
 * (disabled) or the user lacks messages.broadcast (hook disabled → no data).
 */
import { MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { useGatewayStatus, type GatewayState } from '@/lib/useGatewayStatus'

const DOT: Record<Exclude<GatewayState, 'disabled'>, string> = {
  connected: 'bg-green-500',
  disconnected: 'bg-amber-500 motion-safe:animate-pulse',
  unreachable: 'bg-red-500',
}

export function GatewayIndicator(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { data, isLoading, dataUpdatedAt } = useGatewayStatus({ poll: true })
  const state = data?.state as GatewayState | undefined

  // Dormant, loading, or no access → render nothing (zero chrome).
  if (isLoading || !state || state === 'disabled') return null

  const label = t(`gateway.indicator.${state}`)
  const secs = Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000))
  const title = `${label} · ${t('gateway.indicator.checkedAgo', { count: secs })}`

  return (
    <NavLink
      to="/messages/broadcast"
      aria-label={label}
      title={title}
      className="relative rounded-lg p-2 text-foreground transition-colors hover:bg-surface-tinted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      <MessageCircle className="h-[1.15em] w-[1.15em]" strokeWidth={1.8} aria-hidden />
      <span
        data-state={state}
        aria-hidden
        className={`absolute bottom-1 inset-inline-end-1 h-2 w-2 rounded-full ring-2 ring-surface ${DOT[state]}`}
      />
    </NavLink>
  )
}
```

- [ ] **Step 5: Mount in `TopNav.tsx`.** Add the import `import { GatewayIndicator } from './GatewayIndicator'` and place `<GatewayIndicator />` in the right cluster just before `<NavBellPopover />` (line ~126):

```tsx
        <EmailBasketTray />
        <GatewayIndicator />
        <NavBellPopover />
```

- [ ] **Step 6: Run to verify pass + tsc**

Run: `pnpm -C frontend exec vitest run src/components/shell/GatewayIndicator.test.tsx` then `pnpm -C frontend exec tsc -b --noEmit`
Expected: PASS + clean.

- [ ] **Step 7: i18n review + commit** — run the `i18n-rtl-reviewer` agent over the `gateway.indicator.*` locale additions + `GatewayIndicator.tsx`; fix findings; then:

```bash
git add frontend/src/components/shell/GatewayIndicator.tsx frontend/src/components/shell/GatewayIndicator.test.tsx frontend/src/components/shell/TopNav.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(openwa): header WhatsApp connection indicator (poll, RTL dot)"
```

---

### Task 5: Unlink flow on Send-to-Group (admin status row + confirm)

**Files:**
- Modify: `frontend/src/lib/api.ts` (`unlinkGateway`)
- Modify: `frontend/src/pages/announcements/SendToGroupPage.tsx` (connected status row + unlink)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Modify: `frontend/src/pages/announcements/SendToGroupPage.test.tsx`

**Interfaces:**
- Consumes: `useCapabilities().has('settings.edit')`, `GatewayConnectDialog` (existing, already imported on the page), `ConfirmDialog` (`@/components/ui/confirm-dialog`), `GatewayUnlinkOut` (`@/lib/api`).
- Produces: `api.unlinkGateway(): Promise<GatewayUnlinkOut>` → `POST /announcements/unlink`.

- [ ] **Step 1: Add the api method.** In `frontend/src/lib/api.ts`, next to `gatewayStatus` (line ~1074):

```ts
  unlinkGateway: () => request<GatewayUnlinkOut>('POST', '/announcements/unlink'),
```
Add `GatewayUnlinkOut` to the type imports from `./api.types` at the top of the `api` object's type imports (mirror how `GatewayStatusOut` is imported).

- [ ] **Step 2: i18n keys (both files, parity).** Add under the existing `sendToGroup` namespace:

`en.json`:
```json
"connectedTitle": "WhatsApp connected",
"rescanQr": "Re-scan QR",
"unlink": "Unlink phone…",
"unlinkTitle": "Unlink this WhatsApp number?",
"unlinkDesc": "Group messages will stop and will not be sent another way. Employee notifications will switch to SMS. You'll need to scan a QR code to link a number again.",
"unlinkConfirm": "Unlink",
"unlinked": "WhatsApp unlinked",
"unlinkFailed": "Couldn't unlink — try again"
```
`ar.json`:
```json
"connectedTitle": "واتساب متصل",
"rescanQr": "إعادة مسح الرمز",
"unlink": "إلغاء ربط الهاتف…",
"unlinkTitle": "إلغاء ربط رقم واتساب هذا؟",
"unlinkDesc": "ستتوقف رسائل المجموعات ولن تُرسَل بطريقة أخرى. وستتحوّل إشعارات الموظفين إلى الرسائل النصية. وستحتاج إلى مسح رمز لربط رقم مرة أخرى.",
"unlinkConfirm": "إلغاء الربط",
"unlinked": "تم إلغاء ربط واتساب",
"unlinkFailed": "تعذّر إلغاء الربط — حاول مرة أخرى"
```

- [ ] **Step 3: Write the failing test** (extend `SendToGroupPage.test.tsx`) — a case where status is `connected` and the user is admin renders the connected row with an Unlink button; clicking it opens the confirm dialog:

```tsx
it('admin sees an unlink action when connected', async () => {
  // Arrange: gatewayStatus → connected, listGroups → [], useCapabilities grants settings.edit.
  // (Mirror this file's existing mock setup for api + useCapabilities.)
  renderPage() // existing helper in this file
  expect(await screen.findByText(/whatsapp connected/i)).toBeInTheDocument()
  const unlink = screen.getByRole('button', { name: /unlink phone/i })
  await userEvent.click(unlink)
  expect(await screen.findByText(/unlink this whatsapp number/i)).toBeInTheDocument()
})
```

Adjust the mock so `api.gatewayStatus` resolves `{ state: 'connected' }` and `useCapabilities().has` returns true for both `messages.broadcast` and `settings.edit` in this case. If the file's harness uses a shared mock, add a per-test override.

- [ ] **Step 4: Run to verify failure**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/SendToGroupPage.test.tsx`
Expected: FAIL (no "WhatsApp connected" row / no Unlink button yet).

- [ ] **Step 5: Implement the connected status row.** In `SendToGroupPage.tsx`:
  - Add imports: `import { QrCode, Unlink } from 'lucide-react'` (extend the existing lucide import) and `import { ConfirmDialog } from '@/components/ui/confirm-dialog'`.
  - Add state + mutation near the existing `qrOpen` state:

```tsx
const qc = useQueryClient() // add useQueryClient to the @tanstack/react-query import
const [unlinkOpen, setUnlinkOpen] = useState(false)
const unlinkMut = useMutation({
  mutationFn: api.unlinkGateway,
  onSuccess: (res) => {
    if (res.ok) {
      toast.success(t('sendToGroup.unlinked'))
      void qc.invalidateQueries({ queryKey: ['gateway-status'] })
      void qc.invalidateQueries({ queryKey: ['announce-groups'] })
      setQrOpen(true) // switch-numbers flow: unlink → scan new QR
    } else {
      toast.error(t('sendToGroup.unlinkFailed'))
    }
  },
  onError: () => toast.error(t('sendToGroup.unlinkFailed')),
})
```
  - Render the row above the `<form>` (after the page header), only when connected AND admin:

```tsx
{isConnected && isAdmin && (
  <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface/60 px-4 py-3">
    <span className="inline-flex items-center gap-2 text-[0.85em] font-semibold text-green-700 dark:text-green-400">
      <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
      {t('sendToGroup.connectedTitle')}
    </span>
    <div className="ms-auto flex items-center gap-2">
      <button
        type="button"
        onClick={() => setQrOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[0.82em] font-medium text-foreground hover:bg-surface-tinted"
      >
        <QrCode className="h-3.5 w-3.5" aria-hidden />
        {t('sendToGroup.rescanQr')}
      </button>
      <button
        type="button"
        onClick={() => setUnlinkOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-3 py-1.5 text-[0.82em] font-medium text-accent hover:bg-accent/10"
      >
        <Unlink className="h-3.5 w-3.5" aria-hidden />
        {t('sendToGroup.unlink')}
      </button>
    </div>
  </div>
)}
```
  - Add the confirm dialog near the existing `<GatewayConnectDialog ... />`:

```tsx
<ConfirmDialog
  open={unlinkOpen}
  onOpenChange={setUnlinkOpen}
  title={t('sendToGroup.unlinkTitle')}
  description={t('sendToGroup.unlinkDesc')}
  confirmLabel={t('sendToGroup.unlinkConfirm')}
  onConfirm={() => unlinkMut.mutate()}
  destructive
/>
```

- [ ] **Step 6: Resync types** (a new response type is now consumed by api.ts — types were generated in Task 2, so just verify):

Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: clean (`GatewayUnlinkOut` already in `api.types.ts`).

- [ ] **Step 7: Run to verify pass**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/SendToGroupPage.test.tsx`
Expected: PASS.

- [ ] **Step 8: i18n review + commit** — run `i18n-rtl-reviewer` over the `sendToGroup` additions + the page diff; fix; then:

```bash
git add frontend/src/lib/api.ts frontend/src/pages/announcements/SendToGroupPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/pages/announcements/SendToGroupPage.test.tsx
git commit -m "feat(openwa): admin unlink/re-scan row on Send-to-Group (confirm + switch-numbers)"
```

---

### Task 6: README contract row + finalization (gates, reviews, merge/push)

**Files:**
- Modify: `deploy/openwa/README.md` (add the logout row to the pin-the-contract table)

- [ ] **Step 1: Document the best-guess logout contract.** In `deploy/openwa/README.md`, add a row to the "Pin-the-contract" table:

```markdown
| Logout / unlink | `POST /api/sessions/{session}/logout` | `{}` → 2xx on success (WAHA session logout; confirm against `/api/docs`) |
```

- [ ] **Step 2: Full backend gates**

Run: `venv\Scripts\python.exe -m pytest` then `venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .` then `venv\Scripts\mypy.exe`
Expected: pytest green; ruff clean; mypy no NEW errors vs the 47 baseline.

- [ ] **Step 3: Full frontend gates**

Run: `pnpm -C frontend exec tsc -b --noEmit` then `pnpm -C frontend test` then `pnpm -C frontend run lint`
Expected: clean/green.

- [ ] **Step 4: i18n/RTL review** — run `i18n-rtl-reviewer` over the full diff (`gateway.*` + `sendToGroup.*` + `GatewayIndicator` + `SendToGroupPage`); address findings.

- [ ] **Step 5: Whole-branch review** — use `superpowers:requesting-code-review` (opus). Verify: 4-state never collapsed; unlink gated `settings.edit` + audit row; no "falls back to SMS" on group copy; indicator renders nothing when disabled; polling stops on disabled; TTL cache + probe timeout present. Address blocking findings.

- [ ] **Step 6: Commit + merge + push**

```bash
git add deploy/openwa/README.md docs/superpowers/specs/2026-07-14-openwa-deferred-connection-ux-design.md docs/superpowers/plans/2026-07-14-openwa-deferred-connection-ux.md docs/openwa-deferred-ux-mockup.html
git commit -m "docs(openwa): deferred connection UX spec + plan + logout contract row"
```
Then merge the branch to `main`, regenerate `api.types.ts` if `main` advanced (never `checkout --ours` on `api.types.ts`), run the full suite on `main`, and `git push origin main`. Ships dormant behind `openwa_enabled`.

## Self-Review

**Spec coverage:**
- Component 1 (header indicator, 4 states, `messages.broadcast`, hidden when disabled, RTL dot) → Task 4.
- Component 2 (shared hook, 60s poll + focus, permanent stop on disabled; server TTL cache + 3s probe timeout) → Task 1 (probe timeout) + Task 2 (cache) + Task 3 (hook/`pollInterval`).
- Component 3 (admin unlink, confirm guardrail, audit-logged endpoint, best-guess dormant logout, invalidate + auto-open QR) → Task 1 (`logout()`) + Task 2 (endpoint + audit) + Task 5 (UI). README contract row → Task 6.
- Cross-cutting (bilingual parity, logical CSS, lucide, no SMS-fallback copy, type resync, gates, dormant, push to main) → Tasks 4/5 i18n steps + Task 2 resync + Task 6 gates/review.
- Delivery metrics → explicitly deferred (own future plan); no task, by design.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type consistency:** `logout()`/`cached_session_state()`/`reset_status_cache()` (T1/T2) → `GatewayUnlinkOut` (T2) → `unlinkGateway` (T5); `GatewayState` + `pollInterval` + `useGatewayStatus` defined in T3 and consumed unchanged in T3 (page) and T4 (indicator). `['gateway-status']` / `['announce-groups']` query keys match the existing page + invalidation in T5.
