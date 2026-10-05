/**
 * Records page — middle pane: day-grouped register list.
 *
 * Sticky day headers (localized long dates). A row is NOT one big button:
 *   · checkbox        its own labelled control (never nested in a button)
 *   · ref             a real `<Link>` to the record carrying the list's nav
 *                     state (middle-click / Ctrl-click / "open in new tab" work)
 *   · select button   form name · who · creator · snippet · chips, stretched over
 *                     the whole row (`after:inset-0`) so a click anywhere selects
 * Click = select (the pane shows the record); Enter on a focused row or its ref
 * opens the record; Ctrl/⌘+Enter and J/K are page-level shortcuts (BooksPage).
 *
 * The scroller is a container (`@container`): below `@[26rem]` the glyph tile and
 * the paper-count chip drop out and the ref stacks over the label, so the list
 * stays legible beside a wide pane or in the narrow desktop tiers.
 */
import { useRef } from 'react'
import { FileText } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import type { BookRead } from '@/lib/api'

// search_snippet is added by Task 16 — present after api.types regen.
type BookReadWithSnippet = BookRead & { search_snippet?: string | null }
import { cn } from '@/lib/utils'

import { BookStatusChips } from '@/components/books/BookStatusChips'
import { bidi } from '@/lib/bidi'
import { ServiceArtwork } from '@/components/ui/service-artwork'
import { signedSourceOf } from './bookStateLabel'
import { subjectEmployeePart } from './formKind'
import { paperCountOf } from './recordPapers'
import { openRecord, recordLinkProps, type RecordNavState } from './useRecordNavContext'
import { serviceArtwork, serviceGlyph, useServiceLabel } from './serviceLabels'
import { StateSeal } from './StateSeal'

/** Parse `[token]` FTS snippet markers into React nodes with <mark>. */
function SnippetLine({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(\[[^\]]*\])/g)
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <mark key={i} className="rounded-sm bg-warning/30 px-0.5 not-italic">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  )
}

