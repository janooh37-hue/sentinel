# Send-to-Group Record Picker + Employee Mention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the WhatsApp Send-to-Group composer, replace the bare numeric record-ID input with a search+preview picker, and add an employee search that inserts a person's name + G-number (+ optional designation) as editable message text.

**Architecture:** Frontend-only. Two new self-contained components under `frontend/src/pages/announcements/` (`RecordAnnouncePicker`, `EmployeeMentionField`) wired into `SendToGroupPage.tsx`. The record picker reuses the existing `DocPdfCanvas` (pdf.js, WebView2-safe) for preview and `currentBookDocId` to resolve a book's PDF. The send payload is unchanged: a picked record still submits as `book_id`; a mention is plain text in the existing `text` field.

**Tech Stack:** React 19 + TypeScript, React Query, Tailwind 4, vitest + @testing-library/react + userEvent, react-i18next.

## Global Constraints

- **Frontend-only.** No backend, Pydantic schema, route, or DB change. Therefore **no `openapi.json` / `api.types.ts` regeneration** and **no Alembic migration**.
- **Send payload contract is fixed:** `POST /announcements/send` multipart with `group_ids[]`, `text?`, `book_id?`, `file?`. Do not change it. A picked record sets `book_id` (stringified id); a mention only alters `text`.
- **Bilingual parity is mandatory.** Every new UI string gets a key in **both** `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`, nested under the existing `sendToGroup` object. Use logical CSS (`ms-`/`me-`, `text-start`), keep `dir="auto"` on free text.
- **Verified reference symbols (already exist, do not recreate):**
  - `import { api, type BookRead, type EmployeeListItem } from '@/lib/api'`
  - `api.listBooks({ q, limit }) → Promise<BookListResponse>` where `BookListResponse = { items: BookRead[]; total; limit; offset }`.
  - `api.listEmployees({ q, limit }) → Promise<EmployeeListResponse>` where `EmployeeListResponse = { items: EmployeeListItem[]; ... }`.
  - `api.documentDownloadUrl(docId: number, 'pdf') → string`.
  - `import { currentBookDocId } from '@/lib/bookDocument'` — `currentBookDocId(book) → number | undefined`.
  - `DocPdfCanvas` — **default export** at `@/pages/application/DocPdfCanvas`, props `{ pdfUrl: string; docxUrl?: string }`.
  - `BookRead` fields used: `id: number`, `ref_number: string`, `subject: string | null`, `versions?: BookVersionRead[]`.
  - `EmployeeListItem` fields used: `id: string` (G-number), `name_en: string`, `name_ar: string | null`, `position: string | null`, `position_ar?: string | null`.
- **Commands** (run from repo root):
  - One test file: `pnpm -C frontend exec vitest run src/pages/announcements/<file>.test.tsx`
  - Typecheck: `pnpm -C frontend exec tsc -b --noEmit`
  - Lint: `pnpm -C frontend run lint`
  - Build: `pnpm -C frontend run build`

---

### Task 1: `RecordAnnouncePicker` component

A modal dialog: search records (left), preview the selected record's PDF (right), Confirm returns the pick. Confirm is disabled for a record with no attachable PDF.

**Files:**
- Create: `frontend/src/pages/announcements/RecordAnnouncePicker.tsx`
- Test: `frontend/src/pages/announcements/RecordAnnouncePicker.test.tsx`

**Interfaces:**
- Consumes: `api.listBooks`, `currentBookDocId`, `api.documentDownloadUrl`, `DocPdfCanvas`.
- Produces:
  - `export interface PickedBook { id: number; ref: string; subject: string }`
  - `export function RecordAnnouncePicker(props: { open: boolean; onClose: () => void; onPick: (book: PickedBook) => void }): React.JSX.Element | null`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/pages/announcements/RecordAnnouncePicker.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
// Mocked so pdf.js never loads in jsdom; the picker lazy-imports this module.
vi.mock('../application/DocPdfCanvas', () => ({
  default: ({ pdfUrl }: { pdfUrl: string }) => <div data-testid="doc-preview">{pdfUrl}</div>,
}))
vi.mock('../../lib/api', () => ({
  api: {
    listBooks: vi.fn(),
    documentDownloadUrl: (id: number, fmt: string) => `/api/v1/documents/${id}/download?format=${fmt}`,
  },
}))

