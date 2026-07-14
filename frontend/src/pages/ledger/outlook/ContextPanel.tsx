/**
 * ContextPanel — the 4th pane of the Ledger Outlook shell: "People in this
 * email" (Phase 7, Task 3).
 *
 * Given the open mail/record (`selectedId` + `selectedKind`), it runs the same
 * `['ledger-entry', id]` / `['ledger-log-record', id]` query the reading pane
 * uses (TanStack de-dupes — no double fetch), resolves the employees the
 * correspondence is ABOUT via `resolvePeople` (`related_employee_id` first, then
 * body G-numbers), and renders:
 *   · header "People in this email · N" + a collapse toggle (⟩)
 *   · one `ContextPersonCard` (Task 2) per resolved employee — every person a
 *     full, collapsed-by-default card; no privileged first person. Each card
 *     opens to the same detail (facts · expiry · quick actions · activity) and
 *     lazily fetches that detail only on expand.
 *   · a "Linked records" card — Books this mail references
 *     (`related_book_id` + body book-refs) with live approval/signing chips
 *   · an "Attachments → vault" shortcut surfacing the open mail's attachments
 *     (the SendToVaultDialog itself lives on the reading-pane attachment cards —
 *     we point the user there rather than duplicate the per-attachment dialog).
 *
 * IDLE: `selectedId == null` (or a loaded mail with zero resolvable people) →
 * a quiet 👥 empty state. The ROTATING TIP is NOT here — it lives in the
 * reading-pane empty state (Phase 4). A people-less mail that still carries a
 * linked record shows the idle state PLUS the linked-records card.
 *
 * The panel owns its collapse chrome (persisted to localStorage). It is the 4th
 * child of the shell's pinned `dir="ltr"` container, so it never mirrors in
 * Arabic — only its leaf text re-flows (`dir="auto"`). Desktop only; mobile is
 * Task 4 (a Sheet, not a column).
 *
 * Prototype reference: `.cx`/`.card`/`.sib`/`.rec`/`.vault`/`.cx-idle`
 * (docs/prototypes/ledger-outlook-redesign.html CSS 295–371, renderContext
 * 1178–1255). Tokens only — no inline hex, no `text-[Npx]`.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronsRight, FolderInput, Users } from 'lucide-react'

import { api } from '@/lib/api'
import type { BookRead } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ContextPersonCard } from './ContextPersonCard'
import { useContextSource } from './useContextSource'

/** Coarse page targets the shell's `onNavigate` seam understands. */
type NavPage = 'employees' | 'application'

const COLLAPSE_KEY = 'ledger.cx.collapsed'

interface ContextPanelProps {
  /** The open row's id, or null when nothing is selected (→ idle). */
  selectedId: number | null
  /** Which kind of row is open — drives the entry-vs-log-record query. */
  selectedKind: 'mail' | null
  /** Coarse navigation (Open record → employees; Generate → application). */
  onNavigate?: (page: NavPage, id?: string) => void
  /** Email-as-reference seam — opens a new compose seeded with the employee. */
  onEmail?: (employeeId: string) => void
  /**
   * `'column'` (default) → the collapsible desktop 4th column with its own
   * `<aside>` chrome. `'sheet'` → body-only (no collapse rail, no fixed width),
   * for the mobile Sheet (Task 4) whose own chrome is the Sheet panel.
   */
  variant?: 'column' | 'sheet'
}

/** Read the persisted collapse flag (lazy initial state). */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function ContextPanel({
  selectedId,
  selectedKind,
  onNavigate,
  onEmail,
  variant = 'column',
}: ContextPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* private mode / quota — non-fatal, just don't persist */
    }
  }, [collapsed])

  const { entry, people, peopleCount, bookRefs, attachments, isLoading } =
    useContextSource(selectedId, selectedKind)

  // The flat, order-preserving people list — every resolved G-number gets the
  // same full (collapsed-by-default) card; no person is privileged. `people`
  // still exposes primary/siblings for back-compat, so we rebuild the flat
  // order here rather than widen the shared hook's return type.
  const peopleOrdered = people.primary
    ? [people.primary, ...people.siblings]
    : []

  // The shared panel body — people resolution + cards. Reused verbatim by the
  // desktop column and the mobile Sheet so they can never drift.
  const body = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {selectedId == null ? (
        <IdleState message={t('ledger.outlook.cxIdle')} />
      ) : isLoading ? (
        <div className="space-y-3 p-3.5">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          {peopleOrdered.length > 0 ? (
            peopleOrdered.map((g) => (
              <ContextPersonCard
                key={g}
                employeeId={g}
                onNavigate={onNavigate}
                onEmail={onEmail}
              />
            ))
          ) : (
            <IdleState message={t('ledger.outlook.cxIdle')} />
          )}

          <LinkedRecordsCard
            relatedBookId={entry?.related_book_id ?? null}
            bookRefs={bookRefs}
          />

          {attachments.length > 0 && entry && (
            <AttachmentsVaultCard count={attachments.length} firstName={attachments[0]?.name} />
          )}
        </>
      )}
    </div>
  )

  // ── Sheet variant: body only (the mobile Sheet supplies its own chrome). ──
  if (variant === 'sheet') {
    return (
      <div data-testid="cx-panel" className="flex h-full min-h-0 flex-col">
        <div className="flex flex-none items-center border-b border-border px-3.5 py-3">
          <span className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground" dir="auto">
            {peopleCount > 0
              ? t('ledger.outlook.peopleIn', { count: peopleCount })
              : t('ledger.outlook.context')}
          </span>
        </div>
        {body}
      </div>
    )
  }

  // Collapsed rail — a thin 42px vertical-label strip with the ⟩ toggle.
  if (collapsed) {
    return (
      <aside
        data-testid="cx-panel"
        className="flex w-[42px] flex-none flex-col items-center gap-2.5 border-s border-border bg-surface-raised py-3"
      >
        <button
          type="button"
          aria-label={t('ledger.outlook.expand')}
          onClick={() => setCollapsed(false)}
          className="grid h-6 w-6 place-items-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-tinted"
        >
          <ChevronsRight className="h-3.5 w-3.5 rotate-180" aria-hidden />
        </button>
        <span
          className="mt-1 text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground"
          style={{ writingMode: 'vertical-rl' }}
        >
          {t('ledger.outlook.context')}
        </span>
      </aside>
    )
  }

  const header = (
    <div className="flex flex-none items-center justify-between border-b border-border px-3.5 py-3">
      <span className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground" dir="auto">
        {peopleCount > 0
          ? t('ledger.outlook.peopleIn', { count: peopleCount })
          : t('ledger.outlook.context')}
      </span>
      <button
        type="button"
        aria-label={t('ledger.outlook.collapse')}
        onClick={() => setCollapsed(true)}
        className="grid h-6 w-6 place-items-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-tinted"
      >
        <ChevronsRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )

  return (
    <aside
      data-testid="cx-panel"
      className="flex w-[312px] flex-none flex-col overflow-hidden border-s border-border bg-surface-raised"
    >
      {header}
      {body}
    </aside>
  )
}