export function RecordsList({
  rows,
  selectedId,
  highlightedId,
  onSelect,
  selected,
  onToggleSelect,
  nav,
  scrollerRef,
  empty,
  isInmateReporter,
}: {
  rows: BookRead[]
  selectedId: number | null
  highlightedId?: number | null
  onSelect: (id: number) => void
  selected?: Set<number>
  onToggleSelect?: (id: number) => void
  /** The page's one nav-state builder (list URL, queue, scroll); `0` pins scrollY for links. */
  nav: (scrollY?: number) => RecordNavState
  /** The scroller, for the page's return-focus restore; an internal ref when omitted. */
  scrollerRef?: React.RefObject<HTMLDivElement | null>
  /** Shown instead of the rows when there are none (the page knows why). */
  empty?: React.ReactNode
  /** Inmate reporters see fewer papers per record; the count must match the pane. */
  isInmateReporter: boolean
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const locale = i18n.language.startsWith('ar') ? 'ar-AE' : 'en-GB'
  const serviceLabel = useServiceLabel()
  const internalRef = useRef<HTMLDivElement | null>(null)
  const scroller = scrollerRef ?? internalRef
  const linkNav = nav(0)

  const days: { date: string; items: BookRead[] }[] = []
  for (const row of rows) {
    const date = row.created_at.slice(0, 10)
    const last = days[days.length - 1]
    if (last && last.date === date) last.items.push(row)
    else days.push({ date, items: [row] })
  }

  return (
    <div
      ref={scroller}
      data-records-scroller
      className="@container min-h-0 flex-1 scroll-pt-8 overflow-y-auto"
    >
      {days.map(({ date, items }) => (
        <section key={date}>
          <div className="sticky top-0 z-[2] flex items-baseline gap-2 border-b border-hairline bg-surface-raised px-3.5 py-1.5">
            <span className="text-[0.72em] font-bold text-muted-foreground">
              {new Date(`${date}T00:00:00`).toLocaleDateString(locale, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </span>
            <span className="font-mono text-[0.62em] text-faint tabular-nums">
              <bdi dir="ltr">{items.length}</bdi>
            </span>
          </div>
          {items.map((row) => {
            const classified = { classified: !!row.classification_code }
            const glyph = serviceGlyph(row.service_id)
            const artwork = serviceArtwork(row.service_id)
            const label = serviceLabel(row.service_id)
            const who = subjectEmployeePart(row.subject, classified)
            const snippet = (row as BookReadWithSnippet).search_snippet
            const paperCount = paperCountOf(row, { inmateReporter: isInmateReporter })
            const isChecked = selected?.has(row.id) ?? false
            const selectable = onToggleSelect != null
            const isSelected = row.id === selectedId
            const creator = row.created_by_name
            const open = (): void => openRecord(navigate, row.id, nav())
            return (
              <div
                key={row.id}
                data-book-id={row.id}
                className={cn(
                  'relative flex items-center gap-2.5 border-b border-hairline px-3.5 py-2 transition-colors motion-reduce:transition-none',
                  isSelected ? 'bg-primary-soft' : 'hover:bg-surface-tinted',
                  row.id === highlightedId && 'bg-accent-soft',
                  isChecked && 'bg-primary-soft/60',
                  // Draft tinted background; voided struck-through
                  row.is_draft && !row.voided_at && !isSelected && 'bg-warning-soft/20',
                  row.voided_at && 'opacity-60',
                )}
              >
                {isSelected && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-primary"
                  />
                )}
                {selectable && (
                  <label className="relative z-10 -ms-1.5 grid h-11 w-8 shrink-0 cursor-pointer place-items-center">
                    <input
                      type="checkbox"
                      aria-label={t('books.list.selectRef', { ref: bidi(row.ref_number) })}
                      checked={isChecked}
                      onChange={() => onToggleSelect(row.id)}
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                  </label>
                )}
                <span
                  aria-hidden
                  className="hidden h-7 w-7 shrink-0 place-items-center rounded-sm border border-hairline bg-surface-raised text-[0.9em] @[26rem]:grid"
                >
                  {artwork ? <ServiceArtwork artwork={artwork} size="row" /> : glyph}
                </span>
                <div className="flex min-w-0 flex-1 flex-col @[26rem]:flex-row @[26rem]:items-center @[26rem]:gap-2.5">
                  <Link
                    {...recordLinkProps(row.id, linkNav)}
                    // Enter only opens the selected row, so only that row advertises it.
                    aria-keyshortcuts={isSelected ? 'Enter' : undefined}
                    onClick={(e) => {
                      const modified = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
                      if (e.defaultPrevented || modified) return
                      e.preventDefault()
                      open()
                    }}
                    className={cn(
                      'relative z-10 w-fit shrink-0 rounded-sm font-mono text-[0.7em] font-bold text-primary hover:underline @[26rem]:w-[4.6rem]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      row.voided_at && 'line-through',
                    )}
                  >
                    <bdi dir="ltr">{row.ref_number}</bdi>
                  </Link>
                  <button
                    type="button"
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => onSelect(row.id)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
                      e.preventDefault()
                      open()
                    }}
                    className={cn(
                      'min-w-0 flex-1 rounded-sm text-start',
                      "after:absolute after:inset-0 after:content-['']",
                      'focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring',
                    )}
                  >
                    <span
                      className={cn(
                        'block truncate text-[0.78em] font-semibold',
                        row.voided_at && 'line-through',
                      )}
                    >
                      {label}
                    </span>
                    <span className="block truncate text-[0.68em] text-muted-foreground">
                      {who && (
                        <>
                          <span dir="auto">{who}</span>
                          <span aria-hidden> · </span>
                        </>
                      )}
                      <span className="sr-only">{t('books.record.createdBy')} </span>
                      {creator ? (
                        <bdi>{creator}</bdi>
                      ) : (
                        <span className="italic">{t('books.record.creatorUnknown')}</span>
                      )}
                    </span>
                    {snippet && (
                      <span
                        className="mt-0.5 block truncate text-[0.65em] italic text-muted-foreground"
                        dir="auto"
                      >
                        <span className="me-1 not-italic font-medium text-warning">
                          {t('books.search.bodyMatch')}
                        </span>
                        <SnippetLine text={snippet} />
                      </span>
                    )}
                    {/* Draft / editing / voided / classification chips */}
                    {(row.is_draft ||
                      row.edit_session?.state === 'active' ||
                      row.voided_at ||
                      row.classification_code) && (
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        <BookStatusChips book={row} noClassification={!row.classification_code} />
                      </span>
                    )}
                  </button>
                </div>
                {paperCount > 0 && (
                  <span className="hidden shrink-0 items-center gap-0.5 font-mono text-[0.62em] text-faint tabular-nums @[26rem]:flex">
                    <FileText className="h-3 w-3" aria-hidden />
                    <bdi dir="ltr">{paperCount}</bdi>
                    <span className="sr-only">{t('books.pane.papers', { count: paperCount })}</span>
                  </span>
                )}
                <StateSeal
                  state={row.approval_state}
                  signingPath={row.signing_path}
                  signedSource={signedSourceOf(row)}
                />
              </div>
            )
          })}
        </section>
      ))}
      {rows.length === 0 &&
        (empty ?? (
          <div className="px-4 py-10 text-center text-[0.8em] text-muted-foreground">
            {t('books.list.noMatch')}
          </div>
        ))}
    </div>
  )
}