import { api, type BookRead } from '../../lib/api'
import { RecordAnnouncePicker, type PickedBook } from './RecordAnnouncePicker'

const withDoc = {
  id: 5, ref_number: 'GS-0005', subject: 'Leave request', versions: [{ version_no: 1, document_id: 90 }],
} as unknown as BookRead
const noDoc = {
  id: 6, ref_number: 'GS-0006', subject: 'No file', versions: [],
} as unknown as BookRead

function renderPicker(onPick: (b: PickedBook) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RecordAnnouncePicker open onClose={() => {}} onPick={onPick} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.listBooks).mockResolvedValue({ items: [withDoc, noDoc], total: 2, limit: 20, offset: 0 })
})

describe('RecordAnnouncePicker', () => {
  it('lists search results', async () => {
    renderPicker(() => {})
    expect(await screen.findByText('GS-0005')).toBeInTheDocument()
    expect(screen.getByText('GS-0006')).toBeInTheDocument()
  })

  it('previews the selected record and confirms the pick', async () => {
    const onPick = vi.fn()
    renderPicker(onPick)
    await userEvent.click(await screen.findByText('GS-0005'))
    // preview renders the doc PDF url
    expect(await screen.findByTestId('doc-preview')).toHaveTextContent('/documents/90/download?format=pdf')
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.picker.confirm' }))
    expect(onPick).toHaveBeenCalledWith({ id: 5, ref: 'GS-0005', subject: 'Leave request' })
  })

  it('disables confirm for a record with no attachable document', async () => {
    renderPicker(() => {})
    await userEvent.click(await screen.findByText('GS-0006'))
    expect(await screen.findByText('sendToGroup.picker.noDocument')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sendToGroup.picker.confirm' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/RecordAnnouncePicker.test.tsx`
Expected: FAIL — cannot resolve `./RecordAnnouncePicker`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/pages/announcements/RecordAnnouncePicker.tsx
/**
 * RecordAnnouncePicker — search records and attach one to a group announcement.
 *
 * Left: debounced record search (api.listBooks). Right: a pdf.js preview of the
 * selected record's current PDF (DocPdfCanvas — WebView2-safe base64 canvas,
 * same renderer the doc-generation preview uses). Records with no resolvable
 * PDF can't be confirmed — we fail here instead of after the send, which is
 * where the backend would raise BookPdfError.
 *
 * Bilingual via useTranslation(); logical CSS; dir="auto" on record text.
 */
import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { api, type BookRead } from '@/lib/api'
import { currentBookDocId } from '@/lib/bookDocument'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

export interface PickedBook {
  id: number
  ref: string
  subject: string
}

export function RecordAnnouncePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (book: PickedBook) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<BookRead | null>(null)

  const booksQuery = useQuery({
    queryKey: ['announce-record-picker', q],
    queryFn: () => api.listBooks({ q, limit: 20 }),
    enabled: open,
    staleTime: 30_000,
  })

  const docId = selected ? currentBookDocId(selected) : undefined
  const pdfUrl = docId != null ? api.documentDownloadUrl(docId, 'pdf') : null

  if (!open) return null

  const rowCls = (active: boolean): string =>
    `w-full rounded-md border px-3 py-2 text-start ${
      active ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-tinted'
    }`

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('sendToGroup.picker.title')}
    >
      <div className="flex max-h-[85vh] w-full max-w-[820px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl md:flex-row">
        {/* Left: search + results */}
        <div className="flex min-h-0 flex-1 flex-col border-b border-hairline p-3 md:border-b-0 md:border-e">
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('sendToGroup.picker.searchPlaceholder')}
              dir="auto"
              className="h-9 flex-1 rounded-md border border-border bg-surface px-3 text-[0.85em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label={t('sendToGroup.picker.close')}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-tinted"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
            {(booksQuery.data?.items ?? []).map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => setSelected(b)} className={rowCls(selected?.id === b.id)}>
                  <span className="block text-[0.85em] font-medium text-foreground" dir="auto">
                    {b.ref_number}
                  </span>
                  <span className="block text-[0.78em] text-muted-foreground" dir="auto">
                    {b.subject ?? ''}
                  </span>
                </button>
              </li>
            ))}
            {booksQuery.data && booksQuery.data.items.length === 0 && (
              <li className="px-3 py-2 text-[0.82em] text-muted-foreground" dir="auto">
                {t('sendToGroup.picker.noResults')}
              </li>
            )}
          </ul>
        </div>

        {/* Right: preview + confirm */}
        <div className="flex min-h-0 flex-1 flex-col p-3 md:w-[48%]">
          <div className="min-h-0 flex-1">
            {!selected ? (
              <p className="flex h-full items-center justify-center text-[0.82em] text-muted-foreground" dir="auto">
                {t('sendToGroup.picker.selectHint')}
              </p>
            ) : pdfUrl ? (
              <Suspense fallback={<div className="h-full w-full animate-pulse bg-surface-tinted" />}>
                <DocPdfCanvas pdfUrl={pdfUrl} />
              </Suspense>
            ) : (
              <p className="flex h-full items-center justify-center text-center text-[0.82em] text-muted-foreground" dir="auto">
                {t('sendToGroup.picker.noDocument')}
              </p>
            )}
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={!selected || !pdfUrl}
              onClick={() => {
                if (selected && pdfUrl) {
                  onPick({ id: selected.id, ref: selected.ref_number, subject: selected.subject ?? '' })
                }
              }}
              className="rounded-md bg-primary px-4 py-2 text-[0.85em] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t('sendToGroup.picker.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/RecordAnnouncePicker.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/announcements/RecordAnnouncePicker.tsx frontend/src/pages/announcements/RecordAnnouncePicker.test.tsx
