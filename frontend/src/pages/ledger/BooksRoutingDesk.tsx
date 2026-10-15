import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, Maximize2, Minimize2, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { DocumentState } from '@/components/books/DocumentState'
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
import { api, apiErrorMessage } from '@/lib/api'
import type { BookInboxRead, BookListResponse, BookRead } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { formatDmy } from '@/lib/formatDmy'
import { useIsMobile } from '@/lib/useIsMobile'
import { useSearchParam, useUrlOverlay } from '@/lib/urlState'
import { cn } from '@/lib/utils'
import { InboxUnreadDot } from '@/pages/books/InboxUnreadDot'
import { inboxSummaryKey, useInboxSummary } from '@/pages/books/useInboxCount'
import { defaultPaperKey, paperKey, papersOf } from '@/pages/books/recordPapers'
import type { PaperKey } from '@/pages/books/recordPapers'

const RecordPaperViewer = lazy(() => import('@/pages/books/RecordPaperViewer'))

type Scope = 'incoming' | 'done' | 'outgoing' | 'archived'
const INBOX_BY_SCOPE: Record<Scope, 'received' | 'done' | 'sent' | 'archived'> = {
  incoming: 'received', done: 'done', outgoing: 'sent', archived: 'archived',
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
  const scope: Scope = rawScope === 'done' || rawScope === 'outgoing' || rawScope === 'archived' ? rawScope : 'incoming'
  const [bookParam, setBookParam] = useSearchParam('book')
  const bookPage = useUrlOverlay('book')
  const readerPage = useUrlOverlay('view')
  const readerQueueSelection = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (readerPage.value === 'reader' || readerQueueSelection.current === undefined) return
    // Back pops the URL from before queue processing; keep the advanced selection.
    setBookParam(readerQueueSelection.current)
    readerQueueSelection.current = undefined
  }, [readerPage.value, setBookParam])
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
    staleTime: 30_000,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === scope ? keepPreviousData(previous) : undefined,
  })
  const detail = useQuery({
    queryKey: ['books', 'detail', selectedId, null],
    queryFn: async () => {
      // Opening marks read, but patch cached rows instead of refetching the list.
      const book = await api.getBook(selectedId!)
      if (book.my_inbox?.read_at) {
        qc.setQueriesData<BookListResponse>({ queryKey: ['books', 'routing'] }, (previous) => previous && ({
          ...previous,
          items: previous.items.map((row) => row.id === book.id ? { ...row, my_inbox: book.my_inbox } : row),
        }))
        void qc.invalidateQueries({ queryKey: inboxSummaryKey })
        void qc.invalidateQueries({ queryKey: ['notifications', 'counts'] })
      }
      return book
    },
    enabled: selectedId !== null,
    placeholderData: () => list.data?.items.find((book) => book.id === selectedId),
  })

  function selectScope(value: string): void {
    setOffset(0)
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('scope', value)
      next.delete('book')
      next.delete('view')
      return next
    }, { replace: true })
  }
  function selectBook(id: number): void {
    if (isMobile) bookPage.open(String(id))
    else setBookParam(String(id))
  }
  function updateInbox(id: number, inbox: BookInboxRead): void {
    const staysInScope = (value: unknown): boolean => value === 'outgoing'
      || (value === 'archived' ? !!inbox.archived_at : !inbox.archived_at && (value === 'done' ? !!inbox.done_at : !inbox.done_at))
    const remaining = (list.data?.items ?? []).filter((row) => row.id !== id)
    if (selectedId === id && !staysInScope(scope)) {
      const index = list.data?.items.findIndex((row) => row.id === id) ?? 0
      const next = remaining[index] ?? remaining[0]
      const nextId = next ? String(next.id) : null
      if (!isMobile && readerPage.value === 'reader') readerQueueSelection.current = nextId
      if (nextId === null) {
        setParams((previous) => {
          const nextParams = new URLSearchParams(previous)
          nextParams.delete('book')
          nextParams.delete('view')
          return nextParams
        }, { replace: true })
      } else setBookParam(nextId)
    }
    qc.setQueryData<BookRead>(['books', 'detail', id, null], (previous) => previous && ({ ...previous, my_inbox: inbox }))
    for (const [key] of qc.getQueriesData<BookListResponse>({ queryKey: ['books', 'routing'] })) {
      qc.setQueryData<BookListResponse>(key, (previous) => {
        if (!previous) return previous
        const included = previous.items.some((row) => row.id === id)
        return {
          ...previous,
          items: staysInScope(key[2]) ? previous.items.map((row) => row.id === id ? { ...row, my_inbox: inbox } : row) : previous.items.filter((row) => row.id !== id),
          total: included && !staysInScope(key[2]) ? previous.total - 1 : previous.total,
        }
      })
    }
  }
  const scopeLabel = (value: Scope): string => t(`ledger.booksDesk.${value}`)
  const rows = list.data?.items ?? []
  const reader = !isMobile && readerPage.value === 'reader' && selectedId !== null
  const mobileBook = isMobile && selectedId !== null
  const dossier = detail.data ? (
    <BookDossier
      key={detail.data.id}
      book={detail.data}
      loading={detail.isPlaceholderData}
      reader={reader}
      isMobile={isMobile}
      onToggleReader={reader ? readerPage.close : () => readerPage.open('reader')}
      onInboxUpdated={updateInbox}
    />
  ) : detail.isError
    ? <div role="alert" className="p-5 text-destructive"><p>{apiErrorMessage(detail.error)}</p><Button variant="outline" className="mt-3" onClick={() => void detail.refetch()}>{t('ledger.booksDesk.retry')}</Button></div>
    : <DeskLoading />

  return (
    <section dir={i18n.dir()} className="flex min-h-0 flex-1 flex-col bg-surface" aria-label={t('ledger.tabs.books')}>
      <Tabs value={scope} onValueChange={selectScope} className={cn('shrink-0', (reader || mobileBook) && 'hidden')}>
        <TabsList className="gap-5 overflow-x-auto px-4">
          {(['incoming', 'done', 'outgoing', 'archived'] as const).map((value) => (
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
        {/* Keep the list mounted so reader/mobile Back preserves its scroll. */}
        <div hidden={reader || mobileBook} className={cn('min-h-0 w-full shrink-0 flex-col md:w-[22rem] md:max-w-[44%] md:border-e md:border-hairline', reader || mobileBook ? 'hidden' : 'flex')}>
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
        {(!isMobile || mobileBook) && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('ledger.booksDesk.dossier')}>
            {mobileBook && <div className="shrink-0 border-b border-hairline px-3 py-2"><Button variant="ghost" onClick={bookPage.close}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />{t('ledger.outlook.back')}</Button></div>}
            {selectedId === null ? <div className="max-w-prose px-8 py-10"><h2 className="text-lg font-semibold">{t('ledger.booksDesk.selectBook')}</h2><p className="mt-2 text-sm text-muted-foreground">{t('ledger.booksDesk.selectHint')}</p></div> : dossier}
          </div>
        )}
      </div>
    </section>
  )
}

