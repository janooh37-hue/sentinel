# Send to Group under the WhatsApp icon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Fix the production bug where WhatsApp groups don't show on the Send-to-Group page, and (2) remove the redundant "Send to Group" top-nav tab, making the page reachable via a dropdown popover under the WhatsApp `GatewayIndicator` icon.

**Architecture:** Task 1 is a backend fix — `openwa_client.list_groups()` must parse WAHA's NOWEB dict-keyed groups response. Task 2 converts `GatewayIndicator` from a direct `NavLink` into a hand-rolled popover (mirroring `NavBellPopover`'s outside-click/Escape/focus pattern): the icon + 4-state dot is the trigger; the panel shows connection status + a "Send to Group" link. Delete the `/messages/broadcast` entry from `NAV_ITEMS`.

**Tech Stack:** FastAPI + httpx (backend), React 19, react-router-dom (`useNavigate`), TanStack Query (via the existing `useGatewayStatus` hook), Tailwind, lucide-react, react-i18next.

**Spec:** `docs/superpowers/specs/2026-07-14-send-to-group-under-icon-design.md`

## Global Constraints

- 4-state enum `disabled | unreachable | disconnected | connected` NEVER collapsed (indicator dot: connected=green, disconnected=amber-pulse, unreachable=red).
- Renders nothing when `isLoading` / no data / `state === 'disabled'`; only mounts for `messages.broadcast` holders (via `useGatewayStatus`'s `enabled`).
- Follow `NavBellPopover.tsx`'s hand-rolled popover pattern (no new popover lib): `relative` root, `absolute end-0 top-full` `role="dialog"` panel, `anim-pop-in`, outside-click + Escape close, focus into panel on open / restore to trigger on close.
- Bilingual en/ar parity; logical CSS (`end-*`, `ms-`/`me-`, `rtl:rotate-180`); lucide icons, no emoji.
- Live checkout: work in a git worktree; gates = `pytest`, `ruff`, `mypy` (backend) + `tsc`, `vitest`, `eslint` (frontend); then merge to `main` + push. Backend runs via the repo venv (worktree has none): use `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest` etc.
- WAHA NOWEB groups contract (verified live): `GET /api/{session}/groups` → 200, a JSON object keyed by group id, `{"<id>@g.us": {"id": "<id>@g.us", "subject": "<name>", ...}, ...}`. Group **name** is the `subject` field; id may also appear as an object with `_serialized`.

## File Structure

- `backend/app/services/openwa_client.py` — `list_groups()` handles WAHA's dict-keyed groups response.
- `frontend/src/components/shell/navItems.ts` — remove the `/messages/broadcast` item + unused `MessageSquare` import.
- `frontend/src/components/shell/GatewayIndicator.tsx` — rewrite as a popover.
- `frontend/src/components/shell/GatewayIndicator.test.tsx` — rewrite tests for the popover.
- `frontend/src/locales/en.json`, `ar.json` — add `gateway.indicator.menuLabel`.

---

### Task 1: Fix WhatsApp groups not showing — parse WAHA dict-keyed groups response

**Bug:** The live Send-to-Group page shows no groups even though the connected number IS in groups. Root cause: WAHA's NOWEB engine returns `GET /api/{session}/groups` as a JSON OBJECT keyed by group id (`{"<id>@g.us": {"id","subject",...}, ...}`), but `openwa_client.list_groups()` only iterates a list or `{"groups": [...]}` — a bare dict-of-groups falls through to `[]`. Verified against the live gateway (200 OK, real groups, dict-keyed; the group name is the `subject` field).

**Files:**
- Modify: `backend/app/services/openwa_client.py` (`list_groups`)
- Test: `backend/tests/test_openwa_client_groups.py`

**Interfaces:**
- `list_groups() -> list[Group]` — signature unchanged; now also parses a dict keyed by group id (values are the group objects). Existing list / `{"groups": [...]}` handling preserved.

- [ ] **Step 1: Write the failing test** (append to `backend/tests/test_openwa_client_groups.py`, mirroring `_mock` + the SimpleNamespace `get_settings` monkeypatch used by the other tests):

```python
def test_list_groups_parses_waha_dict_keyed(monkeypatch):
    # WAHA NOWEB returns groups as a dict keyed by group id (not an array); name is `subject`.
    def handler(req):
        return httpx.Response(
            200,
            json={
                "120363405495104404@g.us": {"id": "120363405495104404@g.us", "subject": "مرضيات"},
                "120363364341009448@g.us": {"id": "120363364341009448@g.us", "subject": "الغيابات"},
            },
        )

    _mock(handler)
    monkeypatch.setattr(
        wa,
        "get_settings",
        lambda: __import__("types").SimpleNamespace(
            openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"
        ),
    )
    groups = wa.list_groups()
    assert {(g.id, g.name) for g in groups} == {
        ("120363405495104404@g.us", "مرضيات"),
        ("120363364341009448@g.us", "الغيابات"),
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_openwa_client_groups.py::test_list_groups_parses_waha_dict_keyed -v`
Expected: FAIL — returns `[]` (the dict-of-groups isn't iterated).

- [ ] **Step 3: Fix `list_groups()`** — replace the `data = resp.json()...` / `rows = ...` / loop block (openwa_client.py ~136-144) with:

```python
    data = resp.json() if resp.content else []
    if isinstance(data, dict):
        # WAHA: {"groups": [...]} OR a dict keyed by group id ({"<id>@g.us": {...}}, NOWEB engine).
        inner = data.get("groups")
        rows = inner if isinstance(inner, list) else list(data.values())
    else:
        rows = data
    out: list[Group] = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        raw_id = r.get("id") or r.get("chatId") or r.get("_serialized")
        gid = raw_id.get("_serialized") if isinstance(raw_id, dict) else raw_id
        name = r.get("name") or r.get("subject") or gid
        if gid:
            out.append(Group(id=str(gid), name=str(name)))
    return out
```

- [ ] **Step 4: Run to verify pass** (new test + the existing group suite — no regression on the list / error cases)

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_openwa_client_groups.py -v`
Expected: PASS (all, including `test_list_groups_parses` and `test_list_groups_empty_on_error`).

- [ ] **Step 5: Ruff + commit**

```bash
/c/Users/Admin/sentinel/venv/Scripts/ruff.exe check backend/app/services/openwa_client.py backend/tests/test_openwa_client_groups.py
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client_groups.py
git commit -m "fix(openwa): parse WAHA NOWEB dict-keyed groups response (groups now show)"
```

---

### Task 2: Send-to-Group popover on the WhatsApp icon + remove nav tab

**Files:**
- Modify: `frontend/src/components/shell/navItems.ts`
- Modify: `frontend/src/components/shell/GatewayIndicator.tsx`
- Modify: `frontend/src/components/shell/GatewayIndicator.test.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: `useGatewayStatus({ poll: true })` → `{ data?: { state }, isLoading, dataUpdatedAt }`; `type GatewayState` (both from `@/lib/useGatewayStatus`).
- Produces: nothing consumed by other tasks (single-task plan).

- [ ] **Step 1: i18n keys (both files, parity).** Add `menuLabel` under `gateway.indicator` in each locale.

`en.json` (`gateway.indicator`):
```json
"menuLabel": "WhatsApp"
```
`ar.json` (`gateway.indicator`):
```json
"menuLabel": "واتساب"
```
(Place alongside the existing `connected`/`disconnected`/`unreachable`/`checkedAgo_*` keys.)

- [ ] **Step 2: Rewrite the failing test** — replace the body of `frontend/src/components/shell/GatewayIndicator.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { GatewayIndicator } from './GatewayIndicator'

vi.mock('@/lib/useGatewayStatus', () => ({ useGatewayStatus: vi.fn() }))
import { useGatewayStatus } from '@/lib/useGatewayStatus'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

function mockState(state: string | undefined, extra: Record<string, unknown> = {}) {
  ;(useGatewayStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
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

  it('shows a trigger with the connected dot and no open panel initially', () => {
    mockState('connected')
    renderIt()
    const trigger = screen.getByRole('button', { name: /whatsapp/i })
    expect(trigger.querySelector('[data-state="connected"]')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
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

  it('opens a panel with a Send-to-Group link that navigates to /messages/broadcast', async () => {
    mockState('connected')
    renderIt()
    await userEvent.click(screen.getByRole('button', { name: /whatsapp/i }))
    const panel = screen.getByRole('dialog')
    expect(panel).toBeInTheDocument()
    const link = screen.getByRole('button', { name: /nav\.sendToGroup|send to group/i })
    await userEvent.click(link)
    expect(navigateMock).toHaveBeenCalledWith('/messages/broadcast')
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm -C frontend exec vitest run src/components/shell/GatewayIndicator.test.tsx`
Expected: FAIL (current component is a NavLink with no `role="button"` trigger / no `role="dialog"` panel).

- [ ] **Step 4: Rewrite `GatewayIndicator.tsx`** with the popover:

```tsx
/**
 * GatewayIndicator — WhatsApp session dot + dropdown in the TopNav right cluster.
 * The trigger shows a live 4-state status dot; clicking opens a popover with the
 * connection status and a "Send to Group" link (the page's sole nav entry point).
 * Renders nothing when dormant (disabled) or the user lacks messages.broadcast.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Megaphone, MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useGatewayStatus, type GatewayState } from '@/lib/useGatewayStatus'

const DOT: Record<Exclude<GatewayState, 'disabled'>, string> = {
  connected: 'bg-green-500',
  disconnected: 'bg-amber-500 motion-safe:animate-pulse',
  unreachable: 'bg-red-500',
}

/** Plain helper — `Date.now()` is allowed outside component/hook scope. */
function secsSince(ms: number): number {
  return Math.max(0, Math.round((Date.now() - ms) / 1000))
}

export function GatewayIndicator(): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const { data, isLoading, dataUpdatedAt } = useGatewayStatus({ poll: true })
  const state = data?.state as GatewayState | undefined

  // Outside-click / Escape — mirrors NavBellPopover.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Focus into the panel on open; restore to the trigger on close.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null
      panelRef.current?.focus()
    } else if (triggerRef.current) {
      triggerRef.current.focus()
      triggerRef.current = null
    }
  }, [open])

  // Dormant, loading, or no access → render nothing (zero chrome).
  if (isLoading || !state || state === 'disabled') return null

  const label = t(`gateway.indicator.${state}`)
  const checked = t('gateway.indicator.checkedAgo', { count: secsSince(dataUpdatedAt) })

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('gateway.indicator.menuLabel')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${label} · ${checked}`}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-foreground transition-colors hover:bg-surface-tinted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <MessageCircle className="h-[1.15em] w-[1.15em]" strokeWidth={1.8} aria-hidden />
        <span
          data-state={state}
          aria-hidden
          className={`absolute bottom-1 end-1 h-2 w-2 rounded-full ring-2 ring-surface ${DOT[state]}`}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          tabIndex={-1}
          aria-label={t('gateway.indicator.menuLabel')}
          className="anim-pop-in anim-pop-in-end absolute end-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] max-w-[280px] overflow-hidden rounded-2xl border border-hairline bg-surface shadow-xl focus-visible:outline-none"
        >
          {/* Status header */}
          <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
            <span
              data-state={state}
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[state]}`}
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[0.85em] font-semibold text-foreground">{label}</span>
              <span className="text-[0.72em] text-muted-foreground">{checked}</span>
            </div>
          </div>

          {/* Send to Group link */}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              navigate('/messages/broadcast')
            }}
            className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Megaphone className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden />
            <span className="flex-1 text-[0.9em] font-medium text-foreground">
              {t('nav.sendToGroup')}
            </span>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180"
              strokeWidth={1.8}
              aria-hidden
            />
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Remove the nav tab** — in `frontend/src/components/shell/navItems.ts`, delete the line:
```ts
  { to: '/messages/broadcast', key: 'nav.sendToGroup', Icon: MessageSquare, cap: 'messages.broadcast' },