git commit -m "feat(announcements): RecordAnnouncePicker search+preview picker"
```

---

### Task 2: Wire the record picker into `SendToGroupPage`

Replace the numeric `book_id` input with a "Choose record…" button that opens the picker; show a chip once picked; keep `bookId` as the submit source of truth (payload unchanged).

**Files:**
- Modify: `frontend/src/pages/announcements/SendToGroupPage.tsx` (imports; new state; replace lines 315–328 book block; render picker)
- Modify: `frontend/src/pages/announcements/SendToGroupPage.test.tsx` (add one integration test)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (picker keys)

**Interfaces:**
- Consumes: `RecordAnnouncePicker`, `PickedBook` from Task 1.
- Produces: no new exports; `book_id` still submitted from `bookId` state.

- [ ] **Step 1: Add the failing integration test**

Add inside the existing `describe('SendToGroupPage', ...)` block in `SendToGroupPage.test.tsx`. First, at the top of the file with the other `vi.mock` calls, stub the picker so it deterministically returns a pick:

```tsx
// with the other vi.mock(...) calls near the top of SendToGroupPage.test.tsx
vi.mock('./RecordAnnouncePicker', () => ({
  RecordAnnouncePicker: ({ open, onPick }: { open: boolean; onPick: (b: unknown) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick({ id: 42, ref: 'GS-0042', subject: 'Memo' })}>
        stub-pick-record
      </button>
    ) : null,
}))
```

Add `sendAnnouncement: vi.fn().mockResolvedValue({ announcement_id: 1, sent: 1, failed: 0, results: [] })` behaviour in the test (the api mock already lists `sendAnnouncement`). Then the test:

```tsx
it('attaches a picked record as book_id in the send payload', async () => {
  vi.mocked(api.sendAnnouncement).mockResolvedValue({
    announcement_id: 1, sent: 1, failed: 0, results: [],
  })
  renderPage()
  // select the group
  await userEvent.click(await screen.findByRole('checkbox'))
  // switch attach mode to "book"
  await userEvent.click(screen.getByRole('radio', { name: 'sendToGroup.attachBook' }))
  // open picker + pick
  await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.picker.choose' }))
  await userEvent.click(screen.getByRole('button', { name: 'stub-pick-record' }))
  // chip shows the picked ref
  expect(await screen.findByText('GS-0042')).toBeInTheDocument()
  // send
  await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.send' }))
  await waitFor(() => expect(api.sendAnnouncement).toHaveBeenCalled())
  const form = vi.mocked(api.sendAnnouncement).mock.calls[0][0] as FormData
  expect(form.get('book_id')).toBe('42')
})
```

Ensure the test file imports `waitFor` (add to the existing `@testing-library/react` import).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/SendToGroupPage.test.tsx`
Expected: FAIL — button `sendToGroup.picker.choose` not found (radio name matches on the current label key).

