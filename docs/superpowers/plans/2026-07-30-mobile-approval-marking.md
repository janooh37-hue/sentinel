# Mobile Approval — Arm-to-Mark + Queue Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager reviewing a document on a phone actually read it — marking becomes opt-in instead of always-on, the comment box stops hiding behind the keyboard, and prev/next arrows walk the approval queue without a trip back to the list.

**Architecture:** Frontend-only. `BookAnnotationLayer` gains an `armed` prop: disarmed it is `pointer-events:none` so native pinch-zoom and scroll reach the paper; armed it accepts exactly one mark, then calls `onDisarm`. On phones the mark composer becomes a bottom sheet positioned from `visualViewport` instead of a card clamped to `window.innerHeight`. `BookRecordPage` owns the armed state, renders the Mark button, and adds header arrows driven by the existing `['books','awaiting']` query.

**Tech Stack:** React 19, TypeScript (strict), Tailwind 4, React Query, react-i18next, Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-30-mobile-approval-marking-design.md`

## Global Constraints

- **No backend changes.** No `openapi.json` / `api.types.ts` regeneration. Every endpoint and query key used here already exists.
- **Never add transform-based zoom.** `usePanZoom` scales via CSS `transform`; mark placement is measured in untransformed CSS pixels, so any transform desyncs every mark and `ResizeObserver` never fires to correct it. Native browser pinch is already permitted by the viewport meta — the job is to stop blocking it.
- **Every new string goes in BOTH `frontend/src/locales/en.json` and `ar.json`.** Bilingual leaks are this repo's most frequent defect class.
- **Every new string is asserted under `lng: 'ar'` against the Arabic text**, never against the key. An EN-only assertion passes when the EN label equals the key and cannot catch a leak — that is exactly how the leave-type leak shipped green.
- **Logical CSS only** — `ms-`/`me-`, `text-start`/`text-end`. For chevrons use the repo idiom `rtl:-scale-x-100` (see `BookRecordPage.tsx:447`).
- **Strict gates must pass**: `pnpm -C frontend run lint`, `pnpm -C frontend exec tsc -b --noEmit`, `pnpm -C frontend test`.
- **Do not seed data into production.** This checkout is the live build. Manual checks run against a dev server; automated checks are vitest with mocked API.
- Run the `i18n-rtl-reviewer` agent after Task 6.

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `frontend/src/components/books/BookAnnotationLayer.tsx` | Overlay: armed gating, touch-action, one-mark-then-disarm, keyboard-aware composer | 1, 2, 3, 4 |
| `frontend/src/components/books/BookAnnotationLayer.test.tsx` (new) | Overlay behaviour tests | 1, 2, 3, 4 |
| `frontend/src/lib/useKeyboardInset.ts` (new) | `visualViewport` → px of screen covered by the keyboard | 3 |
| `frontend/src/lib/useKeyboardInset.test.ts` (new) | Hook tests with a stubbed `visualViewport` | 3 |
| `frontend/src/pages/books/useAwaitingQueue.ts` (new) | Position of the current book in the awaiting queue + prev/next ids | 5 |
| `frontend/src/pages/books/useAwaitingQueue.test.tsx` (new) | Queue hook tests | 5 |
| `frontend/src/pages/books/BookRecordPage.tsx` | Mark button, armed state, header arrows, auto-advance | 4, 6, 7 |
| `frontend/src/pages/books/BookRecordPage.queueNav.test.tsx` (new) | Arrows + auto-advance + Arabic | 6, 7 |
| `frontend/src/locales/en.json`, `ar.json` | New strings | 4, 6 |

Task order: 1–4 ship the reported defect (Section 1). 5–7 add the arrows (Section 2). Section 1 must not wait on Section 2.

---

### Task 1: Disarm the overlay by default

Today the overlay covers the whole document with `pointer-events:auto` even when the manager only wants to read. This task adds the `armed` prop and makes disarmed the default, which is what restores pinch-zoom and scrolling.

**Files:**
- Modify: `frontend/src/components/books/BookAnnotationLayer.tsx:35-56` (props), `:137-166` (root element + toolbar)
- Test: `frontend/src/components/books/BookAnnotationLayer.test.tsx` (create)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `BookAnnotationLayer` gains two optional props consumed by Tasks 2–4 and 6:
  - `armed?: boolean` — default `false`. Interaction is live only when `mode === 'mark' && armed`.
  - `onDisarm?: () => void` — called after a mark is saved or cancelled (wired in Task 2).
  The root `<div>` carries `data-testid="anno-root"` so tests can assert computed style.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/books/BookAnnotationLayer.test.tsx`:

