import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { RecordRecipientsPanel } from '@/components/books/RecordRecipientsPanel'
import { RecordThreadSection } from '@/components/books/RecordThreadSection'
import { SendRecordDialog } from '@/components/books/SendRecordDialog'
import { useInboxActions } from '@/components/books/useInboxActions'
import { useReplyActions } from '@/components/books/useReplyActions'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, apiErrorMessage, type BookRead } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { formatDmy } from '@/lib/formatDmy'
import { useIsMobile } from '@/lib/useIsMobile'
import { useSearchParam, useUrlOverlay } from '@/lib/urlState'
import { cn } from '@/lib/utils'
import { InboxUnreadDot } from '@/pages/books/InboxUnreadDot'
import { inboxSummaryKey, useInboxSummary } from '@/pages/books/useInboxCount'

type Scope = 'incoming' | 'outgoing' | 'archived'
const INBOX_BY_SCOPE: Record<Scope, 'received' | 'sent' | 'archived'> = {
  incoming: 'received', outgoing: 'sent', archived: 'archived',
}
const PAGE_SIZE = 50

function BookDate({ value }: { value: string }): React.JSX.Element {
  return <time dateTime={value} dir="ltr" className="font-mono tabular-nums">{formatDmy(value.slice(0, 10))}</time>
}

function DeskLoading(): React.JSX.Element {
  return <div className="space-y-4 p-5" aria-busy="true"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-1/2" /></div>
}

