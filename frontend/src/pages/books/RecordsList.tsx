/**
 * Records page — middle pane: day-grouped register list.
 * Sticky day headers (localized long dates); rows: glyph · mono ref · form
 * name · employee (dir=auto) · papers-count chip · status seal. Click =
 * select (the pane shows the record; navigation only happens from pane
 * actions).
 */
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BookRead } from '@/lib/api'

// search_snippet is added by Task 16 — present after api.types regen.
type BookReadWithSnippet = BookRead & { search_snippet?: string | null }
import { cn } from '@/lib/utils'

import { BookStatusChips } from '@/components/books/BookStatusChips'
import { signedSourceOf } from './bookStateLabel'
import { formKindOf, subjectEmployeePart } from './formKind'
import { paperCountOf } from './recordPapers'
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
}: {
  rows: BookRead[]
  selectedId: number | null
  highlightedId?: number | null
  onSelect: (id: number) => void
  selected?: Set<number>
  onToggleSelect?: (id: number) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('ar') ? 'ar-AE' : 'en-GB'

  const days: { date: string; items: BookRead[] }[] = []
  for (const row of rows) {
    const date = row.created_at.slice(0, 10)
    const last = days[days.length - 1]
    if (last && last.date === date) last.items.push(row)
    else days.push({ date, items: [row] })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
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
            <span className="font-mono text-[0.62em] text-faint tabular-nums">{items.length}</span>
          </div>
          {items.map((row) => {
            const kind = formKindOf(row.subject)
            const who = subjectEmployeePart(row.subject)
            const snippet = (row as BookReadWithSnippet).search_snippet
            const paperCount = paperCountOf(row)
            const isChecked = selected?.has(row.id) ?? false
            const selectable = onToggleSelect != null
            // A row is selectable if the caller provided onToggleSelect.
            // Rows without a document_id in the current version can still be
            // selected; they are skipped at build time (null return) in the
            // basket builder.
            return (
              <button
                key={row.id}
                type="button"
                data-id={row.id}
                aria-current={row.id === selectedId}
                onClick={() => onSelect(row.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 border-b border-hairline px-3.5 py-2 text-start transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  row.id === selectedId ? 'bg-primary-soft' : 'hover:bg-surface-tinted',
                  row.id === highlightedId && 'bg-accent-soft',
                  isChecked && 'bg-primary-soft/60',
                  // Draft tinted background; voided struck-through
                  row.is_draft && !row.voided_at && row.id !== selectedId && 'bg-warning-soft/20',
                  row.voided_at && 'opacity-60',
                )}
              >
                {selectable && (
                  <input
                    type="checkbox"
                    aria-label={row.ref_number}
                    checked={isChecked}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleSelect!(row.id)
                    }}
                    onChange={() => {
                      // onChange is required by React for controlled inputs;
                      // the actual toggle happens in onClick above.
                    }}
                    className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                  />
                )}
                <span
                  aria-hidden
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-hairline bg-surface-raised text-[0.9em]"
                >
                  {kind.glyph}
                </span>
                <span className={cn('w-[4.6rem] shrink-0 font-mono text-[0.7em] font-bold text-primary', row.voided_at && 'line-through')}>
                  <bdi dir="ltr">{row.ref_number}</bdi>
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[0.78em] font-semibold', row.voided_at && 'line-through')}>
                    {t(kind.labelKey)}
                  </span>
                  {who && (
                    <span className="block truncate text-[0.68em] text-muted-foreground" dir="auto">
                      {who}
                    </span>
                  )}
                  {snippet && (
                    <span className="mt-0.5 block truncate text-[0.65em] italic text-muted-foreground" dir="auto">
                      <span className="me-1 not-italic font-medium text-warning">{t('books.search.bodyMatch')}</span>
                      <SnippetLine text={snippet} />
                    </span>
                  )}
                  {/* Draft / editing / voided / classification chips */}
                  {(row.is_draft || row.edit_session?.state === 'active' || row.voided_at || row.classification_code) && (
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      <BookStatusChips book={row} noClassification={!row.classification_code} />
                    </span>
                  )}
                </span>
                {paperCount > 0 && (
                  <span
                    className="flex shrink-0 items-center gap-0.5 font-mono text-[0.62em] text-faint tabular-nums"
                    title={t('books.pane.papers', { count: paperCount })}
                  >
                    <FileText className="h-3 w-3" aria-hidden />
                    {paperCount}
                  </span>
                )}
                <StateSeal
                  state={row.approval_state}
                  signingPath={row.signing_path}
                  signedSource={signedSourceOf(row)}
                />
              </button>
            )
          })}
        </section>
      ))}
      {rows.length === 0 && (
        <div className="px-4 py-10 text-center text-[0.8em] text-muted-foreground">
          {t('books.empty')}
        </div>
      )}
    </div>
  )
}
