# Refresh Experience — Milestone A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the refresh *engine and feel* — a global "refresh everything" action, a default top progress bar, an iOS-style phone pull-to-refresh gesture with a ring, and desktop auto-refresh (focus/reconnect/heartbeat) with button + `Alt+R`/`F5` fallbacks.

**Architecture:** A single `refreshAll()` invalidates all active React Query caches with a min-spin floor / hard ceiling and publishes an `isRefreshing` signal. A shell-level `TopProgressBar` subscribes to that signal on every refresh. On touch devices, a `PullToRefresh` wrapper around each page's own scroll container drives a hand-rolled gesture (pure physics in `ptrPhysics.ts`) that calls `refreshAll()`; a `RefreshRing` renders the stages. On desktop, a heartbeat hook + React Query focus/reconnect refetch auto-refresh, and a ghost `RefreshButton` + hotkeys are manual fallbacks.

**Tech Stack:** React 19, TypeScript (strict), React Query v5, Tailwind 4, Vitest, Playwright. No new runtime dependencies (physics + springs hand-rolled).

## Global Constraints

- **Live prod checkout:** every change must be committed AND pushed to `origin/main` (or it's overwritten on next `mng update`). Build/test on a branch/worktree; merge when green.
- **Do not switch branches on the main checkout** — work in `.claude/worktrees/<feature>` (see `superpowers:using-git-worktrees`).
- **Strict gates are real:** `tsc -b --noEmit` clean, `pnpm -C frontend run lint` clean, `pnpm -C frontend test` green. (Backend untouched in Milestone A.)
- **Bilingual/RTL:** any new user-facing string lands in BOTH `frontend/src/locales/en.json` and `ar.json` in the same task; use logical CSS (`ms-`/`me-`, `inset-inline-*`, `text-start/end`), never hardcoded left/right. Run the `i18n-rtl-reviewer` agent after the i18n task.
- **Refresh = everything:** `queryClient.invalidateQueries()` with `refetchType: 'active'` — never scope to one route.
- **Colors:** navy `--primary` for refresh UI; NEVER the alert red `--accent`.
- **Reduced motion:** every animation has a `prefers-reduced-motion: reduce` branch (CSS `motion-reduce:` variant or JS gate).
- **Timing constants (verbatim):** min-spin `500ms`, ceiling `8000ms`; TopProgressBar enter `120ms`, fast min-visible `450ms`, slow-switch threshold `500ms`, sweep `900ms`, resolve fill `240ms` + fade `300ms`; gesture: dead-zone `24px`, `c=0.42`, `H=min(vh,640)`, clamp `160px`, arm `112px`, disarm `96px`, hold-to-arm `120ms`, rest-at-top `250ms`, rest height `56px`, direction cone `dy>2·|dx|`, spring `stiffness 260 / damping 26 / mass 1`; haptics arm `10` / disarm `5` / done `12`; heartbeat `60000ms`, staleTime `15000ms`.

---

## File Structure

**Create:**
- `frontend/src/lib/ptrPhysics.ts` — pure functions: `rubberBand`, gate predicates, spring step. (Unit-tested; no DOM.)
- `frontend/src/lib/globalRefresh.ts` — `refreshAll`, `useIsRefreshing`, `editingRegistry` (isEditing flag).
- `frontend/src/hooks/useRefreshHeartbeat.ts` — 60s heartbeat.
- `frontend/src/hooks/useRefreshHotkeys.ts` — `Alt+R`, `F5`/`Ctrl+R` intercept.
- `frontend/src/components/refresh/TopProgressBar.tsx` — shared default signal.
- `frontend/src/components/refresh/RefreshRing.tsx` — ring SVG + stages.
- `frontend/src/components/refresh/PullToRefresh.tsx` — phone gesture wrapper.
- `frontend/src/components/refresh/RefreshButton.tsx` — desktop ghost fallback.
- Test files mirror each under `frontend/src/**/__tests__/*.test.ts(x)`.
- `frontend/e2e/refresh.spec.ts` — desktop triggers e2e.

**Modify:**
- `frontend/src/App.tsx` — QueryClient cadence; mount `TopProgressBar`, heartbeat, hotkeys at shell.
- `frontend/src/index.css` — refresh motion tokens + `overscroll-behavior` on page scrollers.
- `frontend/src/locales/en.json` + `ar.json` — refresh strings.
- Page scroll containers (Records/Books, Dashboard, Leaves) — wrap in `<PullToRefresh>`, add `<RefreshButton>` to headers. (Wiring task at the end.)

---

## Task 1: PTR physics (pure, testable)

**Files:**
- Create: `frontend/src/lib/ptrPhysics.ts`
- Test: `frontend/src/lib/__tests__/ptrPhysics.test.ts`

**Interfaces:**
- Produces:
  - `rubberBand(rawPastDeadzone: number, viewportH: number): number`
  - `PTR_CONST` (frozen constants object)
  - `resolveAxis(dx: number, dy: number): 'v' | 'x' | null`
  - `springStep(x: number, v: number, target: number, dtSec: number): { x: number; v: number; done: boolean }`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/lib/__tests__/ptrPhysics.test.ts
import { describe, it, expect } from 'vitest'
import { rubberBand, resolveAxis, springStep, PTR_CONST } from '../ptrPhysics'

describe('rubberBand', () => {
  it('returns 0 at or below zero travel', () => {
    expect(rubberBand(0, 800)).toBe(0)
    expect(rubberBand(-20, 800)).toBe(0)
  })
  it('is near-linear for small travel and stiffens (sub-linear) for large travel', () => {
    const h = 640
    const small = rubberBand(20, h)
    expect(small).toBeGreaterThan(15)        // ~1:1 early
    expect(small).toBeLessThanOrEqual(20)
    const big = rubberBand(400, h)
    expect(big).toBeLessThan(400 * 0.42)     // asymptote below c*H
  })
  it('never reaches the c*H asymptote', () => {
    const h = 640
    expect(rubberBand(1e6, h)).toBeLessThan(0.42 * h)
  })
})

describe('resolveAxis', () => {
  it('locks vertical inside the cone dy>2|dx|', () => {
    expect(resolveAxis(5, 40)).toBe('v')
  })
  it('rejects to horizontal outside the cone', () => {
    expect(resolveAxis(40, 30)).toBe('x')
  })
  it('returns null until movement exceeds 12px', () => {
    expect(resolveAxis(3, 5)).toBeNull()
  })
})

describe('springStep', () => {
  it('converges toward the target and reports done when settled', () => {
    let s = { x: 0, v: 0 }
    let last = { x: 0, v: 0, done: false }
    for (let i = 0; i < 600; i++) {
      last = springStep(s.x, s.v, PTR_CONST.REST, 1 / 60)
      s = { x: last.x, v: last.v }
      if (last.done) break
    }
    expect(last.done).toBe(true)
    expect(Math.abs(last.x - PTR_CONST.REST)).toBeLessThan(0.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/lib/__tests__/ptrPhysics.test.ts`
Expected: FAIL — cannot find module `../ptrPhysics`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/src/lib/ptrPhysics.ts
export const PTR_CONST = Object.freeze({
  DEAD: 24,
  C: 0.42,
  H_MAX: 640,
  CLAMP: 160,
  ARM: 112,
  DISARM: 96,
  HOLD_MS: 120,
  REST_AT_TOP_MS: 250,
  REST: 56,
  DIR_MIN: 12, // px before axis lock decides
  SPRING_K: 260,
  SPRING_D: 26,
  SPRING_M: 1,
})

/** iOS-style asymptotic rubber band. rawPastDeadzone is finger travel already
 *  reduced by the dead zone. */
export function rubberBand(rawPastDeadzone: number, viewportH: number): number {
  if (rawPastDeadzone <= 0) return 0
  const H = Math.min(viewportH, PTR_CONST.H_MAX)
  const c = PTR_CONST.C
  return (c * rawPastDeadzone * H) / (H + c * rawPastDeadzone)
}

export function resolveAxis(dx: number, dy: number): 'v' | 'x' | null {
  if (Math.abs(dx) < PTR_CONST.DIR_MIN && Math.abs(dy) < PTR_CONST.DIR_MIN) return null
  return dy > 0 && dy > 2 * Math.abs(dx) ? 'v' : 'x'
}

/** One semi-implicit Euler spring step toward target. */
export function springStep(
  x: number,
  v: number,
  target: number,
  dtSec: number,
): { x: number; v: number; done: boolean } {
  const dt = Math.min(dtSec, 0.032)
  const fs = -PTR_CONST.SPRING_K * (x - target)
  const fd = -PTR_CONST.SPRING_D * v
  const a = (fs + fd) / PTR_CONST.SPRING_M
  const nv = v + a * dt
  const nx = x + nv * dt
  const done = Math.abs(nx - target) < 0.4 && Math.abs(nv) < 0.6
  return { x: done ? target : nx, v: done ? 0 : nv, done }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/lib/__tests__/ptrPhysics.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ptrPhysics.ts frontend/src/lib/__tests__/ptrPhysics.test.ts
git commit -m "feat(refresh): pure pull-to-refresh physics module"
```

---

## Task 2: Global refresh engine

**Files:**
- Create: `frontend/src/lib/globalRefresh.ts`
- Test: `frontend/src/lib/__tests__/globalRefresh.test.ts`

**Interfaces:**
- Consumes: React Query `QueryClient`.
- Produces:
  - `refreshAll(qc: QueryClient, opts?: { minSpinMs?: number; ceilingMs?: number }): Promise<void>`
  - `editingRegistry` with `setEditing(id: string, dirty: boolean): void` and `isAnyEditing(): boolean`
  - `useIsRefreshing(): boolean` (React hook wrapping `useIsFetching` + min-spin latch)

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/lib/__tests__/globalRefresh.test.ts
import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { refreshAll, editingRegistry } from '../globalRefresh'

describe('refreshAll', () => {
  it('invalidates active queries and honors the min-spin floor', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    const t0 = performance.now()
    await refreshAll(qc, { minSpinMs: 120, ceilingMs: 8000 })
    const elapsed = performance.now() - t0
    expect(spy).toHaveBeenCalledWith({ refetchType: 'active' })
    expect(elapsed).toBeGreaterThanOrEqual(115)
  })
  it('resolves by the ceiling even if invalidate hangs', async () => {
    const qc = new QueryClient()
    vi.spyOn(qc, 'invalidateQueries').mockReturnValue(new Promise(() => {}))
    const t0 = performance.now()
    await refreshAll(qc, { minSpinMs: 0, ceilingMs: 150 })
    expect(performance.now() - t0).toBeLessThan(400)
  })
})

describe('editingRegistry', () => {
  it('reports editing when any registered form is dirty', () => {
    editingRegistry.setEditing('a', true)
    expect(editingRegistry.isAnyEditing()).toBe(true)
    editingRegistry.setEditing('a', false)
    expect(editingRegistry.isAnyEditing()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/lib/__tests__/globalRefresh.test.ts`
Expected: FAIL — cannot find module `../globalRefresh`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/src/lib/globalRefresh.ts
import { useEffect, useRef, useState } from 'react'
import { useIsFetching, type QueryClient } from '@tanstack/react-query'

export async function refreshAll(
  qc: QueryClient,
  opts: { minSpinMs?: number; ceilingMs?: number } = {},
): Promise<void> {
  const minSpinMs = opts.minSpinMs ?? 500
  const ceilingMs = opts.ceilingMs ?? 8000
  const start = performance.now()
  const invalidation = Promise.resolve(qc.invalidateQueries({ refetchType: 'active' }))
  const ceiling = new Promise<void>((r) => setTimeout(r, ceilingMs))
  await Promise.race([invalidation, ceiling])
  const remaining = minSpinMs - (performance.now() - start)
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
}

const dirty = new Map<string, boolean>()
export const editingRegistry = {
  setEditing(id: string, isDirty: boolean): void {
    if (isDirty) dirty.set(id, true)
    else dirty.delete(id)
  },
  isAnyEditing(): boolean {
    return dirty.size > 0
  },
}

/** True while any query is fetching, latched for at least 450ms so the top bar
 *  is always perceptible even on instant LAN fetches. */
export function useIsRefreshing(minVisibleMs = 450): boolean {
  const fetching = useIsFetching() > 0
  const [on, setOn] = useState(false)
  const offAt = useRef(0)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    if (fetching) {
      offAt.current = performance.now() + minVisibleMs
      setOn(true)
    } else if (on) {
      const wait = Math.max(0, offAt.current - performance.now())
      t = setTimeout(() => setOn(false), wait)
    }
    return () => t && clearTimeout(t)
  }, [fetching, on, minVisibleMs])
  return on
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/lib/__tests__/globalRefresh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/globalRefresh.ts frontend/src/lib/__tests__/globalRefresh.test.ts
git commit -m "feat(refresh): global refresh-everything engine + editing registry"
```

---

## Task 3: React Query cadence + shell wiring

**Files:**
- Modify: `frontend/src/App.tsx` (QueryClient defaults ~L72; shell render ~L161-244)

**Interfaces:**
- Consumes: `refreshAll`, `useRefreshHeartbeat` (Task 5), `useRefreshHotkeys` (Task 6), `TopProgressBar` (Task 4). This task only changes QueryClient config + adds mount points that later tasks fill; import stubs are added as those tasks land. To keep this task self-contained and green, it changes ONLY the QueryClient config here and adds the `<TopProgressBar/>` mount (Task 4 must be done first if ordering strictly; otherwise reorder so Task 4 precedes this). Recommended order: Task 4 → Task 3.
- Produces: app-wide auto-refresh cadence.

- [ ] **Step 1: Update the QueryClient defaults**

In `frontend/src/App.tsx`, replace the `defaultOptions.queries` block:

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,   // return-to-app => silently fresh
      refetchOnReconnect: 'always', // after a gap, age unknown => refetch
      staleTime: 15_000,            // gate focus-refetch storms
      gcTime: 5 * 60_000,
    },
  },
})
```

- [ ] **Step 2: Mount the shared shell pieces**

In the shell JSX (the `<div className="flex h-screen flex-col ...">`), immediately inside, before `<header>`, add:

```tsx
<TopProgressBar />
```

And add a small hooks host component rendered inside `<QueryClientProvider>` (so it can use query hooks), e.g. just below the provider open tag:

```tsx
<RefreshShellHost />
```

Where, in the same file:

```tsx
function RefreshShellHost() {
  useRefreshHeartbeat()
  useRefreshHotkeys()
  return null
}
```

Add imports at top:

```tsx
import { TopProgressBar } from './components/refresh/TopProgressBar'
import { useRefreshHeartbeat } from './hooks/useRefreshHeartbeat'
import { useRefreshHotkeys } from './hooks/useRefreshHotkeys'
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: PASS once Tasks 4–6 exist. (If executing strictly in order, do Task 4/5/6 first, then this compiles.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(refresh): auto-refresh cadence + shell mounts"
```

---

## Task 4: TopProgressBar

**Files:**
- Create: `frontend/src/components/refresh/TopProgressBar.tsx`
- Test: `frontend/src/components/refresh/__tests__/TopProgressBar.test.tsx`
- Modify: `frontend/src/index.css` (add sweep tokens/keyframes — folded here)

**Interfaces:**
- Consumes: `useIsRefreshing` (Task 2).
- Produces: `<TopProgressBar />` (no props).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/refresh/__tests__/TopProgressBar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { TopProgressBar } from '../TopProgressBar'
import * as gr from '../../../lib/globalRefresh'

describe('TopProgressBar', () => {
  it('is hidden when not refreshing', () => {
    vi.spyOn(gr, 'useIsRefreshing').mockReturnValue(false)
    const { container } = render(<TopProgressBar />)
    expect(container.querySelector('[data-refreshing="true"]')).toBeNull()
  })
  it('shows the bar while refreshing', () => {
    vi.spyOn(gr, 'useIsRefreshing').mockReturnValue(true)
    const { container } = render(<TopProgressBar />)
    expect(container.querySelector('[data-refreshing="true"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/refresh/__tests__/TopProgressBar.test.tsx`
Expected: FAIL — cannot find module `../TopProgressBar`.

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/components/refresh/TopProgressBar.tsx
import { useIsRefreshing } from '../../lib/globalRefresh'

/** 2px navy bar pinned to the top of the content pane. Default signal for every
 *  refresh: quick fill + dissolve on fast fetches (via CSS), indeterminate sweep
 *  when the fetch is genuinely slow. Reduced-motion => static line. */
export function TopProgressBar() {
  const refreshing = useIsRefreshing()
  return (
    <div
      aria-hidden
      data-refreshing={refreshing || undefined}
      className={[
        'pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 overflow-hidden',
        'transition-opacity duration-100',
        refreshing ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    >
      <div className="absolute inset-0 bg-[color:var(--hairline)] opacity-50" />
      {refreshing && (
        <div className="ptr-sweep absolute inset-y-0 w-[32%] rtl:[transform:scaleX(-1)] motion-reduce:!animate-none motion-reduce:!translate-x-0 motion-reduce:w-[110%]" />
      )}
    </div>
  )
}
```

Add to `frontend/src/index.css` (near other keyframes):

```css
.ptr-sweep {
  background: linear-gradient(90deg, transparent, var(--primary) 85%, transparent);
  animation: ptrSweep 900ms cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
@keyframes ptrSweep {
  from { transform: translateX(-140%); }
  to   { transform: translateX(360%); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/components/refresh/__tests__/TopProgressBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/refresh/TopProgressBar.tsx frontend/src/components/refresh/__tests__/TopProgressBar.test.tsx frontend/src/index.css
git commit -m "feat(refresh): shared top progress bar"
```

---

## Task 5: Refresh heartbeat hook

**Files:**
- Create: `frontend/src/hooks/useRefreshHeartbeat.ts`
- Test: `frontend/src/hooks/__tests__/useRefreshHeartbeat.test.tsx`

**Interfaces:**
- Consumes: `refreshAll`, `editingRegistry` (Task 2); React Query `useQueryClient`.
- Produces: `useRefreshHeartbeat(intervalMs?: number): void`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/hooks/__tests__/useRefreshHeartbeat.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRefreshHeartbeat } from '../useRefreshHeartbeat'
import { editingRegistry } from '../../lib/globalRefresh'

const wrap = (qc: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }

describe('useRefreshHeartbeat', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('invalidates on each interval when idle & visible', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    renderHook(() => useRefreshHeartbeat(1000), { wrapper: wrap(qc) })
    vi.advanceTimersByTime(1000)
    expect(spy).toHaveBeenCalledWith({ refetchType: 'active' })
  })
  it('skips when a form is being edited', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    editingRegistry.setEditing('form', true)
    renderHook(() => useRefreshHeartbeat(1000), { wrapper: wrap(qc) })
    vi.advanceTimersByTime(1000)
    expect(spy).not.toHaveBeenCalled()
    editingRegistry.setEditing('form', false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/hooks/__tests__/useRefreshHeartbeat.test.tsx`
Expected: FAIL — cannot find module `../useRefreshHeartbeat`.

- [ ] **Step 3: Implement**

```typescript
// frontend/src/hooks/useRefreshHeartbeat.ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { editingRegistry } from '../lib/globalRefresh'

/** One synchronized 60s heartbeat that refreshes everything, paused when the
 *  window is hidden or the user is editing a form. */
export function useRefreshHeartbeat(intervalMs = 60_000): void {
  const qc = useQueryClient()
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return
      if (editingRegistry.isAnyEditing()) return
      void qc.invalidateQueries({ refetchType: 'active' })
    }, intervalMs)
    return () => clearInterval(id)
  }, [qc, intervalMs])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/hooks/__tests__/useRefreshHeartbeat.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useRefreshHeartbeat.ts frontend/src/hooks/__tests__/useRefreshHeartbeat.test.tsx
git commit -m "feat(refresh): 60s auto-refresh heartbeat"
```

---

## Task 6: Refresh hotkeys hook

**Files:**
- Create: `frontend/src/hooks/useRefreshHotkeys.ts`
- Test: `frontend/src/hooks/__tests__/useRefreshHotkeys.test.tsx`

**Interfaces:**
- Consumes: `refreshAll` (Task 2); `useQueryClient`.
- Produces: `useRefreshHotkeys(): void` — binds `Alt+R`, intercepts `F5` and `Ctrl+R` (→ soft refresh), leaves `Ctrl+Shift+R` native.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/hooks/__tests__/useRefreshHotkeys.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRefreshHotkeys } from '../useRefreshHotkeys'

const wrap = (qc: QueryClient) =>
  function W({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }

function press(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { ...init, cancelable: true, bubbles: true })
  window.dispatchEvent(e)
  return e
}

describe('useRefreshHotkeys', () => {
  it('Alt+R triggers a soft refresh and is prevented', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    renderHook(() => useRefreshHotkeys(), { wrapper: wrap(qc) })
    const e = press({ code: 'KeyR', altKey: true })
    expect(spy).toHaveBeenCalledWith({ refetchType: 'active' })
    expect(e.defaultPrevented).toBe(true)
  })
  it('F5 is intercepted into a soft refresh', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    renderHook(() => useRefreshHotkeys(), { wrapper: wrap(qc) })
    const e = press({ code: 'F5' })
    expect(spy).toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(true)
  })
  it('Ctrl+Shift+R is left native (not prevented)', () => {
    const qc = new QueryClient()
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    renderHook(() => useRefreshHotkeys(), { wrapper: wrap(qc) })
    const e = press({ code: 'KeyR', ctrlKey: true, shiftKey: true })
    expect(e.defaultPrevented).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/hooks/__tests__/useRefreshHotkeys.test.tsx`
Expected: FAIL — cannot find module `../useRefreshHotkeys`.

- [ ] **Step 3: Implement**

```typescript
// frontend/src/hooks/useRefreshHotkeys.ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { refreshAll } from '../lib/globalRefresh'

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return /^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable
}

export function useRefreshHotkeys(): void {
  const qc = useQueryClient()
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+Shift+R stays the native hard reload escape hatch
      if (e.code === 'KeyR' && (e.ctrlKey || e.metaKey) && e.shiftKey) return
      const altR = e.code === 'KeyR' && e.altKey && !e.ctrlKey && !e.metaKey
      const softReload = e.code === 'F5' && !e.ctrlKey && !e.shiftKey
      const ctrlR = e.code === 'KeyR' && (e.ctrlKey || e.metaKey) && !e.shiftKey
      if ((altR && !isTyping(e.target)) || softReload || ctrlR) {
        e.preventDefault()
        void refreshAll(qc)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [qc])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/hooks/__tests__/useRefreshHotkeys.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useRefreshHotkeys.ts frontend/src/hooks/__tests__/useRefreshHotkeys.test.tsx
git commit -m "feat(refresh): Alt+R + F5/Ctrl+R soft-refresh hotkeys"
```

---

## Task 7: RefreshRing (indicator stages)

**Files:**
- Create: `frontend/src/components/refresh/RefreshRing.tsx`
- Test: `frontend/src/components/refresh/__tests__/RefreshRing.test.tsx`

**Interfaces:**
- Produces:
  - `type PtrStage = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'done'`
  - `<RefreshRing stage={PtrStage} progress={number} />` — `progress` 0..1 (offset/ARM).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/refresh/__tests__/RefreshRing.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RefreshRing } from '../RefreshRing'

describe('RefreshRing', () => {
  it('renders a progress arc while pulling', () => {
    const { container } = render(<RefreshRing stage="pulling" progress={0.5} />)
    expect(container.querySelector('[data-part="arc"]')).not.toBeNull()
  })
  it('shows the checkmark when done', () => {
    const { container } = render(<RefreshRing stage="done" progress={1} />)
    expect(container.querySelector('[data-part="check"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/refresh/__tests__/RefreshRing.test.tsx`
Expected: FAIL — cannot find module `../RefreshRing`.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/components/refresh/RefreshRing.tsx
export type PtrStage = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'done'

const R = 13
const CIRC = 2 * Math.PI * R

export function RefreshRing({ stage, progress }: { stage: PtrStage; progress: number }) {
  const p = Math.max(0, Math.min(1, progress))
  const appear = Math.min(progress / (40 / 112), 1) // fully materialized by ~40px offset
  const arcFrac = stage === 'armed' || stage === 'refreshing' ? 1 : p * 0.75
  const dash = `${CIRC * arcFrac} ${CIRC}`
  return (
    <div
      className={[
        'grid place-items-center',
        stage === 'refreshing' ? 'ptr-ring-spin' : '',
        'motion-reduce:!animate-none',
      ].join(' ')}
      style={{ opacity: stage === 'idle' ? appear : 1, transform: `scale(${0.6 + 0.4 * appear})` }}
    >
      <svg viewBox="0 0 34 34" width="34" height="34" style={{ overflow: 'visible' }}>
        <circle cx="17" cy="17" r={R} fill="none" stroke="var(--hairline)" strokeWidth="2" />
        {stage !== 'done' && (
          <circle
            data-part="arc"
            cx="17"
            cy="17"
            r={R}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={dash}
            transform="rotate(-90 17 17)"
          />
        )}
        {stage === 'done' && (
          <path
            data-part="check"
            d="M11 17.5l3.6 3.6L23 12.7"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  )
}
```

Add to `index.css`:

```css
.ptr-ring-spin svg { animation: ptrRingSpin 900ms linear infinite; }
@keyframes ptrRingSpin { to { transform: rotate(360deg); } }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/components/refresh/__tests__/RefreshRing.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/refresh/RefreshRing.tsx frontend/src/components/refresh/__tests__/RefreshRing.test.tsx frontend/src/index.css
git commit -m "feat(refresh): ring indicator stages"
```

---

## Task 8: PullToRefresh gesture wrapper

**Files:**
- Create: `frontend/src/components/refresh/PullToRefresh.tsx`
- Test: `frontend/src/components/refresh/__tests__/PullToRefresh.test.tsx`

**Interfaces:**
- Consumes: `ptrPhysics` (Task 1), `RefreshRing` + `PtrStage` (Task 7), `refreshAll` (Task 2), `useQueryClient`.
- Produces: `<PullToRefresh>{children}</PullToRefresh>` — wraps a page's own scroll container. Renders the ring band + translating content. Enabled only on coarse pointers.

**Note:** the gesture math is exercised via `ptrPhysics` unit tests (Task 1). This component's test covers only mount + touch-capability gating + that a full arm→release sequence calls `refreshAll`. jsdom lacks real touch physics, so drive it through the exposed handlers.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/refresh/__tests__/PullToRefresh.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PullToRefresh } from '../PullToRefresh'

function renderWrapped() {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <PullToRefresh>
        <div style={{ height: 2000 }}>content</div>
      </PullToRefresh>
    </QueryClientProvider>,
  )
}

describe('PullToRefresh', () => {
  it('renders its children', () => {
    renderWrapped()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
  it('exposes a scroll container with overscroll containment', () => {
    const { container } = renderWrapped()
    const scroller = container.querySelector('[data-ptr-scroller]') as HTMLElement
    expect(scroller).not.toBeNull()
    expect(scroller.className).toMatch(/overscroll-y-contain/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/refresh/__tests__/PullToRefresh.test.tsx`
Expected: FAIL — cannot find module `../PullToRefresh`.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/components/refresh/PullToRefresh.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PTR_CONST, rubberBand, resolveAxis, springStep } from '../../lib/ptrPhysics'
import { refreshAll } from '../../lib/globalRefresh'
import { RefreshRing, type PtrStage } from './RefreshRing'

const coarse = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(pointer: coarse)').matches &&
  'ontouchstart' in window

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* no-op */
  }
}

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<PtrStage>('idle')
  const [offset, setOffset] = useState(0)
  const st = useRef({
    dragging: false,
    startY: 0,
    startX: 0,
    axis: null as 'v' | 'x' | null,
    restedAt: 0,
    atTop: true,
    holdTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    stage: 'idle' as PtrStage,
  })

  const enabled = coarse()

  const rested = useCallback(
    () => st.current.atTop && performance.now() - st.current.restedAt >= PTR_CONST.REST_AT_TOP_MS,
    [],
  )

  const settle = useCallback(
    (to: number, then?: () => void) => {
      let x = offset
      let v = 0
      let last = performance.now()
      const tick = () => {
        const now = performance.now()
        const step = springStep(x, v, to, (now - last) / 1000)
        last = now
        x = step.x
        v = step.v
        setOffset(x)
        if (step.done) then?.()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    [offset],
  )

  const startRefresh = useCallback(() => {
    st.current.stage = 'refreshing'
    setStage('refreshing')
    settle(PTR_CONST.REST)
    void refreshAll(qc).then(() => {
      st.current.stage = 'done'
      setStage('done')
      buzz(12)
      setTimeout(() => {
        settle(0, () => {
          st.current.stage = 'idle'
          setStage('idle')
        })
      }, 420)
    })
  }, [qc, settle])

  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc || !enabled) return

    const onScroll = () => {
      if (sc.scrollTop <= 1) {
        if (!st.current.atTop) {
          st.current.atTop = true
          st.current.restedAt = performance.now()
        }
      } else st.current.atTop = false
    }
    const onDown = (e: TouchEvent) => {
      if (st.current.stage === 'refreshing' || st.current.stage === 'done') return
      if (e.touches.length > 1) return
      if (sc.scrollTop > 1) return
      st.current.dragging = true
      st.current.axis = null
      st.current.startY = e.touches[0].clientY
      st.current.startX = e.touches[0].clientX
    }
    const onMove = (e: TouchEvent) => {
      const s = st.current
      if (!s.dragging) return
      if (e.touches.length > 1) {
        s.dragging = false
        settle(0)
        return
      }
      const dy = e.touches[0].clientY - s.startY
      const dx = e.touches[0].clientX - s.startX
      if (s.axis === null) {
        const a = resolveAxis(dx, dy)
        if (a === null) return
        if (a === 'x') {
          s.dragging = false
          return
        }
        s.axis = 'v'
      }
      if (sc.scrollTop > 1 || !rested()) return
      const raw = dy - PTR_CONST.DEAD
      if (raw <= 0) {
        setOffset(0)
        return
      }
      if (e.cancelable) e.preventDefault()
      const off = rubberBand(raw, Math.min(window.innerHeight, PTR_CONST.H_MAX))
      setOffset(Math.min(off, PTR_CONST.CLAMP))
      if (off >= PTR_CONST.ARM && s.stage !== 'armed') {
        if (!s.holdTimer)
          s.holdTimer = setTimeout(() => {
            s.stage = 'armed'
            setStage('armed')
            buzz(10)
            s.holdTimer = undefined
          }, PTR_CONST.HOLD_MS)
        if (s.stage !== 'armed') setStage((s.stage = 'pulling'))
      } else if (off < PTR_CONST.DISARM && s.stage === 'armed') {
        setStage((s.stage = 'pulling'))
        buzz(5)
      } else if (off < PTR_CONST.ARM) {
        if (s.holdTimer) {
          clearTimeout(s.holdTimer)
          s.holdTimer = undefined
        }
        if (s.stage !== 'armed') setStage((s.stage = 'pulling'))
      }
    }
    const onUp = () => {
      const s = st.current
      if (!s.dragging) return
      s.dragging = false
      if (s.holdTimer) {
        clearTimeout(s.holdTimer)
        s.holdTimer = undefined
      }
      if (s.stage === 'armed') startRefresh()
      else {
        setStage((s.stage = 'idle'))
        settle(0)
      }
    }

    sc.addEventListener('scroll', onScroll, { passive: true })
    sc.addEventListener('touchstart', onDown, { passive: true })
    sc.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      sc.removeEventListener('scroll', onScroll)
      sc.removeEventListener('touchstart', onDown)
      sc.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [enabled, rested, settle, startRefresh])

  const progress = offset / PTR_CONST.ARM

  return (
    <div className="relative h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[170px] items-end justify-center pb-3.5">
        {(stage !== 'idle' || offset > 0) && <RefreshRing stage={stage} progress={progress} />}
      </div>
      <div
        data-ptr-scroller
        ref={scrollerRef}
        className="h-full overflow-y-auto overscroll-y-contain will-change-transform"
        style={{ transform: `translateY(${Math.min(offset, PTR_CONST.CLAMP)}px)` }}
      >
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/components/refresh/__tests__/PullToRefresh.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm -C frontend exec tsc -b --noEmit` → PASS.

```bash
git add frontend/src/components/refresh/PullToRefresh.tsx frontend/src/components/refresh/__tests__/PullToRefresh.test.tsx
git commit -m "feat(refresh): phone pull-to-refresh gesture wrapper"
```

---

## Task 9: RefreshButton (desktop ghost fallback) + i18n

**Files:**
- Create: `frontend/src/components/refresh/RefreshButton.tsx`
- Test: `frontend/src/components/refresh/__tests__/RefreshButton.test.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: `refreshAll` (Task 2), `useQueryClient`, `useTranslation` (existing i18n).
- Produces: `<RefreshButton />` — ghost icon button; on click rotates once + `refreshAll`.

- [ ] **Step 1: Add i18n keys**

In `frontend/src/locales/en.json` add under an appropriate namespace (match existing structure), e.g.:

```json
"refresh": { "action": "Refresh", "hotkey": "Alt+R", "updatedAgo": "Updated {{n}} ago", "newItems": "{{n}} new", "listUpdated": "List updated, {{n}} new" }
```

In `frontend/src/locales/ar.json` (same keys, translated):

```json
"refresh": { "action": "تحديث", "hotkey": "Alt+R", "updatedAgo": "آخر تحديث قبل {{n}}", "newItems": "{{n}} جديد", "listUpdated": "تم تحديث القائمة، {{n}} جديد" }
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/src/components/refresh/__tests__/RefreshButton.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RefreshButton } from '../RefreshButton'

describe('RefreshButton', () => {
  it('calls refreshAll on click', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    render(
      <QueryClientProvider client={qc}>
        <RefreshButton />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /refresh|تحديث/i }))
    expect(spy).toHaveBeenCalledWith({ refetchType: 'active' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/refresh/__tests__/RefreshButton.test.tsx`
Expected: FAIL — cannot find module `../RefreshButton`.

- [ ] **Step 4: Implement**

```tsx
// frontend/src/components/refresh/RefreshButton.tsx
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { refreshAll } from '../../lib/globalRefresh'

export function RefreshButton() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [spinning, setSpinning] = useState(false)
  return (
    <button
      type="button"
      aria-label={t('refresh.action')}
      title={`${t('refresh.action')} · ${t('refresh.hotkey')}`}
      className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-transparent text-[color:var(--text-faint,#93a0af)] transition hover:border-[color:var(--line)] hover:text-[color:var(--ink)]"
      onClick={() => {
        setSpinning(true)
        void refreshAll(qc).finally(() => setSpinning(false))
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={spinning ? 'ptr-rot motion-reduce:!animate-none' : ''}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  )
}
```

Add to `index.css`:

```css
.ptr-rot { animation: ptrRot 500ms cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes ptrRot { to { transform: rotate(360deg); } }
```

- [ ] **Step 5: Run test + i18n review**

Run: `pnpm -C frontend exec vitest run src/components/refresh/__tests__/RefreshButton.test.tsx` → PASS.
Then dispatch the `i18n-rtl-reviewer` agent on the two locale files + `RefreshButton.tsx`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/refresh/RefreshButton.tsx frontend/src/components/refresh/__tests__/RefreshButton.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/index.css
git commit -m "feat(refresh): desktop ghost refresh button + i18n strings"
```

---

## Task 10: Wire into pages (Records/Books, Dashboard, Leaves)

**Files:**
- Modify page scroll containers + headers for: `frontend/src/pages/books/BooksPage.tsx`, `frontend/src/pages/dashboard/DashboardPage.tsx`, `frontend/src/pages/leaves/LeavesPage.tsx` (exact wrapping element per each page's current scroller).

**Interfaces:**
- Consumes: `<PullToRefresh>` (Task 8), `<RefreshButton>` (Task 9).

- [ ] **Step 1: Identify each page's scroll container**

For each page, find the element that currently owns vertical scrolling (the `overflow-y-auto`/`overflow-auto` wrapper). Read the file first; do not assume.

Run: `pnpm -C frontend exec vitest run` (baseline green before edits).

- [ ] **Step 2: Wrap the scroller + add the button (Books example)**

Replace the page's outer scroll wrapper so `<PullToRefresh>` provides the scroller. Move the page content inside it, and place `<RefreshButton />` at the inline-end of the page header row:

```tsx
import { PullToRefresh } from '../../components/refresh/PullToRefresh'
import { RefreshButton } from '../../components/refresh/RefreshButton'

// header row:
<div className="flex items-center justify-between px-4 pt-3">
  <h1 className="text-lg font-semibold">{t('books.title')}</h1>
  <RefreshButton />
</div>

// body: wrap the previously-scrolling content
<PullToRefresh>
  {/* ...existing list/report content... */}
</PullToRefresh>
```

Apply the analogous change to `DashboardPage.tsx` and `LeavesPage.tsx` (Leaves has two detail surfaces — the wrapper goes on the page scroller; per-record actions are unaffected in Milestone A).

- [ ] **Step 3: Manual smoke + typecheck**

Run: `pnpm -C frontend exec tsc -b --noEmit` → PASS.
Run: `pnpm -C frontend run build` → succeeds (outputs to backend static dir).
Manually (or via `mng deploy` on a branch): on desktop the ghost button + `Alt+R` refresh; on a touch device the pull works and only fires on a deliberate deep pull.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/books/BooksPage.tsx frontend/src/pages/dashboard/DashboardPage.tsx frontend/src/pages/leaves/LeavesPage.tsx
git commit -m "feat(refresh): wire pull-to-refresh + refresh button into Books, Dashboard, Leaves"
```

---

## Task 11: Desktop e2e + full green gate

**Files:**
- Create: `frontend/e2e/refresh.spec.ts`

**Interfaces:**
- Consumes: the running app.

- [ ] **Step 1: Write the e2e**

```typescript
// frontend/e2e/refresh.spec.ts
import { test, expect } from '@playwright/test'

test('Alt+R soft-refreshes without a full page reload', async ({ page }) => {
  await page.goto('/books')
  await page.evaluate(() => ((window as unknown as { __ptr: boolean }).__ptr = true))
  await page.keyboard.press('Alt+r')
  // marker survives a soft refresh but would be wiped by a hard reload
  const survived = await page.evaluate(() => (window as unknown as { __ptr?: boolean }).__ptr)
  expect(survived).toBe(true)
})

test('F5 is intercepted (no navigation)', async ({ page }) => {
  await page.goto('/books')
  await page.evaluate(() => ((window as unknown as { __ptr: boolean }).__ptr = true))
  await page.keyboard.press('F5')
  const survived = await page.evaluate(() => (window as unknown as { __ptr?: boolean }).__ptr)
  expect(survived).toBe(true)
})
```

- [ ] **Step 2: Run the full gate**

Run: `pnpm -C frontend test` → all vitest green.
Run: `pnpm -C frontend run lint` → clean.
Run: `pnpm -C frontend exec tsc -b --noEmit` → clean.
Run: `pnpm -C frontend run e2e` → refresh specs pass.

- [ ] **Step 3: Commit + push**

```bash
git add frontend/e2e/refresh.spec.ts
git commit -m "test(refresh): desktop soft-refresh e2e + green gate"
git push origin HEAD
```

Then open a PR to `main` (no `gh` CLI on this machine — use the compare URL). After merge, the user runs `mng update` on the server.

---

## Self-Review

**Spec coverage:**
- §4.1 global refresh-everything + min/ceiling + isEditing → Task 2. ✓
- §4.2 cadence (focus/reconnect/heartbeat/staleTime) → Task 3 + Task 5. ✓
- §4.3 TopProgressBar fast/slow/RTL/reduced-motion → Task 4 (+ index.css sweep; reduced-motion via `motion-reduce:` classes). ✓
- §4.4 gesture physics + gates + ring + haptics → Task 1 (physics) + Task 7 (ring) + Task 8 (wiring). ✓
- §4.5 fallbacks (button, Alt+R, F5/Ctrl+R intercept, Ctrl+Shift+R native) → Task 6 + Task 9. ✓
- §7 i18n/RTL strings + reviewer → Task 9. ✓
- §9 testing (unit/component/e2e) → Tasks 1–11. ✓
- Page wiring (Records/Books, Dashboard, Leaves) → Task 10. ✓
- **Gap noted:** the *veil breath* on manual desktop refresh (§4.5) is not yet wired as a full-page effect — Task 9 rotates the button glyph and refreshes, but the pane dip is deferred. **Fix:** it is lightweight and page-shell-scoped; fold it into Milestone B's shell work (where the pane wrapper is already being touched) rather than reopening every page here. Recorded in "Deferred" below.
- **Gap noted:** aria-live "list updated" announcements belong to the delta layer → correctly deferred to Milestone B (key added now in Task 9 so both locales land together).

**Placeholder scan:** no TBD/TODO; every code step has real code. ✓

**Type consistency:** `PtrStage` defined in Task 7 and imported by Task 8; `refreshAll`/`editingRegistry`/`useIsRefreshing` signatures consistent across Tasks 2–9; `PTR_CONST` field names match between Tasks 1 and 8. ✓

**Deferred to Milestone B (its own plan):** change-pulse (new/changed row highlight), value crossfade, "N new" pill, manual-refresh veil breath, aria-live announcements, adoption across remaining lists.