export function BooksRoutingDesk(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const rawScope = params.get('scope')
  const scope: Scope = rawScope === 'outgoing' || rawScope === 'archived' ? rawScope : 'incoming'
  const [bookParam, setBookParam] = useSearchParam('book')
  const bookPage = useUrlOverlay('book')
  const selectedId = /^\d+$/.test(bookParam) && Number(bookParam) > 0 ? Number(bookParam) : null
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setOffset(0) }, 300)
    return () => window.clearTimeout(timer)
  }, [search])
  const summary = useInboxSummary()
  const list = useQuery({
    queryKey: ['books', 'routing', scope, query, offset],
    queryFn: () => api.listBooks({ inbox: INBOX_BY_SCOPE[scope], q: query || undefined, limit: PAGE_SIZE, offset }),
  })
  const detail = useQuery({
    queryKey: ['books', 'detail', selectedId, null],
    queryFn: async () => {
      // Like the full record page, default mark_read=true records the first open.
      // Row-menu peeks explicitly opt out; a dossier selection is a real open.
      const book = await api.getBook(selectedId!)
      if (book.my_inbox?.read_at) {
        void qc.invalidateQueries({ queryKey: ['books', 'routing'] })
        void qc.invalidateQueries({ queryKey: inboxSummaryKey })
        void qc.invalidateQueries({ queryKey: ['notifications', 'counts'] })
      }
      return book
    },
    enabled: selectedId !== null,
  })

  function selectScope(value: string): void {
    setOffset(0)
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('scope', value)
      next.delete('book')
      return next
    }, { replace: true })
  }
  function selectBook(id: number): void {
    if (isMobile) bookPage.open(String(id))
    else setBookParam(String(id))
  }
  const scopeLabel = (value: Scope): string => t(value === 'archived' ? 'books.inbox.archived' : `ledger.booksDesk.${value}`)
  const rows = list.data?.items ?? []
  const dossier = detail.isError
    ? <div role="alert" className="p-5 text-destructive"><p>{apiErrorMessage(detail.error)}</p><Button variant="outline" className="mt-3" onClick={() => void detail.refetch()}>{t('ledger.booksDesk.retry')}</Button></div>
    : detail.isPending ? <DeskLoading /> : <BookDossier key={detail.data.id} book={detail.data} />

  if (isMobile && selectedId !== null) {
    return (
      <section dir={i18n.dir()} className="flex min-h-0 flex-1 flex-col bg-surface" aria-label={t('ledger.booksDesk.dossier')}>
        <div className="shrink-0 border-b border-hairline px-3 py-2">
          <Button variant="ghost" onClick={bookPage.close}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />{t('ledger.outlook.back')}</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{dossier}</div>
      </section>
    )
  }

  return (
    <section dir={i18n.dir()} className="flex min-h-0 flex-1 flex-col bg-surface" aria-label={t('ledger.tabs.books')}>
      <Tabs value={scope} onValueChange={selectScope} className="shrink-0">
        <TabsList className="gap-5 overflow-x-auto px-4">
          {(['incoming', 'outgoing', 'archived'] as const).map((value) => (
            <TabsTrigger key={value} value={value}>
              {scopeLabel(value)}
              {value === 'incoming' && (summary.data?.unread ?? 0) > 0 && (
                <span className="ms-2 rounded-full bg-primary-soft px-2 py-0.5 font-mono text-xs tabular-nums text-primary" aria-label={t('books.inbox.unread', { count: summary.data!.unread })}>{summary.data!.unread}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 w-full shrink-0 flex-col md:w-[22rem] md:max-w-[44%] md:border-e md:border-hairline">
          <div className="shrink-0 border-b border-hairline p-3">
            <label htmlFor="routing-search" className="sr-only">{t('ledger.booksDesk.search')}</label>
            <Input id="routing-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('ledger.booksDesk.search')} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={list.isFetching}>
            {list.isPending ? <DeskLoading /> : list.isError ? (
              <div role="alert" className="p-5 text-sm text-destructive"><p>{apiErrorMessage(list.error)}</p><Button variant="outline" className="mt-3" onClick={() => void list.refetch()}>{t('ledger.booksDesk.retry')}</Button></div>
            ) : rows.length === 0 ? (
              <div className="p-5 text-sm">
                <h2 className="font-semibold">{t(query ? 'ledger.booksDesk.noMatches' : `ledger.booksDesk.empty.${scope}`)}</h2>
                <p className="mt-2 text-muted-foreground">{t(query ? 'ledger.booksDesk.searchHint' : `ledger.booksDesk.emptyHint.${scope}`)}</p>
                {query && <Button variant="outline" className="mt-3" onClick={() => setSearch('')}>{t('ledger.booksDesk.clearSearch')}</Button>}
              </div>
            ) : (
              <ul className="divide-y divide-hairline" aria-label={scopeLabel(scope)}>
                {rows.map((book) => {
                  const inbox = book.my_inbox
                  return (
                    <li key={book.id}>
                      <button type="button" aria-current={book.id === selectedId ? 'true' : undefined} onClick={() => selectBook(book.id)} className={cn('w-full px-4 py-4 text-start transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', book.id === selectedId && 'bg-primary-soft')}>
                        <span className="flex items-center text-sm"><InboxUnreadDot book={book} /><bdi dir="ltr" className="font-mono font-medium tabular-nums">{book.ref_number}</bdi></span>
                        <span dir="auto" className="mt-1 block break-words text-sm font-semibold">{book.subject || t('ledger.booksDesk.untitled')}</span>
                        <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
                          {scope !== 'outgoing' && inbox ? <><bdi>{pickEmployeeName({ name_en: inbox.sent_by_name ?? '', name_ar: inbox.sent_by_name_ar }, i18n.language)}</bdi>{' · '}{t(`books.send.purposes.${inbox.purpose}`)}{' · '}<BookDate value={inbox.sent_at} /></> : <>{t('ledger.booksDesk.created')} <BookDate value={book.created_at} /></>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          {(offset > 0 || (list.data?.total ?? 0) > PAGE_SIZE) && (
            <div className="flex shrink-0 justify-between gap-2 border-t border-hairline p-3">
              <Button variant="outline" size="sm" disabled={offset === 0 || list.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{t('ledger.booksDesk.previous')}</Button>
              <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= (list.data?.total ?? 0) || list.isFetching} onClick={() => setOffset(offset + PAGE_SIZE)}>{t('ledger.booksDesk.next')}</Button>
            </div>
          )}
        </div>
        {!isMobile && (
          <div className="min-w-0 flex-1 overflow-y-auto" aria-label={t('ledger.booksDesk.dossier')}>
            {selectedId === null ? <div className="max-w-prose px-8 py-10"><h2 className="text-lg font-semibold">{t('ledger.booksDesk.selectBook')}</h2><p className="mt-2 text-sm text-muted-foreground">{t('ledger.booksDesk.selectHint')}</p></div> : dossier}
          </div>
        )}
      </div>
    </section>
  )
}

function BookDossier({ book }: { book: BookRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [sendOpen, setSendOpen] = useState(false)
  const inboxActions = useInboxActions(book)
  const reply = useReplyActions(book)
  const inbox = book.my_inbox
  const notApplicable = t('ledger.booksDesk.notApplicable')
  const facts: { label: string; value: ReactNode }[] = [
    { label: t('ledger.booksDesk.from'), value: inbox ? <bdi>{pickEmployeeName({ name_en: inbox.sent_by_name ?? '', name_ar: inbox.sent_by_name_ar }, i18n.language)}</bdi> : notApplicable },
    { label: t('books.send.purpose'), value: inbox ? t(`books.send.purposes.${inbox.purpose}`) : notApplicable },
    { label: t('ledger.booksDesk.sent'), value: inbox ? <BookDate value={inbox.sent_at} /> : notApplicable },
    { label: t('ledger.booksDesk.opened'), value: inbox ? (inbox.read_at ? <BookDate value={inbox.read_at} /> : t('books.send.notOpened')) : notApplicable },
    { label: t('books.inbox.doneState'), value: inbox ? (inbox.done_at ? <BookDate value={inbox.done_at} /> : t('ledger.booksDesk.notDone')) : notApplicable },
    { label: t('ledger.booksDesk.confidentiality'), value: t(`books.confidentiality.levels.${book.confidentiality}`) },
  ]
  return (
    <article>
      <header className="px-5 pb-4 pt-6 sm:px-7">
        <bdi dir="ltr" className="font-mono text-sm font-medium tabular-nums text-muted-foreground">{book.ref_number}</bdi>
        <h2 dir="auto" className="mt-2 break-words text-xl font-semibold leading-snug tracking-tight">{book.subject || t('ledger.booksDesk.untitled')}</h2>
      </header>
      <dl className="mx-5 border-t border-hairline sm:mx-7">
        {facts.map(({ label, value }) => <div key={label} className="grid grid-cols-[minmax(7rem,1fr)_2fr] gap-x-4 border-b border-hairline py-3 text-sm"><dt className="font-semibold">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}
      </dl>
      {inbox?.note && <section className="px-5 pt-5 sm:px-7"><h3 className="text-sm font-semibold">{t('ledger.booksDesk.note')}</h3><p dir="auto" className="mt-2 max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{inbox.note}</p></section>}
      <div className="flex flex-wrap gap-2 border-b border-hairline px-5 py-5 sm:px-7">
        <Link to={`/books/${book.id}`} className={buttonVariants({ size: 'sm' })}>{t('ledger.booksDesk.openRecord')}</Link>
        {book.can_send && <Button variant="outline" size="sm" onClick={() => setSendOpen(true)}><Send className="h-4 w-4" aria-hidden />{t('ledger.booksDesk.forward')}</Button>}
        {inboxActions.map((action) => <Button key={action.key} variant="outline" size="sm" disabled={action.pending} aria-busy={action.pending} onClick={action.onSelect}>{action.icon}{action.label}</Button>)}
        {reply.actions.map((action) => <Button key={action.key} variant="outline" size="sm" onClick={action.onSelect}>{action.icon}{action.label}</Button>)}
      </div>
      <RecordRecipientsPanel bookId={book.id} />
      <RecordThreadSection book={book} />
      {book.can_send && <SendRecordDialog book={book} open={sendOpen} onOpenChange={setSendOpen} />}
      {reply.dialog}
    </article>
  )
}