/** The quiet 👥 idle / no-people empty state. NO rotating tip here. */
function IdleState({ message }: { message: string }): React.JSX.Element {
  return (
    <div
      data-testid="cx-idle"
      className="px-5 py-9 text-center text-xs leading-relaxed text-muted-foreground"
    >
      <Users className="mx-auto mb-2.5 h-7 w-7 opacity-55" aria-hidden />
      <span dir="auto">{message}</span>
    </div>
  )
}

/**
 * Linked-records card — Books this mail references. Resolves the structural
 * `related_book_id` (→ getBook) and body book-refs (→ getBookByRef), de-duped by
 * id, each row showing ref · subject · an approval/signing status chip. Renders
 * nothing when there are no references.
 */
function LinkedRecordsCard({
  relatedBookId,
  bookRefs,
}: {
  relatedBookId: number | null
  bookRefs: string[]
}): React.JSX.Element | null {
  const { t } = useTranslation()

  const byId = useQuery({
    queryKey: ['book', relatedBookId],
    queryFn: () => api.getBook(relatedBookId!),
    enabled: relatedBookId != null,
  })
  const byRefQueries = useQuery({
    queryKey: ['books-by-ref', bookRefs],
    queryFn: async () => {
      const results = await Promise.allSettled(bookRefs.map((r) => api.getBookByRef(r)))
      return results
        .filter((r): r is PromiseFulfilledResult<BookRead> => r.status === 'fulfilled')
        .map((r) => r.value)
    },
    enabled: bookRefs.length > 0,
  })

  if (relatedBookId == null && bookRefs.length === 0) return null

  // De-dupe by book id (a ref in the body may be the same as related_book_id).
  const seen = new Set<number>()
  const books: BookRead[] = []
  for (const b of [byId.data, ...(byRefQueries.data ?? [])]) {
    if (!b || seen.has(b.id)) continue
    seen.add(b.id)
    books.push(b)
  }
  if (books.length === 0) return null

  return (
    <div className="border-b border-border bg-surface p-3.5">
      <div className="mb-2 text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('ledger.outlook.linkedRecords', { count: books.length })}
      </div>
      {books.map((b) => {
        const signed = b.approval_state === 'approved'
        return (
          <div
            key={b.id}
            data-testid="cx-linked-record"
            className="flex items-center justify-between gap-2 border-b border-dashed border-border py-1.5 text-xs last:border-b-0"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="flex-none rounded bg-primary-soft px-1.5 py-0.5 font-mono text-[0.66rem] font-bold text-primary">
                {b.ref_number}
              </span>
              <span className="truncate text-foreground" dir="auto">
                {b.subject ?? b.ref_number}
              </span>
            </span>
            <Badge tone={signed ? 'active' : 'warning'}>
              {signed ? t('ledger.outlook.signed') : t('ledger.outlook.awaiting')}
            </Badge>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Attachments → vault shortcut. The per-attachment SendToVaultDialog already
 * lives on the reading-pane attachment cards (`LedgerAttachments`); duplicating
 * its picker here (which needs an attachment index + filename) would fork the
 * flow, so the panel surfaces a labelled pointer to that affordance instead.
 */
function AttachmentsVaultCard({
  count,
  firstName,
}: {
  count: number
  firstName?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="bg-surface p-3.5">
      <div className="mb-1.5 text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('ledger.outlook.attVault')}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground" dir="auto">
        <FolderInput className="h-3.5 w-3.5 flex-none text-info" aria-hidden />
        <span className="truncate">
          {firstName ?? t('ledger.outlook.fileVault')}
          {count > 1 ? ` +${count - 1}` : ''}
        </span>
      </div>
    </div>
  )
}
