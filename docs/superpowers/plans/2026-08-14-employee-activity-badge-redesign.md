# Employee Activity Badge Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the employee-page "Recent activity" section to the locked F3 design — toolbar search + kind filter chips, and a physical GSSG ID-badge card hanging from a white retractable badge reel when an employee is selected.

**Architecture:** `EmployeeActivitySection` keeps all of its data logic (infinite query, day grouping, cache eviction) and swaps its presentation: the `<select>` becomes a chip row, the lookup card becomes a slim toolbar search, and a new leaf component `EmployeeBadgeCard` renders the selected employee as an ID badge + reel in a 340px left column. `EmployeeActivityLookup` is reduced to the search-input-with-results-popup only (selected-employee display moves to the badge). Mockup of record: `mockups/employee-activity-v3-family.html?v=3`.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS v4 (token utilities from `frontend/src/index.css`), TanStack Query, react-i18next, Vitest + Testing Library.

## Global Constraints

- Live-main repo: work happens on branch `feature/employee-activity-badge`; the operator merges to `main`, pushes `origin/main`, and the office server applies it via `mng update`. NEVER commit to `main` directly.
- Every new user-facing string gets a key in BOTH `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` (key parity is the #1 recurring bug source).
- All frontend commands run from `frontend/` with pnpm: `pnpm exec vitest run <path>`, `pnpm build` (= `tsc -b && vite build`), `pnpm lint`.
- Frontend only. No files under `backend/` change. No API/schema changes (`openapi.json` / `api.types.ts` untouched).
- Do NOT run the full test suite, lint, or build inside subagent tasks — the coordinator runs them once at the end.
- `mockups/` stays untracked (design artifacts, not app code). The one asset that ships is `frontend/public/brand/gssg-globe.png` (already copied).
- Reel ring SVG parameters are LOCKED: viewBox `0 0 80 80`, circle `r=34.3`, `stroke=#cf3238`, `stroke-width=8.3`, `stroke-dasharray=46.77 7.1`, `stroke-dashoffset=50.32`, `transform=rotate(-90 40 40)`.
- The badge is a physical object: its colors are literal hex (white card, navy band `linear-gradient(135deg,#0a1f3a 0%,#0d2845 50%,#1d3a5e 100%)`), NOT theme tokens — it must look identical in light and dark themes. The activity panel/toolbar use theme tokens as usual.
- Names/positions render via existing `pickEmployeeName` / `pickPosition` with `dir="auto"`; layout uses logical properties (`start`/`end`, `ms-`/`me-`) so RTL mirrors correctly.

## File Structure

- `frontend/src/components/employees/EmployeeBadgeCard.tsx` — NEW leaf: reel + badge + actions (Task 1).
- `frontend/src/components/employees/EmployeeBadgeCard.test.tsx` — NEW (Task 1).
- `frontend/public/brand/gssg-globe.png` — NEW asset, already in working tree (Task 1 commits it).
- `frontend/src/components/employees/EmployeeActivityLookup.tsx` — REWORK: search + popup only (Task 2).
- `frontend/src/components/employees/EmployeeActivitySection.tsx` — REWORK: toolbar + chips + badge layout (Task 2).
- `frontend/src/components/employees/EmployeeActivityLookup.test.tsx` — update (Task 2).
- `frontend/src/components/employees/EmployeeActivitySection.test.tsx` — update (Task 2).
- `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` — add `employees.activity.badge.*` keys (Task 1 owns these two keys; Task 2 adds none).

---

### Task 1: EmployeeBadgeCard component

**Files:**
- Create: `frontend/src/components/employees/EmployeeBadgeCard.tsx`
- Create: `frontend/src/components/employees/EmployeeBadgeCard.test.tsx`
- Modify: `frontend/src/locales/en.json` (inside `employees.activity`, after the `"actions"` object)
- Modify: `frontend/src/locales/ar.json` (same position)
- Commit (untracked): `frontend/public/brand/gssg-globe.png`

**Interfaces:**
- Consumes: `EmployeeListItem` from `@/lib/api`; `pickEmployeeName` from `@/lib/employeeName`; `pickPosition` from `@/lib/employeePosition`; `StatusPill` from `./StatusPill`; i18n via `useTranslation`.
- Produces (Task 2 relies on this exact contract):

```ts
export interface EmployeeBadgeCardProps {
  employee: EmployeeListItem
  onOpenProfile: (employeeId: string) => void
  onClear: () => void
}
export function EmployeeBadgeCard(props: EmployeeBadgeCardProps): React.JSX.Element
```

- [ ] **Step 1: Add i18n keys**

In `frontend/src/locales/en.json`, inside `employees.activity` (after the `"actions": { ... }` object, keep alphabetic sanity but position is not enforced):

```json
"badge": {
  "company": "GSSG Security",
  "role": "Employee identification"
}
```

In `frontend/src/locales/ar.json`, same location:

```json
"badge": {
  "company": "المجموعة العالمية للخدمات الأمنية",
  "role": "بطاقة تعريف الموظف"
}
```

Reuse existing keys for the buttons: `employees.activity.openProfile` ("Open profile") and `employees.activity.clearEmployee` ("Clear employee filter").

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/employees/EmployeeBadgeCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EmployeeListItem } from '@/lib/api'
import { EmployeeBadgeCard } from './EmployeeBadgeCard'

