import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { api, apiErrorMessage, type BookRead } from '@/lib/api'
import { formatDmy } from '@/lib/formatDmy'

const referenceKey = (id: number) => ['ledger', 'reference-book', id] as const

function ReferenceChip({ id, onRemove }: { id: number; onRemove: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const book = useQuery({ queryKey: referenceKey(id), queryFn: () => api.getBook(id, undefined, { markRead: false }), staleTime: 30_000 })
  const version = book.data?.versions?.at(-1)
  const fields = useQuery({
    queryKey: ['ledger', 'reference-date', id, version?.id],
    queryFn: () => api.getBookVersionFields(id, version!.id),
    enabled: Boolean(version?.has_fields), staleTime: 30_000,
  })
  const paperDate = fields.data?.fields.date
  const date = typeof paperDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(paperDate)
    ? formatDmy(paperDate)
    : typeof paperDate === 'string' && /^\d{2}[-/]\d{2}[-/]\d{4}$/.test(paperDate)
      ? paperDate.replaceAll('-', '/')
      : book.data ? formatDmy(book.data.created_at.slice(0, 10)) : null
  const ref = book.data?.ref_number ?? `#${id}`
  return <li className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-tinted px-2 py-1 text-sm">
    <bdi dir="ltr" className="break-all font-mono">{ref}</bdi>
    {date && <span dir="ltr" className="font-mono text-xs text-muted-foreground">{date}</span>}
    {book.isError && <span role="alert" className="text-xs text-destructive">{apiErrorMessage(book.error)}</span>}
    <button type="button" className="inline-flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('ledgerBook.composer.references.remove', { ref })} onClick={onRemove}><X aria-hidden="true" className="size-4" /></button>
  </li>
}

export function LedgerReferencesPicker({ id, value, onChange, error }: {
  id: string; value: number[]; onChange: (value: number[]) => void; error?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [raw, setRaw] = useState('')
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(raw.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [raw])
  const books = useQuery({ queryKey: ['ledger', 'reference-search', q], queryFn: () => api.listBooks({ q, limit: 8 }), enabled: focused && value.length < 20, staleTime: 30_000 })
  const available = books.data?.items.filter((book) => !book.metadata_only && !value.includes(book.id)) ?? []
  const pick = (book: BookRead): void => {
    if (value.length >= 20 || value.includes(book.id)) return
    qc.setQueryData(referenceKey(book.id), book)
    onChange([...value, book.id])
    setRaw('')
    setFocused(false)
  }
  return <div className="flex min-w-0 flex-col gap-2">
    <label htmlFor={id} className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.references.label')}</label>
    <input id={id} type="search" value={raw} onFocus={() => setFocused(true)} onChange={(e) => { setRaw(e.target.value); setFocused(true) }}
      onKeyDown={(e) => { if (e.key === 'Escape') setFocused(false) }}
      placeholder={t('ledgerBook.composer.references.search')} disabled={value.length >= 20}
      aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive" />
    <p id={`${id}-hint`} className="text-xs text-muted-foreground">{t('ledgerBook.composer.references.limit', { count: value.length, max: 20 })}</p>
    {focused && value.length < 20 && <div className="max-h-60 overflow-y-auto rounded-lg border border-border bg-surface">
      {books.isPending && <p role="status" className="p-3 text-sm text-muted-foreground">{t('ledgerBook.composer.loading')}</p>}
      {books.isError && <p role="alert" className="p-3 text-sm text-destructive">{apiErrorMessage(books.error)}</p>}
      {available.map((book) => <button type="button" key={book.id} className="flex min-h-11 w-full flex-wrap items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface-tinted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => pick(book)}>
        <bdi dir="ltr" className="break-all font-mono">{book.ref_number}</bdi><bdi className="min-w-0 break-words">{book.subject}</bdi>
      </button>)}
      {books.data && available.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t('ledgerBook.composer.references.empty')}</p>}
    </div>}
    <ul aria-label={t('ledgerBook.composer.references.selected')} className="flex flex-wrap gap-2">
      {value.map((bookId) => <ReferenceChip key={bookId} id={bookId} onRemove={() => onChange(value.filter((v) => v !== bookId))} />)}
    </ul>
    {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