```tsx
/**
 * Arm-to-mark: the overlay must not swallow touches while the manager is
 * reading. Disarmed it is pointer-events:none so native pinch-zoom and scroll
 * reach the paper underneath; armed it becomes interactive.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { BookAnnotationLayer } from './BookAnnotationLayer'
import type { PageBox } from './annotation-utils'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

const PAGES: PageBox[] = [{ page: 1, left: 0, top: 0, width: 400, height: 560 }]

function renderLayer(props: Partial<React.ComponentProps<typeof BookAnnotationLayer>> = {}) {
  return render(
    <BookAnnotationLayer
      pages={PAGES}
      annotations={[]}
      mode="mark"
      currentUserId={1}
      onCreate={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    />,
  )
}

describe('BookAnnotationLayer arming', () => {
  it('is pointer-events:none and shows no toolbar when disarmed', () => {
    renderLayer()
    const root = screen.getByTestId('anno-root')
    expect(root.className).toContain('pointer-events-none')
    expect(screen.queryByTitle('books.annotations.pin')).not.toBeInTheDocument()
  })

  it('becomes interactive and shows the toolbar when armed', () => {
    renderLayer({ armed: true })
    const root = screen.getByTestId('anno-root')
    expect(root.className).toContain('pointer-events-auto')
    expect(screen.getByTitle('books.annotations.pin')).toBeInTheDocument()
  })

  it('stays inert in view mode even if armed is passed', () => {
    renderLayer({ mode: 'view', armed: true })
    expect(screen.getByTestId('anno-root').className).toContain('pointer-events-none')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/books/BookAnnotationLayer.test.tsx`
Expected: FAIL — `getByTestId('anno-root')` finds nothing (the root has no test id yet).

- [ ] **Step 3: Add the props and gate the root**

In `BookAnnotationLayer.tsx`, add to the props destructuring and type:

```tsx
export function BookAnnotationLayer({
  pages,
  annotations,
  mode,
  currentUserId,
  busy,
  armed = false,
  onCreate,
  onDelete,
  onDisarm,
}: {
  pages: PageBox[]
  annotations: BookAnnotation[]
  mode: 'view' | 'mark'
  currentUserId?: number
  busy?: boolean
  /** Mark mode only accepts touches while armed — disarmed, the paper keeps
   *  its native pinch-zoom and scroll. */
  armed?: boolean
  onCreate?: (m: {
    page: number
    kind: AnnotationKind
    geometry: Record<string, number>
    comment: string
  }) => void
  onDelete?: (id: number) => void
  /** Fired after a mark is saved or cancelled — one arm yields one mark. */
  onDisarm?: () => void
}): React.JSX.Element {
```

Immediately after the `useTranslation()` line add:

```tsx
  // Interaction is live only when the decider has explicitly armed marking.
  // Disarmed, the overlay must not intercept a single touch: the paper below
  // needs its native pinch-zoom and scroll back (the phone is the approval
  // surface, and an A4 page is unreadable at ~330px without zoom).
  const live = mode === 'mark' && armed
```

Replace the root `<div>` opening tag (currently `:138-145`) with:

```tsx
    <div
      ref={rootRef}
      data-testid="anno-root"
      className={cn('absolute inset-0', live ? 'pointer-events-auto' : 'pointer-events-none')}
      onPointerDown={live ? onPointerDown : undefined}
      onPointerMove={live ? onPointerMove : undefined}
      onPointerUp={live ? onPointerUp : undefined}
      style={{ touchAction: undefined }}
    >
```

Change the toolbar guard on the next line from `{mode === 'mark' && (` to `{live && (`.

Change the `canDelete` line (`:174`) from `mode === 'mark' &&` to `live &&`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/components/books/BookAnnotationLayer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/books/BookAnnotationLayer.tsx frontend/src/components/books/BookAnnotationLayer.test.tsx
git commit -m "fix(books): overlay no longer swallows touches unless armed"
```

---

### Task 2: Touch-action by tool, and disarm after one mark

`touch-action:none` currently kills pinch-zoom for the whole mode. It is only needed for the highlight drag. It must key off the selected tool, not off a live drag — the browser decides scroll-vs-gesture on `pointerdown`, so setting it mid-drag is too late.

**Files:**
- Modify: `frontend/src/components/books/BookAnnotationLayer.tsx` (root `style`, `saveDraft`, cancel handler)
- Test: `frontend/src/components/books/BookAnnotationLayer.test.tsx` (extend)

**Interfaces:**
- Consumes: `armed`, `onDisarm`, `live` from Task 1.
- Produces: `onDisarm` is now actually called — on save and on cancel. Task 4 relies on this to flip the page's armed state back off.

- [ ] **Step 1: Write the failing test**

Append to `BookAnnotationLayer.test.tsx`:

```tsx
describe('BookAnnotationLayer touch-action and one-mark-per-arm', () => {
  it('keeps touch-action free with the Pin tool so pinch-zoom survives', () => {
    renderLayer({ armed: true })
    expect(screen.getByTestId('anno-root').style.touchAction).not.toBe('none')
  })

  it('takes touch-action only once Highlight is selected', async () => {
    const user = userEvent.setup()
    renderLayer({ armed: true })
    await user.click(screen.getByTitle('books.annotations.highlight'))
    expect(screen.getByTestId('anno-root').style.touchAction).toBe('none')
  })

  it('disarms after saving a mark', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const onDisarm = vi.fn()
    renderLayer({ armed: true, onCreate, onDisarm })

    fireEvent.pointerDown(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
    await user.type(screen.getByRole('textbox'), 'wrong date')
    await user.click(screen.getByText('books.annotations.save'))

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onDisarm).toHaveBeenCalledTimes(1)
  })

  it('disarms after cancelling a mark', async () => {
    const user = userEvent.setup()
    const onDisarm = vi.fn()
    renderLayer({ armed: true, onDisarm })

    fireEvent.pointerDown(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
    await user.click(screen.getByText('books.annotations.cancel'))

    expect(onDisarm).toHaveBeenCalledTimes(1)
  })
})
```

Add to the imports at the top of the file:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
```