const abdulla: EmployeeListItem = {
  id: 'G3190',
  name_en: 'ABDULLA ALABRI',
  name_ar: 'عبدالله العبري',
  status: 'Active',
  position: 'Officer',
  position_ar: 'ضابط',
  has_photo: false,
} as EmployeeListItem

describe('EmployeeBadgeCard', () => {
  it('renders name, G-number, position, and status', () => {
    render(<EmployeeBadgeCard employee={abdulla} onOpenProfile={() => {}} onClear={() => {}} />)
    expect(screen.getByText('ABDULLA ALABRI')).toBeInTheDocument()
    expect(screen.getByText('G3190')).toBeInTheDocument()
    expect(screen.getByText('Officer')).toBeInTheDocument()
    expect(screen.getByText(/active/i)).toBeInTheDocument()
  })

  it('falls back to name initials when there is no photo', () => {
    render(<EmployeeBadgeCard employee={abdulla} onOpenProfile={() => {}} onClear={() => {}} />)
    expect(screen.getByText('AA')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '' })).not.toBeInTheDocument()
  })

  it('renders the photo endpoint image when has_photo is true', () => {
    render(
      <EmployeeBadgeCard
        employee={{ ...abdulla, has_photo: true }}
        onOpenProfile={() => {}}
        onClear={() => {}}
      />,
    )
    const img = document.querySelector('img[src="/api/v1/employees/G3190/photo"]')
    expect(img).not.toBeNull()
  })

  it('delegates the two actions', async () => {
    const onOpenProfile = vi.fn()
    const onClear = vi.fn()
    render(<EmployeeBadgeCard employee={abdulla} onOpenProfile={onOpenProfile} onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: /open profile/i }))
    expect(onOpenProfile).toHaveBeenCalledWith('G3190')
    await userEvent.click(screen.getByRole('button', { name: /clear employee filter/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('marks the decorative reel as aria-hidden', () => {
    const { container } = render(
      <EmployeeBadgeCard employee={abdulla} onOpenProfile={() => {}} onClear={() => {}} />,
    )
    expect(container.querySelector('[data-testid="badge-reel"]')).toHaveAttribute('aria-hidden', 'true')
  })
})
```

Test setup note: the repo's vitest config already wires jsdom + jest-dom + an i18n test instance the way sibling tests do — mirror the import/mocking style of `EmployeeActivityLookup.test.tsx` if `useTranslation` needs a mock (it does NOT if the shared test i18n setup provides real locales; check `frontend/src/components/employees/EmployeeIdCard.tsx`'s test if one exists, otherwise mock `react-i18next` exactly like `EmployeeActivitySection.test.tsx` does, adding the two `badge.*` keys plus `openProfile`/`clearEmployee`/`status.Active` to the mocked map).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && pnpm exec vitest run src/components/employees/EmployeeBadgeCard.test.tsx`
Expected: FAIL — module `./EmployeeBadgeCard` not found.

- [ ] **Step 4: Implement the component**

Create `frontend/src/components/employees/EmployeeBadgeCard.tsx`. Full implementation (physical-object colors literal; reel parameters locked; Tailwind for layout, inline styles for the barcode/holo/rib textures):

```tsx
/**
 * EmployeeBadgeCard — the selected employee rendered as a physical GSSG ID
 * badge hanging from a white retractable badge reel (locked F3 design,
 * mockups/employee-activity-v3-family.html?v=3).
 *
 * The badge is a physical object: literal hex colors, identical in light and
 * dark themes. Only the action buttons below it use theme tokens.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { StatusPill } from './StatusPill'

export interface EmployeeBadgeCardProps {
  employee: EmployeeListItem
  onOpenProfile: (employeeId: string) => void
  onClear: () => void
}

const BAND_GRADIENT = 'linear-gradient(135deg,#0a1f3a 0%,#0d2845 50%,#1d3a5e 100%)'
const BARCODE =
  'repeating-linear-gradient(90deg,#0d1421 0 2px,transparent 2px 5px,#0d1421 5px 6px,transparent 6px 8px,#0d1421 8px 11px,transparent 11px 13px,#0d1421 13px 14px,transparent 14px 18px)'
const HOLO =
  'linear-gradient(100deg,#8fd3f4,#b8a9f5,#f5c98f,#93e9be,#8fd3f4)'
const RIBS = 'repeating-linear-gradient(180deg,#f8f8f6 0 3px,#d9d9d5 3px 5px)'

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

export function EmployeeBadgeCard({
  employee,
  onOpenProfile,
  onClear,
}: EmployeeBadgeCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const [photoFailed, setPhotoFailed] = useState(false)
  const name = pickEmployeeName(employee, lang)
  const position = pickPosition(employee, lang)
  const showPhoto = employee.has_photo && !photoFailed

  return (
    <div>
      {/* Retractable badge reel — purely decorative */}
      <div aria-hidden data-testid="badge-reel" className="relative z-[2] flex flex-col items-center">
        <div
          className="grid h-[118px] w-[118px] place-items-center rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 28%,#ffffff 0%,#f4f4f2 55%,#e3e3df 100%)',
            boxShadow:
              '0 14px 30px -10px rgba(13,40,69,.35),0 2px 5px rgba(13,40,69,.14)',
          }}
        >
          <div
            className="absolute inset-[13px] rounded-full bg-[#fbfbfa]"
            style={{ boxShadow: 'inset 0 2px 4px rgba(0,0,0,.13),inset 0 -1px 2px rgba(255,255,255,.9)' }}
          />
          <span className="relative grid h-20 w-20 place-items-center">
            <svg viewBox="0 0 80 80" fill="none" className="absolute inset-0">
              <circle
                cx="40" cy="40" r="34.3" stroke="#cf3238" strokeWidth="8.3"
                strokeDasharray="46.77 7.1" strokeDashoffset="50.32"
                transform="rotate(-90 40 40)"
              />
            </svg>
            <img src="/brand/gssg-globe.png" alt="" className="block h-[52px] w-[52px]" />
          </span>
        </div>
        <div className="-mt-[3px] h-[15px] w-7" style={{ background: RIBS, clipPath: 'polygon(12% 0,88% 0,72% 100%,28% 100%)' }} />
        <div className="-mt-px h-[13px] w-[17px] rounded-full bg-[#f3f3f1]" style={{ boxShadow: 'inset 0 -2px 3px rgba(0,0,0,.13)' }} />
        <div className="-mt-0.5 h-[25px] w-[25px] rounded-full border-[3.5px] border-[#c3c7cd]" style={{ boxShadow: 'inset 0 1px 1px rgba(255,255,255,.7),0 1px 2px rgba(0,0,0,.14)' }} />
        <div
          className="relative -mt-[5px] h-[62px] w-[31px] rounded-t-lg rounded-b-[11px] border-[1.5px] border-[rgba(150,158,170,.5)]"
          style={{
            background: 'linear-gradient(180deg,rgba(255,255,255,.55),rgba(244,246,248,.4))',
            boxShadow: '0 2px 6px rgba(13,40,69,.13)',
          }}
        >
          <span
            className="absolute bottom-[9px] left-1/2 h-[19px] w-[19px] -translate-x-1/2 rounded-full"
            style={{
              background: 'radial-gradient(circle at 35% 30%,#eef0f2,#b9bec7 68%,#99a0aa)',
              boxShadow: 'inset 0 0 0 3px #cdd1d7,inset 0 0 0 6px #a8aeb8,0 1px 2px rgba(0,0,0,.18)',
            }}
          />
        </div>
      </div>

      {/* The badge card */}
      <div
        className="relative -mt-5 overflow-hidden rounded-[20px] bg-white text-[#1a1d21]"
        style={{
          transform: 'rotate(1deg)',
          boxShadow: '0 24px 60px -20px rgba(13,40,69,.35),0 2px 6px rgba(13,40,69,.08)',
        }}
      >
        <span
          aria-hidden
          className="absolute left-1/2 top-2.5 z-[2] h-3.5 w-16 -translate-x-1/2 rounded-full bg-[#f0eee8]"
          style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,.25)' }}
        />
        <div className="px-6 pb-3.5 pt-[30px] text-center text-white" style={{ background: BAND_GRADIENT }}>
          <p className="text-[11px] font-extrabold uppercase tracking-[.3em] opacity-85">
            {t('employees.activity.badge.company')}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[.18em] opacity-55">
            {t('employees.activity.badge.role')}
          </p>
          <span
            className="relative z-[1] mx-auto mt-4 grid h-[120px] w-[120px] place-items-center overflow-hidden rounded-2xl bg-[#e8edf3] text-[34px] font-extrabold text-[#0d2845]"
            style={{ border: '4px solid rgba(255,255,255,.9)', boxShadow: '0 8px 20px rgba(4,15,30,.35)' }}
          >
            {showPhoto && (
              <img
                src={`/api/v1/employees/${encodeURIComponent(employee.id)}/photo`}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
                onError={() => setPhotoFailed(true)}
              />
            )}
            {!showPhoto && <span aria-hidden>{initials(name)}</span>}
          </span>
        </div>
        <div className="-mt-[60px] bg-white px-6 pb-[18px] pt-[78px] text-center">
          <p dir="auto" className="text-[21px] font-extrabold tracking-[-0.01em] text-[#0d2845]">{name}</p>
          {position && <p dir="auto" className="mt-1 text-[12.5px] text-[#5b6470]">{position}</p>}
          <div aria-hidden className="mx-auto mt-3.5 h-2.5 w-[70%] rounded-full opacity-80" style={{ background: HOLO, backgroundSize: '300% 100%' }} />
          <div className="mt-3 flex justify-center"><StatusPill status={employee.status} /></div>
          <div aria-hidden className="mx-auto mb-1.5 mt-[18px] h-11 w-[78%]" style={{ background: BARCODE }} />
          <p className="font-mono text-[13px] font-semibold tracking-[.34em] text-[#1a1d21]">{employee.id}</p>
        </div>
      </div>

      {/* Actions — theme-token surface, not part of the physical badge */}
      <div className="mt-5 flex gap-2.5">
        <button
          type="button"
          onClick={() => onOpenProfile(employee.id)}
          className="flex-1 rounded-xl bg-primary px-3 py-3 text-[13.5px] font-bold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('employees.activity.openProfile')}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="flex-1 rounded-xl border border-border-strong bg-surface px-3 py-3 text-[13.5px] font-bold text-muted-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('employees.activity.clearEmployee')}
        </button>
      </div>
    </div>
  )
}
```

Adjust `text-muted-foreground` / `text-primary-foreground` utility names to whatever the repo's Tailwind theme actually maps (check a neighbor like `EmployeeActivityLookup.tsx` — it uses `text-muted-foreground`, `bg-primary`, `text-primary-foreground`; keep identical vocabulary).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && pnpm exec vitest run src/components/employees/EmployeeBadgeCard.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/employees/EmployeeBadgeCard.tsx frontend/src/components/employees/EmployeeBadgeCard.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/public/brand/gssg-globe.png
git commit -m "feat(employees): GSSG badge card with retractable reel"
```

---

### Task 2: Activity section toolbar, chips, and badge layout

**Files:**
- Modify: `frontend/src/components/employees/EmployeeActivityLookup.tsx`
- Modify: `frontend/src/components/employees/EmployeeActivitySection.tsx`
- Modify: `frontend/src/components/employees/EmployeeActivityLookup.test.tsx`
- Modify: `frontend/src/components/employees/EmployeeActivitySection.test.tsx`

**Interfaces:**
- Consumes (from Task 1 — import even if Task 1 is still in flight; the contract is fixed):

```ts
import { EmployeeBadgeCard } from './EmployeeBadgeCard'
// <EmployeeBadgeCard employee={employee} onOpenProfile={onOpenProfile} onClear={handleClearEmployee} />
```

- Produces: `EmployeeActivityLookup` new props (drops `selected`):

```ts
interface Props {
  onSelect: (employee: EmployeeListItem) => void
  onOpenProfile: (employeeId: string) => void
}
```

`EmployeeActivitySection`'s public interface is unchanged: `{ onOpenProfile: (employeeId: string) => void }`.

- [ ] **Step 1: Rework `EmployeeActivityLookup` into a toolbar search**

Keep ALL existing mechanics verbatim: `useDebouncedValue(query, 250)`, `useQuery(['employee-activity-lookup', debounced], api.listEmployees({ q: debounced, limit: 8 }))`, `popupOpen`/`dismissedQuery` logic, `handleInputKeyDown`/`handleShowKeyDown`/`handlePopupActionKeyDown`, `selectEmployee` (clears query, calls `onSelect`, refocuses), popup rows with name/G-number/position/`StatusPill` and the two buttons ("Show activity" primary, "Open profile" ghost), loading/error/empty popup states, all existing i18n keys.

Remove: the outer `<section>` card wrapper and the entire `selected != null` header block (lines 93–123 of the current file) and the `selected`/`onClear` props.

New outer markup (replaces the section + relative div):

```tsx
return (
  <div className="relative min-w-0 flex-1 text-start">
    <label htmlFor="employee-activity-lookup" className="sr-only">
      {t('employees.activity.lookupLabel')}
    </label>
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-0 focus-within:ring-2 focus-within:ring-primary">
      <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-faint">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.3-3.3" />
      </svg>
      <input
        ref={inputRef}
        id="employee-activity-lookup"
        type="search"
        role="searchbox"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setDismissedQuery(null) }}
        onKeyDown={handleInputKeyDown}
        placeholder={t('employees.activity.lookupPlaceholder')}
        aria-expanded={popupOpen}
        aria-controls="employee-activity-lookup-results"
        autoComplete="off"
        className="w-full min-w-0 border-0 bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
    </div>
    {popupOpen && (
      /* existing <ul> popup unchanged, still absolute inset-x-0 top-[calc(100%+8px)] */
    )}
  </div>
)
```

- [ ] **Step 2: Rework `EmployeeActivitySection` layout**

Data layer unchanged (query, `dayGroups`, `removeDestinationCache`, handlers). Presentation changes:

1. **Toolbar** replaces the current `mb-6 grid ...` block (lines 122–149):

```tsx
<div className="mb-6 flex flex-wrap items-center gap-2.5">
  <EmployeeActivityLookup onSelect={handleEmployeeSelect} onOpenProfile={onOpenProfile} />
  <div role="group" aria-label={t('employees.activity.typeLabel')} className="flex flex-wrap gap-1.5">
    {(['all', 'document', 'leave', 'violation', 'ledger'] as const).map((value) => (
      <button
        key={value}
        type="button"
        aria-pressed={kind === value}
        onClick={() => handleKindChange(value)}
        className={
          kind === value
            ? 'rounded-full bg-primary px-4 py-2.5 text-[12.5px] font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
            : 'rounded-full border border-border bg-surface px-4 py-2.5 text-[12.5px] font-bold text-muted-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        }
      >
        {t(value === 'all' ? 'employees.activity.all' : `employees.activity.${value}`)}
      </button>
    ))}
  </div>
</div>
```

2. **Badge layout**: wrap toolbar + states + list in a grid that gains a left column when an employee is selected:

```tsx
<div className={employee ? 'grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start' : ''}>
  {employee && (
    <EmployeeBadgeCard employee={employee} onOpenProfile={onOpenProfile} onClear={handleClearEmployee} />
  )}
  <div className="min-w-0">
    {/* toolbar, pending/error/empty states, list, load more — all existing blocks */}
  </div>
</div>
```

3. **Rows** — replace the 6-column table (headers div + `ActivityRow` grid) with the F3 row: kind icon tile, title + localized action (+detail), employee identity (browse mode only — hide the employee cell when `employee != null`), reference, time. The row STAYS a `<Link to={activityHref(item)}>`; the destination label (`t(destinationKey)`) becomes `sr-only` text inside the link so link accessible names keep working. Kind tiles use the per-kind soft/color pairs — add them as a local constant:

```tsx
const KIND_STYLES: Record<EmployeeActivityKind, { soft: string; color: string; icon: React.JSX.Element }> = {
  document: { soft: '#e6f0f6', color: '#0d5c8a', icon: /* file svg */ },
  leave: { soft: '#e5f3ee', color: '#047857', icon: /* calendar svg */ },
  violation: { soft: '#f9ede4', color: '#b3541e', icon: /* triangle svg */ },
  ledger: { soft: '#f1eef8', color: '#6b4fb0', icon: /* envelope svg */ },
}
```

(SVG paths from the locked mockup: document `M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V8h4.5`; leave `M8 2v3M16 2v3M3.5 9.5h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5z`; violation `M12 3 2.5 20h19L12 3zm0 6v5m0 3v.5`; ledger `M3.5 5.5h17v13h-17zM3.5 6.5 12 13l8.5-6.5`; stroke=currentColor, strokeWidth 1.8, round caps/joins, 16×16.)

Row markup (`ActivityRow` keeps its props, plus a new `showEmployee: boolean`):

```tsx
<Link to={activityHref(item)} className="group flex items-center gap-3.5 border-b border-hairline px-5 py-3.5 last:border-b-0 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px]" style={{ background: kindStyle.soft, color: kindStyle.color }}>
    {kindStyle.icon}
  </span>
  <span className="min-w-0 flex-1">
    <span dir="auto" className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
    <span dir="auto" className="mt-0.5 block truncate text-xs text-muted-foreground">{action}{item.detail ? ` · ${item.detail}` : ''}</span>
  </span>
  {showEmployee && (
    <span className="hidden w-[210px] shrink-0 items-center gap-2.5 md:flex">
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[10.5px] font-bold text-primary-on-soft">{/* name initials */}</span>
      <span className="min-w-0">
        <span dir="auto" className="block truncate text-[13px] font-semibold text-foreground">{employeeName}</span>
        <span dir="auto" className="block font-mono text-[11px] text-faint">{item.employee_id}</span>
      </span>
    </span>
  )}
  <span dir="auto" className="hidden shrink-0 font-mono text-xs tabular-nums text-muted-foreground sm:block">{item.reference}</span>
  <span className="w-[74px] shrink-0 text-end text-xs tabular-nums text-muted-foreground">
    <span className="sr-only">{dayFormatter.format(date)} · </span>{dateTimeFormatter.format(date)}
  </span>
  <span className="sr-only">{t(destinationKey)}</span>
</Link>
```

Keep the `dayGroups` `<h3>` day headers exactly as they are (tests rely on `role: heading`). Keep the pending/error/empty blocks and the load-more button (its `w-full` + `focus-visible:ring-inset` classes are asserted by tests). Delete the desktop column-header row entirely.

- [ ] **Step 3: Update `EmployeeActivityLookup.test.tsx`**

- Drop `selected`/`onClear` from the helper props and delete tests that exercised the selected-employee header card (name/position/Open profile/Clear buttons shown when `selected != null`) — that display now lives in `EmployeeBadgeCard` (covered by Task 1's tests).
- Keep and adapt: debounce/popup open, loading/error/empty popup states, keyboard navigation (ArrowDown into results, ArrowUp, Escape dismiss), "Show activity" calls `onSelect` and clears the input, "Open profile" calls `onOpenProfile`, Arabic/RTL name rendering (`dir="auto"`), `statefulLookup` becomes stateless (component no longer receives `selected`).

- [ ] **Step 4: Update `EmployeeActivitySection.test.tsx`**

- The `EmployeeActivityLookup` module mock loses `selected`/`onClear` (keep `mock-select-G3190` / `mock-open-profile-G3190` buttons; move `mock-clear-employee` semantics to the real clear path: mock `./EmployeeBadgeCard` with a button that calls `onClear`):

```tsx
vi.mock('./EmployeeBadgeCard', () => ({
  EmployeeBadgeCard: ({ employee, onClear }: { employee: EmployeeListItem; onClear: () => void }) => (
    <div data-testid="badge-card">
      <span>badge:{employee.id}</span>
      <button type="button" onClick={onClear}>mock-clear-employee</button>
    </div>
  ),
}))
```

- Replace both `userEvent.selectOptions(screen.getByRole('combobox', ...), 'leave')` calls with `userEvent.click(within(screen.getByRole('group', { name: /activity type/i })).getByRole('button', { name: 'Leave' }))`.
- Replace the two structural tests ("keeps employee and time first…" and "uses desktop headers…") with:

```tsx
it('shows the employee identity on rows only when browsing all employees', async () => {
  wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
  const row = await screen.findByRole('link', { name: /open document/i })
  expect(within(row).getByText('EMPLOYEE 0')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
  await screen.findByTestId('badge-card')
  const rows = await screen.findAllByRole('link', { name: /open/i })
  for (const r of rows) expect(within(r).queryByText(/^EMPLOYEE/)).not.toBeInTheDocument()
})

it('mounts the badge card only while an employee is selected', async () => {
  wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
  await screen.findByText('Employment Certificate')
  expect(screen.queryByTestId('badge-card')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
  expect(await screen.findByTestId('badge-card')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'mock-clear-employee' }))
  await waitFor(() => expect(screen.queryByTestId('badge-card')).not.toBeInTheDocument())
})
```

- All remaining tests (default fetch args, reset-to-first-page, clearing employee, load-more append/hide, pending/error/empty/i18n-parity, day-heading grouping, `dir="auto"` reference, single-title render) must pass against the new markup with at most selector adjustments (e.g. reference is `hidden sm:block` — jsdom does not apply media queries, so `getByText('#11')` still resolves).

- [ ] **Step 5: Run the four touched test files**

Run: `cd frontend && pnpm exec vitest run src/components/employees/EmployeeActivitySection.test.tsx src/components/employees/EmployeeActivityLookup.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/employees/EmployeeActivitySection.tsx frontend/src/components/employees/EmployeeActivityLookup.tsx frontend/src/components/employees/EmployeeActivitySection.test.tsx frontend/src/components/employees/EmployeeActivityLookup.test.tsx
git commit -m "feat(employees): F3 activity redesign - toolbar search, kind chips, badge layout"
```

---

### Task 3 (coordinator): Validate, merge, deploy

- [ ] **Step 1:** `cd frontend && pnpm exec vitest run` — full frontend suite green.
- [ ] **Step 2:** `pnpm build` (tsc -b + vite) — clean.
- [ ] **Step 3:** `pnpm lint` — clean.
- [ ] **Step 4:** Visual smoke: `pnpm dev` + headless-Chrome screenshot of `/employees` (browse + selected states) if a backend is reachable; otherwise verify via component tests only and note it.
- [ ] **Step 5:** Merge `feature/employee-activity-badge` → `main`, push `origin/main`.
- [ ] **Step 6:** Deploy = the office server pulls `origin/main` (`mng update` there builds + restarts). No local service exists on this checkout.