- [ ] **Step 3: Implement — imports + state**

At the top of `SendToGroupPage.tsx`, add to imports:

```tsx
import { RecordAnnouncePicker, type PickedBook } from './RecordAnnouncePicker'
```

Below the existing attachment state (`const [hasFile, setHasFile] = useState(false)`), add:

```tsx
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickedBook, setPickedBook] = useState<PickedBook | null>(null)
```

- [ ] **Step 4: Implement — replace the book input block**

Replace the whole `{attachMode === 'book' && ( ... )}` block (current lines 315–328) with:

```tsx
          {attachMode === 'book' && (
            <div className="mt-3">
              {pickedBook ? (
                <div className="flex items-center gap-3 rounded-md border border-border bg-surface/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[0.85em] font-medium text-foreground" dir="auto">
                      {pickedBook.ref}
                    </p>
                    <p className="truncate text-[0.78em] text-muted-foreground" dir="auto">
                      {pickedBook.subject}
                    </p>
                  </div>
                  <div className="ms-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="rounded-md border border-border px-3 py-1.5 text-[0.8em] font-medium text-foreground hover:bg-surface-tinted"
                    >
                      {t('sendToGroup.picker.change')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPickedBook(null)
                        setBookId('')
                      }}
                      className="rounded-md border border-accent/40 px-3 py-1.5 text-[0.8em] font-medium text-accent hover:bg-accent/10"
                    >
                      {t('sendToGroup.picker.clear')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="rounded-md border border-border px-4 py-2 text-[0.85em] font-medium text-foreground hover:bg-surface-tinted"
                >
                  {t('sendToGroup.picker.choose')}
                </button>
              )}
            </div>
          )}
```

- [ ] **Step 5: Implement — render the picker**

Just before the closing `</div>` of the page (next to `<GatewayConnectDialog ... />`), add:

```tsx
      <RecordAnnouncePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(b) => {
          setPickedBook(b)
          setBookId(String(b.id))
          setPickerOpen(false)
        }}
      />
```

- [ ] **Step 6: Add locale keys**

In `frontend/src/locales/en.json`, inside the existing `"sendToGroup"` object, add:

```json
"picker": {
  "title": "Attach a record",
  "close": "Close",
  "choose": "Choose record…",
  "change": "Change",
  "clear": "Remove",
  "searchPlaceholder": "Search records by ref or subject",
  "noResults": "No records found",
  "selectHint": "Select a record to preview",
  "noDocument": "This record has no document to attach",
  "confirm": "Attach"
}
```

In `frontend/src/locales/ar.json`, inside `"sendToGroup"`, add the parallel keys:

```json
"picker": {
  "title": "إرفاق سجل",
  "close": "إغلاق",
  "choose": "اختر سجلاً…",
  "change": "تغيير",
  "clear": "إزالة",
  "searchPlaceholder": "ابحث عن السجلات بالرقم أو الموضوع",
  "noResults": "لا توجد سجلات",
  "selectHint": "اختر سجلاً للمعاينة",
  "noDocument": "لا يوجد مستند قابل للإرفاق لهذا السجل",
  "confirm": "إرفاق"
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/SendToGroupPage.test.tsx`
Expected: PASS (all existing + the new payload test).
Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/announcements/SendToGroupPage.tsx frontend/src/pages/announcements/SendToGroupPage.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(announcements): wire record picker into Send-to-Group"
```

---

### Task 3: `EmployeeMentionField` component

Search employees; a "include designation" toggle; picking one calls `onInsert` with the formatted note. The formatter is a pure exported function for direct testing.

**Files:**
- Create: `frontend/src/pages/announcements/EmployeeMentionField.tsx`
- Test: `frontend/src/pages/announcements/EmployeeMentionField.test.tsx`

**Interfaces:**
- Consumes: `api.listEmployees`, `EmployeeListItem`.
- Produces:
  - `export function buildMention(emp: EmployeeListItem, lang: string, includeDesignation: boolean): string`
  - `export function EmployeeMentionField(props: { onInsert: (text: string) => void }): React.JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/pages/announcements/EmployeeMentionField.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

