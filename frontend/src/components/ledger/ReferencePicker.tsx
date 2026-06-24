/**
 * ReferencePicker — body-portaled popover for the Ledger → Outlook compose
 * (Phase 6, Task 3). A search box over **Books / records** (`listBooks({ q })`,
 * 📕 `ref_number` + subject) and **Employees** (`listEmployees({ q })`, 👤
 * `id` + name), grouped. Selecting a result calls `onPick(ComposeReference)`.
 *
 * Two-pane document browser (impeccable overdrive): the panel widens to ~600px
 * with a results list on the inline-start side and a **preview pane** on the
 * inline-end. Hovering / focusing a row previews that record so you can choose
 * by the actual document + its details (subject, category, date, status), not
 * only the ref number. Books whose current version has a backing document
 * (`currentBookDocId`) embed their PDF via `<object>` with a graceful fallback;
 * the book-level `doc_id` is a legacy placeholder the backend leaves null, so
 * the document id is derived from the latest version. The inline first-page
 * *image* render (a server
 * `/preview` like the employee vault) is a backend follow-up — until then the
 * embed + "Open" + the meta block carry the recognition.
 *
 * Like `RecipientChipsInput`, the panel is a `position: fixed` portal anchored
 * to the trigger — per the repo's floating-ui-portal pattern a hand-rolled
 * absolute popover would clip inside the compose overlay's `overflow`/
 * `transform` ancestors.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileText, ExternalLink } from 'lucide-react'

import { api } from '@/lib/api'
import type { BookRead, EmployeeListItem } from '@/lib/api'
import { currentBookDocId } from '@/lib/bookDocument'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'

/** A reference attached to a compose — links the sent entry + a body token. */
export type ComposeReference =
  | {
      kind: 'book'
      id: number
      label: string
      token: string
      /** Backing document id (for the attach-PDF toggle); undefined if none. */
      docId?: number
      /** Suggested attachment filename when the PDF is attached. */
      fileName?: string
    }
  | { kind: 'employee'; id: string; label: string; token: string }

export interface ReferencePickerProps {
  /** Element the panel anchors under (the ＋ Add reference control). */
  anchorRef: React.RefObject<HTMLElement | null>
  onPick: (ref: ComposeReference) => void
  onClose: () => void
}

/** The record currently shown in the preview pane (driven by hover / focus). */
type PreviewTarget =
  | { kind: 'book'; b: BookRead }
  | { kind: 'employee'; e: EmployeeListItem }

/** First-letters initials for the employee preview avatar. */
function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase() || '?'
  )
}