(replace the existing `@testing-library/react` import line).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/books/BookAnnotationLayer.test.tsx`
Expected: FAIL — touch-action is never `'none'`, and `onDisarm` is never called.

- [ ] **Step 3: Implement**

In `BookAnnotationLayer.tsx`, change the root `style` prop to:

```tsx
      // Only the highlight DRAG conflicts with the browser's own gestures, and
      // the browser commits to scroll-vs-gesture on pointerdown — so this keys
      // off the selected tool, not off a live drag (too late by then). Pin is
      // the default, so arming alone never costs the manager pinch-zoom.
      style={{ touchAction: live && tool === 'highlight' ? 'none' : undefined }}
```

Change `saveDraft` to disarm:

```tsx
  function saveDraft(): void {
    if (!draft || !draftText.trim() || !onCreate) return
    onCreate({ page: draft.page, kind: draft.kind, geometry: draft.geometry, comment: draftText.trim() })
    setDraft(null)
    setDraftText('')
    onDisarm?.()
  }
```

Change the composer's Cancel `onClick` to:

```tsx
                    onClick={() => {
                      setDraft(null)
                      setDraftText('')
                      onDisarm?.()
                    }}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/components/books/BookAnnotationLayer.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/books/BookAnnotationLayer.tsx frontend/src/components/books/BookAnnotationLayer.test.tsx
git commit -m "fix(books): touch-action only for the highlight tool; one arm = one mark"
```

---

### Task 3: `useKeyboardInset` — how much screen the keyboard covers

`MarkPopover` clamps against `window.innerHeight` and listens to `window` `resize`. On iOS that event never fires when the keyboard opens, so any resize-based fix silently does nothing on half the fleet. This hook reads `visualViewport` instead.

**Files:**
- Create: `frontend/src/lib/useKeyboardInset.ts`
- Test: `frontend/src/lib/useKeyboardInset.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useKeyboardInset(): number` — px of the layout viewport hidden at the bottom by the on-screen keyboard; `0` when closed or when `visualViewport` is unavailable. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/useKeyboardInset.test.ts`:

```ts
/**
 * The on-screen keyboard does not fire window.resize on iOS, so the composer
 * has to read visualViewport. This hook is the seam; it returns how many px of
 * the layout viewport the keyboard is covering.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { useKeyboardInset } from './useKeyboardInset'

interface FakeVV extends EventTarget {
  height: number
  offsetTop: number
}

let vv: FakeVV

function setViewport(height: number, offsetTop = 0): void {
  vv.height = height
  vv.offsetTop = offsetTop
  vv.dispatchEvent(new Event('resize'))
}

beforeEach(() => {
  window.innerHeight = 844
  vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 }) as FakeVV
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
})

describe('useKeyboardInset', () => {
  it('is 0 with the keyboard closed', () => {
    const { result } = renderHook(() => useKeyboardInset())
    expect(result.current).toBe(0)
  })

  it('reports the covered px when the keyboard opens', () => {
    const { result } = renderHook(() => useKeyboardInset())
    act(() => setViewport(508)) // iPhone keyboard ≈ 336px
    expect(result.current).toBe(336)
  })

  it('accounts for offsetTop when the visual viewport is scrolled', () => {
    const { result } = renderHook(() => useKeyboardInset())
    act(() => setViewport(508, 20))
    expect(result.current).toBe(316)
  })

  it('returns to 0 when the keyboard closes', () => {
    const { result } = renderHook(() => useKeyboardInset())
    act(() => setViewport(508))
    act(() => setViewport(844))
    expect(result.current).toBe(0)
  })

  it('also updates on visualViewport scroll (iOS fires scroll, not resize)', () => {
    const { result } = renderHook(() => useKeyboardInset())
    act(() => {
      vv.height = 508
      vv.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toBe(336)
  })

  it('is 0 when visualViewport is unavailable', () => {
    Reflect.deleteProperty(window, 'visualViewport')
    const { result } = renderHook(() => useKeyboardInset())
    expect(result.current).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/lib/useKeyboardInset.test.ts`
Expected: FAIL — `Failed to resolve import "./useKeyboardInset"`.

- [ ] **Step 3: Write the hook**

Create `frontend/src/lib/useKeyboardInset.ts`:

```ts
/**
 * useKeyboardInset — px of the layout viewport currently hidden behind the
 * on-screen keyboard.
 *
 * Why not `window.resize`: iOS Safari does NOT resize the layout viewport when
 * the keyboard opens, so `resize` never fires and any listener based on it is a
 * silent no-op on iPhones. `visualViewport` is the only signal both platforms
 * agree on — and it fires `scroll` (not `resize`) in some iOS cases, so we
 * listen to both.
 *
 * Returns 0 when the keyboard is closed or `visualViewport` is unavailable
 * (jsdom, older browsers), which makes callers degrade to today's behaviour.
 */
import { useEffect, useState } from 'react'

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const read = (): void => {
      // Whatever the visual viewport doesn't cover at the bottom is keyboard.
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    }
    read()
    vv.addEventListener('resize', read)
    vv.addEventListener('scroll', read)
    return () => {
      vv.removeEventListener('resize', read)
      vv.removeEventListener('scroll', read)
    }
  }, [])

  return inset
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/lib/useKeyboardInset.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/useKeyboardInset.ts frontend/src/lib/useKeyboardInset.test.ts
git commit -m "feat(lib): useKeyboardInset reads visualViewport for keyboard height"
```

---

### Task 4: Composer becomes a keyboard-aware bottom sheet on phones

Measured on the live build: the composer opened at y 698–825 while the iPhone keyboard starts at y 508. It is fully buried. On phones, stop anchoring the composer to the mark and pin it above the keyboard instead.