let mockLang = 'en'
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: mockLang } }),
}))
vi.mock('../../lib/api', () => ({ api: { listEmployees: vi.fn() } }))

import { api, type EmployeeListItem } from '../../lib/api'
import { EmployeeMentionField, buildMention } from './EmployeeMentionField'

const emp = {
  id: 'G-1234', name_en: 'Ahmed Al-Sayed', name_ar: 'أحمد السيد',
  position: 'Senior Officer', position_ar: 'ضابط أول',
} as unknown as EmployeeListItem

describe('buildMention', () => {
  it('formats name + G-number, no designation by default', () => {
    expect(buildMention(emp, 'en', false)).toBe('Ahmed Al-Sayed (G-1234)')
  })
  it('appends designation when requested', () => {
    expect(buildMention(emp, 'en', true)).toBe('Ahmed Al-Sayed (G-1234), Senior Officer')
  })
  it('uses Arabic name + designation when lang is ar', () => {
    expect(buildMention(emp, 'ar', true)).toBe('أحمد السيد (G-1234)، ضابط أول')
  })
  it('falls back to the English name when Arabic is missing', () => {
    const noAr = { ...emp, name_ar: null } as EmployeeListItem
    expect(buildMention(noAr, 'ar', false)).toBe('Ahmed Al-Sayed (G-1234)')
  })
})

function renderField(onInsert: (t: string) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <EmployeeMentionField onInsert={onInsert} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockLang = 'en'
  vi.mocked(api.listEmployees).mockResolvedValue({ items: [emp], total: 1, limit: 6, offset: 0 })
})