export function ReferencePicker({
  anchorRef,
  onPick,
  onClose,
}: ReferencePickerProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [raw, setRaw] = useState('')
  const [q, setQ] = useState('')
  const [preview, setPreview] = useState<PreviewTarget | null>(null)

  // Debounce the search query feeding both endpoints.
  useEffect(() => {
    const id = window.setTimeout(() => setQ(raw.trim()), 200)
    return () => window.clearTimeout(id)
  }, [raw])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const booksQuery = useQuery({
    queryKey: ['refpick-books', q],
    queryFn: () => api.listBooks({ q, limit: 8 }),
    staleTime: 30_000,
  })
  const employeesQuery = useQuery({
    queryKey: ['refpick-employees', q],
    queryFn: () => api.listEmployees({ q, limit: 6 }),
    enabled: q.length > 0,
    staleTime: 30_000,
  })

  const books = booksQuery.data?.items ?? []
  const employees = employeesQuery.data?.items ?? []

  // Effective preview: the user's hovered/focused selection while it's still in
  // the result set, else the first book (else first employee). Derived during
  // render (no effect) so it tracks results without a cascading setState.
  const effective: PreviewTarget | null =
    preview?.kind === 'book' && books.some((b) => b.id === preview.b.id)
      ? preview
      : preview?.kind === 'employee' && employees.some((e) => e.id === preview.e.id)
        ? preview
        : books[0]
          ? { kind: 'book', b: books[0] }
          : employees[0]
            ? { kind: 'employee', e: employees[0] }
            : null

  // Anchor placement — mirrors RecipientChipsInput's dropdown, widened to fit
  // the two-pane layout (clamped to the viewport on narrow windows).
  useLayoutEffect(() => {
    const place = (): void => {
      const panel = panelRef.current
      const anchor = anchorRef.current
      if (!panel || !anchor) return
      const rect = anchor.getBoundingClientRect()
      const margin = 8
      const width = Math.min(600, window.innerWidth - margin * 2)
      let left = rect.left
      left = Math.min(left, window.innerWidth - width - margin)
      left = Math.max(left, margin)
      panel.style.left = `${left}px`
      panel.style.top = `${rect.bottom + 4}px`
      panel.style.width = `${width}px`
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchorRef])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [anchorRef, onClose])

  // Map a Book's approval/signing state to a short label + tone for the preview.
  const statusMeta = (state: string): { label: string; cls: string } => {
    switch (state) {
      case 'approved':
        return { label: t('ledger.outlook.ref.status.signed', { defaultValue: 'Signed' }), cls: 'text-success' }
      case 'pending':
        return { label: t('ledger.outlook.ref.status.pending', { defaultValue: 'Awaiting signature' }), cls: 'text-warning' }
      case 'returned':
        return { label: t('ledger.outlook.ref.status.returned', { defaultValue: 'Returned' }), cls: 'text-warning' }
      case 'rejected':
        return { label: t('ledger.outlook.ref.status.rejected', { defaultValue: 'Rejected' }), cls: 'text-accent' }
      default:
        return { label: t('ledger.outlook.ref.status.none', { defaultValue: 'Unsubmitted' }), cls: 'text-muted-foreground' }
    }
  }

  const fmtDate = (iso: string): string => {
    try {
      return new Intl.DateTimeFormat(i18n.language || 'en', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    } catch {
      return iso
    }
  }

  const rowCls = (active: boolean): string =>
    cn(
      'flex w-full items-center gap-2.5 px-3 py-1.5 text-start text-xs transition-colors',
      active ? 'bg-surface-tinted' : 'hover:bg-surface-tinted',
    )

  function renderPreview(): React.JSX.Element {
    if (!effective) {
      return (
        <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-faint">
          {t('ledger.outlook.ref.previewHint', {
            defaultValue: 'Search, then hover a result to preview it here.',
          })}
        </div>
      )
    }

    if (effective.kind === 'employee') {
      const e = effective.e
      const name = pickEmployeeName(e, i18n.language)
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-primary-soft text-lg font-semibold text-primary">
            {initials(name)}
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground" dir="auto">
              {name}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{e.id}</div>
          </div>
          <p className="max-w-[36ch] text-[11px] text-muted-foreground">
            {t('ledger.outlook.ref.employeeHint', {
              defaultValue: 'Employee reference — links the person to this email.',
            })}
          </p>
          <button
            type="button"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onPick({ kind: 'employee', id: e.id, label: e.id, token: e.id })}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            {t('ledger.outlook.ref.attachThis', { defaultValue: 'Attach this' })}
          </button>
        </div>
      )
    }

    const b = effective.b
    const cat =
      (i18n.language === 'ar' ? b.category?.name_ar : b.category?.name_en) ??
      b.category?.name_en ??
      b.category_id
    const status = statusMeta(b.approval_state)
    const docId = currentBookDocId(b)
    const pdfUrl = docId != null ? api.documentDownloadUrl(docId, 'pdf') : null
    const dirLabel =
      b.direction === 'incoming'
        ? t('ledger.outlook.ref.incoming', { defaultValue: 'Incoming' })
        : b.direction === 'outgoing'
          ? t('ledger.outlook.ref.outgoing', { defaultValue: 'Outgoing' })
          : null

    return (
      <div className="flex h-full min-h-0 flex-col gap-2 p-3">
        <div className="flex items-start gap-2">
          <span className="flex-none rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
            {b.ref_number}
          </span>
          <span className="line-clamp-2 text-xs font-semibold text-foreground" dir="auto">
            {b.subject ?? '—'}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-surface-raised">
          {pdfUrl ? (
            <object data={pdfUrl} type="application/pdf" className="h-full w-full" aria-label={b.subject ?? b.ref_number}>
              <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                <FileText className="h-8 w-8 text-faint" strokeWidth={1.5} aria-hidden />
                <p className="text-[11px] text-muted-foreground">
                  {t('ledger.outlook.ref.previewUnavailable', {
                    defaultValue: 'Preview can’t render here — open to view the file.',
                  })}
                </p>
              </div>
            </object>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
              <FileText className="h-8 w-8 text-faint" strokeWidth={1.5} aria-hidden />
              <p className="text-[11px] text-muted-foreground">
                {t('ledger.outlook.ref.noDoc', {
                  defaultValue: 'No document attached to this record.',
                })}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px]">
          <div>
            <span className="text-muted-foreground">{t('ledger.outlook.ref.category', { defaultValue: 'Category' })} </span>
            <span className="text-foreground" dir="auto">{cat}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t('ledger.outlook.ref.date', { defaultValue: 'Date' })} </span>
            <span className="font-mono text-foreground">{fmtDate(b.created_at)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t('ledger.outlook.ref.statusLabel', { defaultValue: 'Status' })} </span>
            <span className={cn('font-medium', status.cls)}>{status.label}</span>
          </div>
          {dirLabel && (
            <div>
              <span className="text-muted-foreground">{t('ledger.outlook.ref.direction', { defaultValue: 'Direction' })} </span>
              <span className="text-foreground">{dirLabel}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-0.5">
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground"
            >
              {t('ledger.outlook.ref.open', { defaultValue: 'Open' })}
              <ExternalLink className="h-3 w-3" strokeWidth={1.8} aria-hidden />
            </a>
          )}
          <button
            type="button"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onPick({
              kind: 'book',
              id: b.id,
              label: b.ref_number,
              token: b.ref_number,
              docId,
              fileName: `${b.ref_number}.pdf`,
            })}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            {t('ledger.outlook.ref.attachThis', { defaultValue: 'Attach this' })}
          </button>
        </div>
      </div>
    )
  }

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      className="fixed left-0 top-0 z-[70] overflow-hidden rounded-md border border-border bg-surface shadow-[0_12px_34px_rgba(13,25,45,0.18)]"
    >
      <div className="border-b border-hairline p-2.5">
        <input
          ref={inputRef}
          type="text"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Close only the picker — without stopPropagation the same Escape
              // would bubble to the compose root and close the whole window.
              e.stopPropagation()
              onClose()
            }
          }}
          placeholder={t('ledger.outlook.ref.searchPlaceholder')}
          aria-label={t('ledger.outlook.ref.searchPlaceholder')}
          className="w-full rounded-sm border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex h-[360px] min-h-0">
        {/* Results list */}
        <div className="flex w-[44%] min-w-0 flex-none flex-col overflow-y-auto border-e border-hairline py-1">
          {books.length > 0 && (
            <div role="group" aria-label={t('ledger.outlook.ref.booksRecords')}>
              <div className="px-3 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-wider text-faint">
                {t('ledger.outlook.ref.booksRecords')}
              </div>
              {books.map((b) => (
                <button
                  key={`b-${b.id}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setPreview({ kind: 'book', b })}
                  onFocus={() => setPreview({ kind: 'book', b })}
                  onClick={() =>
                    onPick({
                      kind: 'book',
                      id: b.id,
                      label: b.ref_number,
                      token: b.ref_number,
                      docId: currentBookDocId(b),
                      fileName: `${b.ref_number}.pdf`,
                    })
                  }
                  className={rowCls(effective?.kind === 'book' && effective.b.id === b.id)}
                >
                  <span className="flex-none rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
                    {b.ref_number}
                  </span>
                  <span className="min-w-0 truncate text-foreground" dir="auto">
                    {b.subject ?? ''}
                  </span>
                </button>
              ))}
            </div>
          )}

          {employees.length > 0 && (
            <div role="group" aria-label={t('ledger.outlook.ref.employees')}>
              <div className="px-3 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-wider text-faint">
                {t('ledger.outlook.ref.employees')}
              </div>
              {employees.map((emp) => (
                <button
                  key={`e-${emp.id}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setPreview({ kind: 'employee', e: emp })}
                  onFocus={() => setPreview({ kind: 'employee', e: emp })}
                  onClick={() =>
                    onPick({
                      kind: 'employee',
                      id: emp.id,
                      label: emp.id,
                      token: emp.id,
                    })
                  }
                  className={rowCls(effective?.kind === 'employee' && effective.e.id === emp.id)}
                >
                  <span className="flex-none rounded-sm bg-primary-soft px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                    {emp.id}
                  </span>
                  <span className="min-w-0 truncate text-foreground" dir="auto">
                    {pickEmployeeName(emp, i18n.language)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {books.length === 0 && employees.length === 0 && (
            <p className="px-3 py-3 text-center text-[11px] text-faint">
              {t('common.noResults', { defaultValue: 'No results' })}
            </p>
          )}
        </div>

        {/* Preview pane */}
        <div className="flex min-w-0 flex-1 flex-col">{renderPreview()}</div>
      </div>
    </div>,
    document.body,
  )
}