**Files:**
- Modify: `frontend/src/components/books/BookAnnotationLayer.tsx` (`MarkPopover` + the draft composer block `:242-301`)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/components/books/BookAnnotationLayer.test.tsx` (extend)

**Interfaces:**
- Consumes: `useKeyboardInset` (Task 3); `onDisarm` (Task 2).
- Produces: the draft composer container carries `data-testid="anno-composer"`. New i18n keys `books.annotations.mark`, `books.annotations.markHint`, `books.annotations.markingOn` (the last two are used by Task 6's button; added here so both locale files change once).

- [ ] **Step 1: Write the failing test**

Append to `BookAnnotationLayer.test.tsx`:

```tsx
describe('BookAnnotationLayer composer vs keyboard', () => {
  function openComposer(): void {
    renderLayer({ armed: true })
    fireEvent.pointerDown(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
  }

  it('sits above the keyboard on a phone', () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes('max-width'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
    const vv = Object.assign(new EventTarget(), { height: 508, offsetTop: 0 })
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    window.innerHeight = 844

    openComposer()
    // 844 - 508 = 336px of keyboard; the sheet must clear it.
    expect(screen.getByTestId('anno-composer').style.bottom).toBe('336px')
    Reflect.deleteProperty(window, 'visualViewport')
  })

  it('blurs the textarea before clearing the draft so the keyboard comes down', async () => {
    const user = userEvent.setup()
    openComposer()
    const box = screen.getByRole('textbox')
    box.focus()
    expect(document.activeElement).toBe(box)
    await user.click(screen.getByText('books.annotations.cancel'))
    expect(document.activeElement).not.toBe(box)
  })

  it('keeps the draft text when the keyboard is dismissed by hand', () => {
    openComposer()
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'wrong date' } })
    fireEvent.blur(box) // user swiped the keyboard away
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('wrong date')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/books/BookAnnotationLayer.test.tsx`
Expected: FAIL — no element with `data-testid="anno-composer"`.

- [ ] **Step 3: Implement**

Add imports at the top of `BookAnnotationLayer.tsx`:

```tsx
import { useIsMobile } from '@/lib/useIsMobile'
import { useKeyboardInset } from '@/lib/useKeyboardInset'
```

Inside the component, after the `live` line, add:

```tsx
  const isPhone = useIsMobile()
  const keyboardInset = useKeyboardInset()
```

Give `MarkPopover` a sheet mode. Replace its signature and body's return with:

```tsx
function MarkPopover({
  rootRef,
  anchorLeft,
  anchorTop,
  className,
  dir,
  /** Phone: ignore the anchor and pin to the bottom, clear of the keyboard. */
  sheetBottom,
  testId,
  children,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>
  anchorLeft: number
  anchorTop: number
  className?: string
  dir?: 'auto' | 'ltr' | 'rtl'
  sheetBottom?: number
  testId?: string
  children: React.ReactNode
}): React.JSX.Element {
```

Guard the existing `useLayoutEffect` placement so it does nothing in sheet mode — add this as the first line inside `place()`:

```tsx
      if (sheetBottom != null) return
```

and add `sheetBottom` to the effect's dependency array.

Replace the `createPortal` call with:

```tsx
  return createPortal(
    <div
      ref={cardRef}
      dir={dir}
      data-anno-ui
      data-testid={testId}
      className={cn(
        'pointer-events-auto fixed z-[70]',
        sheetBottom != null ? 'inset-x-2' : 'left-0 top-0',
        className,
      )}
      style={sheetBottom != null ? { bottom: `${sheetBottom}px` } : undefined}
    >
      {children}
    </div>,
    document.body,
  )
```

In the draft composer block, pass the sheet props to `MarkPopover`:

```tsx
              <MarkPopover
                rootRef={rootRef}
                anchorLeft={r.left}
                anchorTop={top + 8}
                dir="auto"
                testId="anno-composer"
                sheetBottom={isPhone ? keyboardInset : undefined}
                className={cn(
                  'rounded-xl border border-hairline bg-surface p-3 shadow-2xl',
                  isPhone ? 'w-auto' : 'w-[224px]',
                )}
              >
```

Give the textarea a ref so it can be blurred. Add near the other refs:

```tsx
  const draftBoxRef = useRef<HTMLTextAreaElement>(null)
```

Add `ref={draftBoxRef}` to the composer `<textarea>` and make its autofocus
desktop-only — `autoFocus={!isPhone}`. On a phone, focusing on first paint
raises the keyboard before the sheet has been positioned against it; on
desktop there is no keyboard to race and losing autofocus would just cost the
user a click.

Add a helper next to `saveDraft` and use it from both exits:

```tsx
  /** Close the composer. Blur FIRST: iOS keeps the keyboard raised when a
   *  focused element simply unmounts, which left the manager with a keyboard
   *  and no box. */
  function closeDraft(): void {
    draftBoxRef.current?.blur()
    setDraft(null)
    setDraftText('')
    onDisarm?.()
  }
```

Rewrite `saveDraft` to use it:

```tsx
  function saveDraft(): void {
    if (!draft || !draftText.trim() || !onCreate) return
    onCreate({ page: draft.page, kind: draft.kind, geometry: draft.geometry, comment: draftText.trim() })
    closeDraft()
  }
```

and change the Cancel `onClick` to `onClick={closeDraft}`.

Note there is deliberately **no** `onBlur` handler on the textarea: a manual
keyboard dismissal must leave the draft and its text alone.

- [ ] **Step 4: Add the new strings to both locale files**

In `frontend/src/locales/en.json` under `books.annotations`:

```json
      "mark": "Mark",
      "markHint": "Tap the spot that needs fixing",
      "markingOn": "Marking on — tap to cancel",
```

In `frontend/src/locales/ar.json` under `books.annotations`:

```json
      "mark": "تحديد",
      "markHint": "انقر على الموضع الذي يحتاج تصحيحاً",
      "markingOn": "التحديد مُفعّل — انقر للإلغاء",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/components/books/BookAnnotationLayer.test.tsx`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/books/BookAnnotationLayer.tsx frontend/src/components/books/BookAnnotationLayer.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "fix(books): composer becomes a keyboard-aware sheet on phones"
```

---

### Task 5: `useAwaitingQueue` — position and neighbours in the approval queue

Pure lookup over the existing awaiting query. Isolated from the page so it can be tested without rendering the whole record screen.

**Files:**
- Create: `frontend/src/pages/books/useAwaitingQueue.ts`
- Test: `frontend/src/pages/books/useAwaitingQueue.test.tsx`

**Interfaces:**
- Consumes: `api.listAwaitingBooks` and query key `['books','awaiting']` (both already exist and are used by `BooksAwaitingWidget`).
- Produces:
  ```ts
  interface AwaitingQueue {
    position: number | null   // 1-based index of bookId, null if not queued
    total: number
    prevId: number | null
    nextId: number | null
  }
  export function useAwaitingQueue(bookId: number | null, enabled: boolean): AwaitingQueue
  ```
  Consumed by Tasks 6 and 7.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/books/useAwaitingQueue.test.tsx`:

```tsx
/**
 * Queue walk for the record page's prev/next arrows. Order must match the
 * server's (created_at DESC) so the arrows track the same list the manager
 * sees on the dashboard and they never lose their place.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useAwaitingQueue } from './useAwaitingQueue'
import * as apiMod from '@/lib/api'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.spyOn(apiMod.api, 'listAwaitingBooks').mockResolvedValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [{ id: 10 }, { id: 20 }, { id: 30 }] as any,
  )
})

describe('useAwaitingQueue', () => {
  it('reports position and both neighbours for a middle book', async () => {
    const { result } = renderHook(() => useAwaitingQueue(20, true), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(3))
    expect(result.current.position).toBe(2)
    expect(result.current.prevId).toBe(10)
    expect(result.current.nextId).toBe(30)
  })

  it('has no prev at the head and no next at the tail', async () => {
    const head = renderHook(() => useAwaitingQueue(10, true), { wrapper })
    await waitFor(() => expect(head.result.current.position).toBe(1))
    expect(head.result.current.prevId).toBeNull()

    const tail = renderHook(() => useAwaitingQueue(30, true), { wrapper })
    await waitFor(() => expect(tail.result.current.position).toBe(3))
    expect(tail.result.current.nextId).toBeNull()
  })

  it('reports null position for a book that is not in the queue', async () => {
    const { result } = renderHook(() => useAwaitingQueue(999, true), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(3))
    expect(result.current.position).toBeNull()
    expect(result.current.prevId).toBeNull()
    expect(result.current.nextId).toBeNull()
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useAwaitingQueue(20, false), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(0))
    expect(apiMod.api.listAwaitingBooks).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/books/useAwaitingQueue.test.tsx`
Expected: FAIL — `Failed to resolve import "./useAwaitingQueue"`.

- [ ] **Step 3: Write the hook**

Create `frontend/src/pages/books/useAwaitingQueue.ts`:

```ts
/**
 * useAwaitingQueue — where the open record sits in the manager's approval
 * queue, and which books flank it.
 *
 * Reuses the query the dashboard's BooksAwaitingWidget already runs
 * (`['books','awaiting']` → GET /books/awaiting, ordered created_at DESC), so
 * the record page's arrows walk exactly the list the manager already sees and
 * the two surfaces share one cache entry.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

export interface AwaitingQueue {
  /** 1-based position of the open book, or null when it isn't queued. */
  position: number | null
  total: number
  prevId: number | null
  nextId: number | null
}

export function useAwaitingQueue(bookId: number | null, enabled: boolean): AwaitingQueue {
  const { data = [] } = useQuery({
    queryKey: ['books', 'awaiting'],
    queryFn: api.listAwaitingBooks,
    staleTime: 30_000,
    enabled,
  })

  const ids = data.map((b) => b.id)
  const i = bookId == null ? -1 : ids.indexOf(bookId)
  if (i < 0) return { position: null, total: ids.length, prevId: null, nextId: null }
  return {
    position: i + 1,
    total: ids.length,
    prevId: i > 0 ? (ids[i - 1] ?? null) : null,
    nextId: i < ids.length - 1 ? (ids[i + 1] ?? null) : null,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/pages/books/useAwaitingQueue.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/books/useAwaitingQueue.ts frontend/src/pages/books/useAwaitingQueue.test.tsx
git commit -m "feat(books): useAwaitingQueue derives position and neighbours"
```

---

### Task 6: Wire the Mark button and the header arrows into the record page

**Files:**
- Modify: `frontend/src/pages/books/BookRecordPage.tsx:353` (annMode), `:440-448` (header), `:726-744` (overlay props)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/books/BookRecordPage.queueNav.test.tsx` (create)

**Interfaces:**
- Consumes: `armed` / `onDisarm` (Tasks 1–2), `useAwaitingQueue` (Task 5).
- Produces: header controls with stable test ids `queue-prev`, `queue-next`, `queue-position`, `mark-toggle`. Task 7 adds auto-advance behind the same hook.

- [ ] **Step 1: Add the queue strings to both locale files**

In `frontend/src/locales/en.json` under `books.record`:

```json
      "prevAwaiting": "Previous awaiting record",
      "nextAwaiting": "Next awaiting record",
      "queuePosition": "{{n}} of {{total}}",
```

In `frontend/src/locales/ar.json` under `books.record`:

```json
      "prevAwaiting": "السجل السابق بانتظار الاعتماد",
      "nextAwaiting": "السجل التالي بانتظار الاعتماد",
      "queuePosition": "{{n}} من {{total}}",
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/pages/books/BookRecordPage.queueNav.test.tsx`:

```tsx
/**
 * Header queue arrows. Asserted under lng=ar as well as en — an English-only
 * assertion cannot catch an AR leak when the EN label equals the key.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import { QueueNav } from './QueueNav'

vi.mock('@/lib/api', () => ({ api: { listAwaitingBooks: vi.fn() } }))

describe('QueueNav (English)', () => {
  it('renders the position and both arrows for a middle book', () => {
    render(<QueueNav position={2} total={3} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByTestId('queue-position')).toHaveTextContent('2 of 3')
    expect(screen.getByTestId('queue-prev')).toBeEnabled()
    expect(screen.getByTestId('queue-next')).toBeEnabled()
  })

  it('renders nothing when the queue holds fewer than two books', () => {
    const { container } = render(
      <QueueNav position={1} total={1} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the book is not in the queue', () => {
    const { container } = render(
      <QueueNav position={null} total={5} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('disables the edge arrow at the head and the tail', () => {
    const { rerender } = render(
      <QueueNav position={1} total={3} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(screen.getByTestId('queue-prev')).toBeDisabled()
    rerender(<QueueNav position={3} total={3} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByTestId('queue-next')).toBeDisabled()
  })

  it('calls the handlers', async () => {
    const user = userEvent.setup()
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<QueueNav position={2} total={3} onPrev={onPrev} onNext={onNext} />)
    await user.click(screen.getByTestId('queue-prev'))
    await user.click(screen.getByTestId('queue-next'))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})

describe('QueueNav (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('labels and counter are Arabic, not English', () => {
    render(<QueueNav position={2} total={3} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByLabelText('السجل السابق بانتظار الاعتماد')).toBeInTheDocument()
    expect(screen.getByLabelText('السجل التالي بانتظار الاعتماد')).toBeInTheDocument()
    expect(screen.getByTestId('queue-position')).toHaveTextContent('2 من 3')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/books/BookRecordPage.queueNav.test.tsx`
Expected: FAIL — `Failed to resolve import "./QueueNav"`.

- [ ] **Step 4: Write `QueueNav`**

Create `frontend/src/pages/books/QueueNav.tsx`:

```tsx
/**
 * QueueNav — prev/next through the manager's approval queue, shown beside the
 * record page's back button.
 *
 * Lives in the HEADER, never on the desk: BookRecordPage pins the desk to
 * `direction: ltr` so the Progress rail doesn't flip sides in Arabic, and
 * chevrons placed there would point the wrong way. In the header they inherit
 * page direction, and `rtl:-scale-x-100` mirrors the glyphs (repo idiom).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function QueueNav({
  position,
  total,
  onPrev,
  onNext,
}: {
  position: number | null
  total: number
  onPrev: () => void
  onNext: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  // Nothing to walk — stay out of the way of anyone not working a stack.
  if (position == null || total < 2) return null

  const btn =
    'flex h-9 w-8 items-center justify-center rounded-lg border border-hairline bg-surface text-primary transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40'

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-testid="queue-prev"
        onClick={onPrev}
        disabled={position <= 1}
        aria-label={t('books.record.prevAwaiting')}
        className={btn}
      >
        <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} />
      </button>
      <span
        data-testid="queue-position"
        className="min-w-[3.5rem] text-center font-mono text-[0.7em] tabular-nums text-muted-foreground"
      >
        {t('books.record.queuePosition', { n: position, total })}
      </span>
      <button
        type="button"
        data-testid="queue-next"
        onClick={onNext}
        disabled={position >= total}
        aria-label={t('books.record.nextAwaiting')}
        className={btn}
      >
        <ChevronRight className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} />
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/pages/books/BookRecordPage.queueNav.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: Wire both into `BookRecordPage.tsx`**

Add imports:

```tsx
import { QueueNav } from './QueueNav'
import { useAwaitingQueue } from './useAwaitingQueue'
```

Replace the `annMode` line (`:353`) with:

```tsx
  // Marking is opt-in. It used to be forced on for the decider, which put a
  // pointer-eating overlay across the whole document — on a phone that killed
  // pinch-zoom and made an A4 page unreadable. Now the manager arms it.
  const [armed, setArmed] = useState(false)
  const canMark = state === 'pending' && action === 'decide'
  const annMode: 'view' | 'mark' = canMark ? 'mark' : 'view'
```

Add the queue hook next to it:

```tsx
  const queue = useAwaitingQueue(book?.id ?? null, canApprove)
```

In the header, immediately after the back button (`:448`), add:

```tsx
        <QueueNav
          position={queue.position}
          total={queue.total}
          onPrev={() => queue.prevId != null && navigate(`/books/${queue.prevId}`)}
          onNext={() => queue.nextId != null && navigate(`/books/${queue.nextId}`)}
        />
```

In the header action cluster (beside the Print button, `:477-481`), add the Mark toggle:

```tsx
          {canMark && (
            <HeaderBtn
              icon={<MapPin className="h-3.5 w-3.5" />}
              label={armed ? t('books.annotations.markingOn') : t('books.annotations.mark')}
              tone={armed ? 'amber' : 'plain'}
              onClick={() => setArmed((a) => !a)}
              testId="mark-toggle"
            />
          )}
```

Add `MapPin` to the existing `lucide-react` import.

`tone="amber"` while armed makes the state visible — amber is already this
file's "live / needs attention" tone and matches the annotation marks' warning
colour.

`HeaderBtn` (`:912-946`) currently takes no test id, so add one. In its props
type add `testId?: string`, in the destructuring add `testId`, and on the
`<button>` add `data-testid={testId}`:

```tsx
function HeaderBtn({
  icon,
  label,
  tone = 'plain',
  onClick,
  disabled,
  testId,
}: {
  icon: React.ReactNode
  label: string
  tone?: BtnTone
  onClick?: () => void
  disabled?: boolean
  testId?: string
}): React.JSX.Element {
```

```tsx
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
```

Pass the new props to the overlay (`:732-740`):

```tsx
                            <BookAnnotationLayer
                              pages={pages}
                              annotations={annotations}
                              mode={annMode}
                              armed={armed}
                              currentUserId={user?.id}
                              busy={createMark.isPending || deleteMark.isPending}
                              onCreate={(m) => createMark.mutate(m)}
                              onDelete={(id) => deleteMark.mutate(id)}
                              onDisarm={() => setArmed(false)}
                            />
```

- [ ] **Step 7: Run the full frontend suite**

Run: `pnpm -C frontend test`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/books/QueueNav.tsx frontend/src/pages/books/BookRecordPage.queueNav.test.tsx frontend/src/pages/books/BookRecordPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(books): arm-to-mark toggle and awaiting-queue arrows in the record header"
```

---

### Task 7: Auto-advance after return/reject — and NOT after approve

Return and reject already navigate away, so advancing them is a straight win. **Sign & approve deliberately stays on the record** (`BookRecordPage.tsx:385-389`) so the signer watches their signature land on the document. Auto-advancing there would destroy that confirmation. The counter simply updates underneath and `›` is one tap away.

**Files:**
- Modify: `frontend/src/pages/books/BookRecordPage.tsx:378-390`
- Test: `frontend/src/pages/books/BookRecordPage.queueNav.test.tsx` (extend)

**Interfaces:**
- Consumes: `useAwaitingQueue` (Task 5), `useBookApprovalActions` (existing).
- Produces: `nextAfterDecision(nextId: number | null): string` — the route to go to after a return/reject. Exported from `useAwaitingQueue.ts` so it is testable without rendering the page.

- [ ] **Step 1: Write the failing test**

Append to `BookRecordPage.queueNav.test.tsx`:

```tsx
import { nextAfterDecision } from './useAwaitingQueue'

describe('nextAfterDecision', () => {
  it('advances to the next awaiting book', () => {
    expect(nextAfterDecision(42)).toBe('/books/42')
  })

  it('falls back to the list when the queue is empty', () => {
    expect(nextAfterDecision(null)).toBe('/books')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/books/BookRecordPage.queueNav.test.tsx`
Expected: FAIL — `nextAfterDecision` is not exported.

- [ ] **Step 3: Add the helper**

Append to `frontend/src/pages/books/useAwaitingQueue.ts`:

```ts
/** Where a return/reject lands: the next book still awaiting, else the list. */
export function nextAfterDecision(nextId: number | null): string {
  return nextId != null ? `/books/${nextId}` : '/books'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/pages/books/BookRecordPage.queueNav.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Wire it into the decision handler**

In `BookRecordPage.tsx`, replace the `onDecided` body (`:380-384`) with:

```tsx
    onDecided: () => {
      setDecision(null)
      setReason('')
      // Straight on to the next document awaiting this manager — the whole
      // point of the arrows is not having to go back to the list. The mutation
      // already invalidated ['books','awaiting'], so the decided book has
      // dropped out and `nextId` points past it.
      navigate(nextAfterDecision(queue.nextId))
    },
```

Add `nextAfterDecision` to the `./useAwaitingQueue` import.

**Leave `onSigned` exactly as it is.** Its comment already explains why, and this task must not change it.

- [ ] **Step 6: Run the full suite and the strict gates**

```bash
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/books/useAwaitingQueue.ts frontend/src/pages/books/BookRecordPage.queueNav.test.tsx frontend/src/pages/books/BookRecordPage.tsx
git commit -m "feat(books): return/reject advance to the next awaiting record"
```

---

### Task 8: Bilingual review and manual verification

**Files:** none modified unless the reviewer finds something.

- [ ] **Step 1: Run the i18n reviewer**

Dispatch the `i18n-rtl-reviewer` agent over the diff (`git diff main...HEAD`). It checks EN/AR key parity, English leaking into Arabic, and logical-CSS use. Fix anything it reports, then re-run `pnpm -C frontend test`.

- [ ] **Step 2: Manual check on a dev server**

```bash
pnpm -C frontend exec vite --host 127.0.0.1
```

Open `http://127.0.0.1:5173/books/<id>` in a 390×844 window. Production currently has 0 pending books, so to exercise the armed path either use a scratch copy of the SQLite database on a second port, or temporarily force `canMark` locally — **never seed a pending book into production.**

Confirm, in both English and Arabic:
1. Disarmed, the paper pinch-zooms and scrolls, and no tool pill covers the header.
2. Mark arms it; a tap opens the composer above the keyboard; Save closes the keyboard with the box and disarms.
3. Arrows walk the queue; chevrons point the correct way in Arabic.

- [ ] **Step 3: Push**

```bash
git push origin HEAD
```

This checkout is the live build — work must reach `origin/main` or the next `mng update` overwrites it. Merge to `main` when the user approves, then deploy with `scripts\mng.ps1 deploy`.

---

## Self-Review

**Spec coverage:** Section 1 fixes 1–3 → Tasks 1–2; fixes 4–5 → Tasks 3–4; fix 6 (blur) → Task 4; fix 7 (disarm) → Task 2. Section 2 behaviour/data/RTL → Tasks 5–6; post-decision asymmetry → Task 7. i18n table → Tasks 4 and 6. Test list items 1–10 → Tasks 1–7. Out-of-scope no-zoom rule → Global Constraints. All covered.

**Type consistency:** `armed` / `onDisarm` named identically in Tasks 1, 2, 4, 6. `AwaitingQueue` fields (`position`, `total`, `prevId`, `nextId`) identical in Tasks 5, 6, 7. `useKeyboardInset()` returns `number` in Tasks 3 and 4. `closeDraft()` defined once in Task 4 and used by both exits.

**Known deviation from the spec's first draft:** the spec originally said `touch-action:none` applies "while a highlight drag is in flight". That is unimplementable — the browser commits to scroll-vs-gesture on `pointerdown`. Both spec and plan now key it off the selected tool. Pin is the default, so arming still costs no pinch-zoom.