function BookDossier({ book, loading, reader, isMobile, onToggleReader, onInboxUpdated }: {
  book: BookRead
  loading: boolean
  reader: boolean
  isMobile: boolean
  onToggleReader: () => void
  onInboxUpdated: (id: number, inbox: BookInboxRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [sendOpen, setSendOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [pickedPaper, setPickedPaper] = useState<PaperKey | null>(null)
  const papers = useMemo(() => papersOf(book, { inmateReporter: false }), [book])
  const selectedPaper = pickedPaper && papers.some((paper) => paperKey(paper) === pickedPaper)
    ? pickedPaper : defaultPaperKey(book, papers)
  const inboxActions = useInboxActions(loading ? null : book, onInboxUpdated)
  const reply = useReplyActions(loading ? null : book)
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
  const actions = (
    <div className="flex flex-wrap gap-2">
      {inboxActions.map((action) => <Button key={action.key} variant={action.key === 'done' ? 'default' : 'outline'} size="sm" disabled={action.pending} aria-busy={action.pending} onClick={action.onSelect}>{action.icon}{action.label}</Button>)}
      {book.can_send && <Button variant="outline" size="sm" disabled={loading} onClick={() => setSendOpen(true)}><Send className="h-4 w-4" aria-hidden />{t('ledger.booksDesk.forward')}</Button>}
      {reply.actions.map((action) => <Button key={action.key} variant="outline" size="sm" onClick={action.onSelect}>{action.icon}{action.label}</Button>)}
    </div>
  )
  const details = (
    <div id={`book-details-${book.id}`}>
      <dl className="border-t border-hairline">
        {facts.map(({ label, value }) => <div key={label} className="grid grid-cols-[minmax(6rem,1fr)_2fr] gap-x-3 border-b border-hairline py-3 text-sm"><dt className="font-semibold">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}
      </dl>
      {!loading && <><RecordRecipientsPanel bookId={book.id} /><RecordThreadSection book={book} /></>}
      <Link to={`/books/${book.id}`} className={buttonVariants({ variant: 'link', size: 'sm', className: 'mt-3' })}>{t('ledger.booksDesk.openInRecords')}</Link>
    </div>
  )
  return (
    <article className="flex min-h-0 flex-1 flex-col">
      <header className="max-h-[45%] shrink-0 overflow-y-auto border-b border-hairline px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <bdi dir="ltr" className="font-mono text-xs font-medium tabular-nums text-muted-foreground">{book.ref_number}</bdi>
            <h2 dir="auto" className="mt-1 break-words text-lg font-semibold leading-snug tracking-tight">{book.subject || t('ledger.booksDesk.untitled')}</h2>
          </div>
          {!isMobile && <Button variant="ghost" size="sm" onClick={onToggleReader}>{reader ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}{t(reader ? 'ledger.booksDesk.collapse' : 'ledger.booksDesk.expand')}</Button>}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {inbox ? <><bdi>{pickEmployeeName({ name_en: inbox.sent_by_name ?? '', name_ar: inbox.sent_by_name_ar }, i18n.language)}</bdi>{' · '}{t(`books.send.purposes.${inbox.purpose}`)}{' · '}<BookDate value={inbox.sent_at} /></> : <>{t('ledger.booksDesk.created')} <BookDate value={book.created_at} /></>}
        </p>
        {inbox?.note && <p dir="auto" className="mt-2 max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed"><span className="sr-only">{t('ledger.booksDesk.note')}: </span>{inbox.note}</p>}
        {!reader && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}<Button variant="ghost" size="sm" aria-expanded={detailsOpen} aria-controls={`book-details-${book.id}`} onClick={() => setDetailsOpen(!detailsOpen)}><ChevronDown className={cn('h-4 w-4', detailsOpen && 'rotate-180')} aria-hidden />{t('ledger.booksDesk.details')}</Button></div>}
      </header>
      <div className={cn('flex min-h-0 flex-1', !reader && 'flex-col')}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {loading ? <DeskLoading /> : papers.length === 0 ? (
            <DocumentState kind="empty" title={t('ledger.booksDesk.noDocument')} body={t('ledger.booksDesk.noDocumentHint')} />
          ) : <Suspense fallback={<DeskLoading />}><RecordPaperViewer papers={papers} selectedKey={selectedPaper} onSelectKey={setPickedPaper} mode="pane" /></Suspense>}
        </div>
        {reader ? (
          <aside className="w-[20rem] max-w-[35%] shrink-0 overflow-y-auto border-s border-hairline p-4">
            <Button variant="ghost" size="sm" className="mb-4" onClick={onToggleReader}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />{t('ledger.outlook.back')}</Button>
            {actions}
            <h3 className="mb-2 mt-4 text-sm font-semibold">{t('ledger.booksDesk.details')}</h3>
            {details}
          </aside>
        ) : detailsOpen && <section className="max-h-[45%] shrink-0 overflow-y-auto border-t border-hairline px-4 py-3" aria-label={t('ledger.booksDesk.details')}>{details}</section>}
      </div>
      {book.can_send && <SendRecordDialog book={book} open={sendOpen} onOpenChange={setSendOpen} />}
      {reply.dialog}
    </article>
  )
}