```
and remove `MessageSquare` from the `lucide-react` import (it becomes unused). Leave the other items and the `nav.sendToGroup` locale key intact (the popover still uses that key).

- [ ] **Step 6: Run to verify pass + tsc + eslint**

Run:
```
pnpm -C frontend exec vitest run src/components/shell/GatewayIndicator.test.tsx
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend exec eslint src/components/shell/GatewayIndicator.tsx src/components/shell/navItems.ts
```
Expected: test PASS; tsc clean (confirms `MessageSquare` isn't referenced elsewhere); eslint clean (no unused import).

- [ ] **Step 7: i18n review + commit** — run the `i18n-rtl-reviewer` agent over the `gateway.indicator.menuLabel` additions + `GatewayIndicator.tsx`; fix findings; then:
```bash
git add frontend/src/components/shell/GatewayIndicator.tsx frontend/src/components/shell/GatewayIndicator.test.tsx frontend/src/components/shell/navItems.ts frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(openwa): Send-to-Group under the WhatsApp icon (popover); drop nav tab"
```

---

### Task 3: Finalization — full gates + review + merge/push

- [ ] Full backend gates (Task 1 touched backend): `venv\Scripts\python.exe -m pytest`, `venv\Scripts\ruff.exe check .` (scope to touched files if pre-existing repo errors surface — 11 known non-branch ruff errors exist on main), `venv\Scripts\mypy.exe` (no NEW errors vs the 47 baseline).
- [ ] Full frontend gates: `pnpm -C frontend exec tsc -b --noEmit`, `pnpm -C frontend test` (full vitest), `pnpm -C frontend run lint`.
- [ ] `i18n-rtl-reviewer` over the diff if not already clean.
- [ ] Whole-branch review (`requesting-code-review`); address blocking findings.
- [ ] Commit the spec + plan docs. Merge to `main`, push to `origin/main`.

## Self-Review

- **Spec coverage:** nav-tab removal → Step 5. Popover (trigger + status header + Send-to-Group link, hand-rolled pattern) → Step 4. Renders-nothing-when-disabled + messages.broadcast gate + 4-state dot → Step 4 (guard + `DOT` + tests). `menuLabel` i18n → Step 1. Tests → Step 2. Accepted "no entry when disabled" consequence → inherent in the unchanged guard (no task needed). ✅
- **Placeholder scan:** complete code in every code step; exact commands with expected output. ✅
- **Type consistency:** `GatewayState`/`useGatewayStatus` consumed exactly as the shipped hook exports them; `DOT` keyed by `Exclude<GatewayState,'disabled'>` matches the render guard. `nav.sendToGroup` + `gateway.indicator.*` keys reused as-is. ✅