describe('EmployeeMentionField', () => {
  it('searches and inserts the formatted mention on pick', async () => {
    const onInsert = vi.fn()
    renderField(onInsert)
    await userEvent.type(screen.getByPlaceholderText('sendToGroup.mention.searchPlaceholder'), 'ahmed')
    await userEvent.click(await screen.findByRole('button', { name: /G-1234/ }))
    expect(onInsert).toHaveBeenCalledWith('Ahmed Al-Sayed (G-1234)')
  })
})
```

Note: Arabic uses the Arabic comma `،` before the designation — the formatter must branch on `lang`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/EmployeeMentionField.test.tsx`
Expected: FAIL — cannot resolve `./EmployeeMentionField`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/pages/announcements/EmployeeMentionField.tsx
/**
 * EmployeeMentionField — search an employee and insert a note (name + G-number,
 * optionally the designation) into the announcement message. Insertion is plain
 * text the operator can edit; there is no structured backend field.
 *
 * buildMention is exported and pure so the formatting is unit-tested directly.
 * Localizes name/designation to the active UI language (Arabic uses the Arabic
 * comma between name and designation).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api, type EmployeeListItem } from '@/lib/api'

export function buildMention(
  emp: EmployeeListItem,
  lang: string,
  includeDesignation: boolean,
): string {
  const ar = lang.startsWith('ar')
  const name = (ar ? emp.name_ar : emp.name_en) || emp.name_en || emp.name_ar || emp.id
  let out = `${name} (${emp.id})`
  if (includeDesignation) {
    const desig = (ar ? emp.position_ar : emp.position) || emp.position || emp.position_ar
    if (desig) out += ar ? `، ${desig}` : `, ${desig}`
  }
  return out
}

export function EmployeeMentionField({
  onInsert,
}: {
  onInsert: (text: string) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [q, setQ] = useState('')
  const [includeDesignation, setIncludeDesignation] = useState(false)

  const empQuery = useQuery({
    queryKey: ['announce-mention-employees', q],
    queryFn: () => api.listEmployees({ q, limit: 6 }),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  })

  const ar = i18n.language.startsWith('ar')

  return (
    <div className="mt-3">
      <label className="mb-1 block text-[0.82em] text-muted-foreground">
        {t('sendToGroup.mention.label')}
      </label>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('sendToGroup.mention.searchPlaceholder')}
        dir="auto"
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[0.85em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
      <label className="mt-1.5 flex w-fit items-center gap-2 text-[0.8em] text-muted-foreground">
        <input
          type="checkbox"
          checked={includeDesignation}
          onChange={(e) => setIncludeDesignation(e.target.checked)}
          className="h-3.5 w-3.5 accent-primary"
        />
        {t('sendToGroup.mention.includeDesignation')}
      </label>
      {q.trim().length > 0 && (
        <ul className="mt-1 space-y-1">
          {(empQuery.data?.items ?? []).map((emp) => (
            <li key={emp.id}>
              <button
                type="button"
                onClick={() => {
                  onInsert(buildMention(emp, i18n.language, includeDesignation))
                  setQ('')
                }}
                className="w-full rounded-md border border-border px-3 py-1.5 text-start text-[0.82em] hover:bg-surface-tinted"
              >
                <span dir="auto" className="text-foreground">
                  {(ar ? emp.name_ar : emp.name_en) || emp.name_en}
                </span>
                <span className="ms-1 text-muted-foreground">({emp.id})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/EmployeeMentionField.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/announcements/EmployeeMentionField.tsx frontend/src/pages/announcements/EmployeeMentionField.test.tsx
git commit -m "feat(announcements): EmployeeMentionField with buildMention formatter"
```

---

### Task 4: Wire employee mention into `SendToGroupPage`

Add the mention field under the message textarea; insert the note at the caret (append fallback); it flows out in the existing `text` field.

**Files:**
- Modify: `frontend/src/pages/announcements/SendToGroupPage.tsx` (import; textarea ref; insert handler; render field)
- Modify: `frontend/src/pages/announcements/SendToGroupPage.test.tsx` (one integration test)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (mention keys)

**Interfaces:**
- Consumes: `EmployeeMentionField` from Task 3.
- Produces: no new exports; mention text merges into `message` → submitted as `text`.

- [ ] **Step 1: Add the failing integration test**

At the top of `SendToGroupPage.test.tsx` with the other mocks, stub the mention field:

```tsx
vi.mock('./EmployeeMentionField', () => ({
  EmployeeMentionField: ({ onInsert }: { onInsert: (t: string) => void }) => (
    <button type="button" onClick={() => onInsert('Ahmed Al-Sayed (G-1234)')}>
      stub-mention
    </button>
  ),
}))
```

Test:

```tsx
it('inserts an employee mention into the message and sends it as text', async () => {
  vi.mocked(api.sendAnnouncement).mockResolvedValue({
    announcement_id: 1, sent: 1, failed: 0, results: [],
  })
  renderPage()
  await userEvent.click(await screen.findByRole('checkbox'))
  await userEvent.click(screen.getByRole('button', { name: 'stub-mention' }))
  // the mention text is now in the textarea
  expect(screen.getByRole('textbox')).toHaveValue('Ahmed Al-Sayed (G-1234)')
  await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.send' }))
  await waitFor(() => expect(api.sendAnnouncement).toHaveBeenCalled())
  const form = vi.mocked(api.sendAnnouncement).mock.calls[0][0] as FormData
  expect(form.get('text')).toBe('Ahmed Al-Sayed (G-1234)')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/SendToGroupPage.test.tsx`
Expected: FAIL — no `stub-mention` button (field not rendered yet).

- [ ] **Step 3: Implement — import + textarea ref + insert handler**

Add to imports:

```tsx
import { EmployeeMentionField } from './EmployeeMentionField'
```

Add a ref near the message state (`const [message, setMessage] = useState('')`):

```tsx
  const messageRef = useRef<HTMLTextAreaElement>(null)
```

Add the insert handler (near `handleFileChange`):

```tsx
  const insertMention = useCallback((text: string): void => {
    const el = messageRef.current
    setMessage((prev) => {
      if (!el) return prev ? `${prev} ${text}` : text
      const start = el.selectionStart ?? prev.length
      const end = el.selectionEnd ?? prev.length
      return prev.slice(0, start) + text + prev.slice(end)
    })
  }, [])
```

- [ ] **Step 4: Implement — attach ref + render the field**

Add `ref={messageRef}` to the existing `<textarea ...>` (in the message `<section>`). Immediately after the `</textarea>` (still inside the message `<section>`), add:

```tsx
          <EmployeeMentionField onInsert={insertMention} />
```

- [ ] **Step 5: Add locale keys**

In `frontend/src/locales/en.json`, inside `"sendToGroup"`, add:

```json
"mention": {
  "label": "Mention an employee",
  "searchPlaceholder": "Search by name or G-number",
  "includeDesignation": "Include designation"
}
```

In `frontend/src/locales/ar.json`, inside `"sendToGroup"`, add:

```json
"mention": {
  "label": "الإشارة إلى موظف",
  "searchPlaceholder": "ابحث بالاسم أو الرقم الوظيفي",
  "includeDesignation": "تضمين المسمى الوظيفي"
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/SendToGroupPage.test.tsx`
Expected: PASS.
Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/announcements/SendToGroupPage.tsx frontend/src/pages/announcements/SendToGroupPage.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(announcements): wire employee mention into Send-to-Group"
```

---

### Task 5: Bilingual review + full gates + build

Verify EN/AR parity, RTL correctness, and that the whole frontend suite + typecheck + lint + build are green.

**Files:** none created; may fix issues the reviewer finds.

- [ ] **Step 1: Run the i18n-rtl-reviewer agent** on the diff (the four new/changed locale keys under `sendToGroup.picker` / `sendToGroup.mention`, both components, and the page). Fix any parity/RTL findings inline (e.g. missing key, hard-coded left/right, EN leaking into AR). Re-run the affected vitest file after any fix.

- [ ] **Step 2: Full frontend gates**

Run each and confirm green:
```bash
pnpm -C frontend exec vitest run src/pages/announcements
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```
Expected: all pass, no new warnings.

- [ ] **Step 3: Build**

Run: `pnpm -C frontend run build`
Expected: `tsc + vite build` completes and writes to the backend static dir with no errors.

- [ ] **Step 4: Commit any review fixes**

```bash
git add -A
git commit -m "chore(announcements): i18n/RTL review fixes for Send-to-Group picker + mention"
```

(If Step 1 produced no changes, skip this commit.)

---

## Self-Review

**Spec coverage:**
- Record search+preview picker replacing the ID box → Tasks 1–2. ✓
- Preview via scan-inbox-style pdf.js canvas (`DocPdfCanvas`) → Task 1. ✓
- No-document state disables confirm (fail in-picker, not at send) → Task 1. ✓
- Send payload unchanged (`book_id`) → Task 2 asserts `form.get('book_id')`. ✓
- Employee search → insert name + G-number, designation optional, localized, editable text → Tasks 3–4. ✓
- Both usable together (independent of attach mode) → mention lives in the message section, record in the attachment section; Task 4 test mentions without touching attach mode. ✓
- Bilingual parity + RTL + i18n-rtl-reviewer → keys added in Tasks 2/4, reviewed in Task 5. ✓
- No backend/schema/migration/api.types change → Global Constraints; no such steps exist. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command has expected output.

**Type consistency:** `PickedBook { id: number; ref: string; subject: string }` defined in Task 1, consumed identically in Task 2. `buildMention(emp, lang, includeDesignation)` defined in Task 3, consumed by `EmployeeMentionField` in the same file. `onInsert(text: string)` matches `insertMention` signature in Task 4. `RecordAnnouncePicker` props `{ open, onClose, onPick }` match the render in Task 2. Payload field names (`group_ids`, `text`, `book_id`, `file`) match the existing mutation untouched.
