/**
 * RecordPaperPickerDialog — "From Records" source for the AttachmentsBlock
 * (forms signing paths & required attachments, spec 2026-06-11 §6).
 *
 * Search existing records by ref / subject (debounced `listBooks({q, limit:20})`),
 * expand a row to list its papers — the current generated PDF (when the book
 * has one) plus each film-strip scan (`attachment_paths`) — and pick one.
 * Picking returns an `AttachmentValue` (`record_document` / `record_attachment`);
 * the server reads the bytes itself, so no client download happens here.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronDown, ChevronRight, FileText, Search } from 'lucide-react'

import { api } from '@/lib/api'
import type { BookRead } from '@/lib/api'
import { currentBookDocId } from '@/lib/bookDocument'
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { AttachmentValue } from './attachmentsState'

export interface RecordPaperPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the picked paper; the caller closes the dialog. */
  onPick: (value: AttachmentValue) => void
}

/** Last path segment, tolerant of either separator (backend stores POSIX-ish
 * relative paths, but be defensive on Windows-style ones). */
function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function RecordPaperPickerDialog({
  open,
  onOpenChange,
  onPick,
}: RecordPaperPickerDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // 300ms debounce — same idiom as the ledger search bar.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(q)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [q])

  // Reset transient state whenever the dialog reopens.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset-on-open
    setQ('')
    setDebouncedQ('')
    setExpandedId(null)
  }, [open])

  const booksQuery = useQuery({
    queryKey: ['record-paper-picker', debouncedQ],
    queryFn: () =>
      api.listBooks({ q: debouncedQ.trim() || undefined, limit: 20 }),
    enabled: open,
    staleTime: 30_000,
  })
  const books: BookRead[] = booksQuery.data?.items ?? []

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('application.attachments.pickerTitle')}</DialogTitle>
          <DialogDescription>
            {t('application.attachments.pickerSubtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <label className="relative block">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.8}
              aria-hidden
            />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('application.attachments.pickerSearch')}
              aria-label={t('application.attachments.pickerSearch')}
              className="ps-9"
              autoFocus
            />
          </label>

          <div className="min-h-[200px] max-h-[50vh] overflow-y-auto rounded-lg border border-hairline">
            {booksQuery.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-md" />
                ))}
              </div>
            ) : booksQuery.isError ? (
              <p className="px-3 py-8 text-center text-[0.82em] text-accent">
                {t('application.pickerLoadError')}
              </p>
            ) : books.length === 0 ? (
              <p className="px-3 py-8 text-center text-[0.82em] text-muted-foreground">
                {t('application.attachments.pickerEmpty')}
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {books.map((book) => (
                  <BookRow
                    key={book.id}
                    book={book}
                    expanded={expandedId === book.id}
                    onToggle={() =>
                      setExpandedId((prev) => (prev === book.id ? null : book.id))
                    }
                    onPick={onPick}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}

function BookRow({
  book,
  expanded,
  onToggle,
  onPick,
}: {
  book: BookRead
  expanded: boolean
  onToggle: () => void
  onPick: (value: AttachmentValue) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const Chevron = expanded ? ChevronDown : ChevronRight
  const docId = currentBookDocId(book)
  const scans = book.attachment_paths ?? []
  const stateLabel = t(`books.spine.${book.approval_state}`, {
    defaultValue: book.approval_state,
  })

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <Chevron
          className={[
            'h-3.5 w-3.5 shrink-0 text-muted-foreground',
            !expanded && isAr ? '-scale-x-100' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          strokeWidth={1.8}
          aria-hidden
        />
        <span className="shrink-0 font-mono text-[0.78em] font-semibold text-foreground" dir="ltr">
          {book.ref_number}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.82em] text-muted-foreground" dir="auto">
          {book.subject ?? '—'}
        </span>
        <span className="shrink-0 text-[0.7em] font-medium uppercase tracking-[0.05em] text-faint">
          {stateLabel}
        </span>
      </button>

      {expanded && (
        <ul className="border-t border-hairline bg-surface-tinted/40 py-1">
          {docId !== undefined && (
            <PaperRow
              icon={<FileText className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />}
              label={t('application.attachments.pickerGenerated')}
              onPick={() =>
                onPick({
                  kind: 'record_document',
                  bookId: book.id,
                  label: `${book.ref_number} · ${t('application.attachments.pickerGenerated')}`,
                })
              }
            />
          )}
          {scans.map((path, index) => (
            <PaperRow
              key={`${index}-${path}`}
              icon={<Archive className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />}
              label={basename(path)}
              mono
              onPick={() =>
                onPick({
                  kind: 'record_attachment',
                  bookId: book.id,
                  index,
                  label: `${book.ref_number} · ${basename(path)}`,
                })
              }
            />
          ))}
          {docId === undefined && scans.length === 0 && (
            <li className="px-9 py-2 text-[0.78em] text-faint">
              {t('application.attachments.pickerNoPapers')}
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

function PaperRow({
  icon,
  label,
  mono = false,
  onPick,
}: {
  icon: React.ReactNode
  label: string
  mono?: boolean
  onPick: () => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-center gap-2 px-9 py-1.5 text-start text-[0.8em] text-foreground transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span
          className={['min-w-0 flex-1 truncate', mono ? 'font-mono' : ''].filter(Boolean).join(' ')}
          dir="auto"
        >
          {label}
        </span>
      </button>
    </li>
  )
}
