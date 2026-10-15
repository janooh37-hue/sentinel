import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeft, BookText, CheckCheck, FileText, Maximize2, Minimize2, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { ConfidentialityChip } from '@/components/books/ConfidentialityChip'
import { DocumentState } from '@/components/books/DocumentState'
import { PurposeMark } from '@/components/books/PurposeMark'
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
import { inboxSummaryKey, useInboxSummary } from '@/pages/books/useInboxCount'
import { defaultPaperKey, paperCountOf, paperKey, papersOf } from '@/pages/books/recordPapers'
import type { PaperKey } from '@/pages/books/recordPapers'

const RecordPaperViewer = lazy(() => import('@/pages/books/RecordPaperViewer'))

type Scope = 'incoming' | 'done' | 'outgoing' | 'archived'
const INBOX_BY_SCOPE: Record<Scope, 'received' | 'done' | 'sent' | 'archived'> = {
  incoming: 'received', done: 'done', outgoing: 'sent', archived: 'archived',
}
const PAGE_SIZE = 50
// One template for the header and every row so columns align from lg up; below lg rows stack.
// Received: purpose | ref | subject | from | confidentiality | state | sent. Outgoing has no inbox row.
const RECEIVED_GRID = 'lg:grid-cols-[9.5rem_10.5rem_minmax(0,1fr)_minmax(7rem,12rem)_6.5rem_6rem_6rem]'
const OUTGOING_GRID = 'lg:grid-cols-[10.5rem_minmax(0,1fr)_minmax(7rem,12rem)_6.5rem_6rem]'

function BookDate({ value }: { value: string }): React.JSX.Element {
  return <time dateTime={value} dir="ltr" className="font-mono tabular-nums">{formatDmy(value.slice(0, 10))}</time>
}

function DeskLoading(): React.JSX.Element {
  return <div className="space-y-4 p-5" aria-busy="true"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-1/2" /></div>
}

/** Where the book stands in my inbox: shape + text, so colour is never the only cue. */
function InboxState({ inbox }: { inbox: BookInboxRead }): React.JSX.Element {
  const { t } = useTranslation()
  if (inbox.archived_at) return <span className="inline-flex items-center gap-1.5"><Archive className="h-3.5 w-3.5 shrink-0" aria-hidden />{t('books.inbox.archivedState')}</span>
  if (inbox.done_at) return <span className="inline-flex items-center gap-1.5 text-success"><CheckCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />{t('books.inbox.doneState')}</span>
  if (inbox.read_at) return <span>{t('ledger.booksDesk.state.read')}</span>
  return <span className="inline-flex items-center gap-1.5 font-semibold text-foreground"><span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />{t('ledger.booksDesk.state.unread')}</span>
}

function PaperCount({ count }: { count: number }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs font-normal tabular-nums text-muted-foreground">
      <FileText className="h-3.5 w-3.5" aria-hidden />
      <bdi dir="ltr" aria-hidden>{count}</bdi>
      <span className="sr-only">{t('books.pane.papers', { count })}</span>
    </span>
  )
}

export function BooksRoutingDesk(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const rawScope = params.get('scope')
  const scope: Scope = rawScope === 'done' || rawScope === 'outgoing' || rawScope === 'archived' ? rawScope : 'incoming'
  const [bookParam, setBookParam] = useSearchParam('book')
  // Opening pushes, so the toolbar Back and the browser Back both return to the list.
  const bookPage = useUrlOverlay('book', ['view'])
  const [view, setView] = useSearchParam('view')
  const selectedId = /^\d+$/.test(bookParam) && Number(bookParam) > 0 ? Number(bookParam) : null
  const [lastOpenedId, setLastOpenedId] = useState(selectedId)
  if (selectedId !== null && selectedId !== lastOpenedId) setLastOpenedId(selectedId)
  const listRef = useRef<HTMLUListElement>(null)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setOffset(0) }, 300)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    // Back from a book returns focus to its row.
    if (selectedId === null && lastOpenedId !== null) listRef.current?.querySelector<HTMLElement>(`[data-book-id="${lastOpenedId}"]`)?.focus()
  }, [selectedId, lastOpenedId])
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
        // A read receipt must not make a mutation-invalidated scope fresh again.
        qc.setQueriesData<BookListResponse>({ queryKey: ['books', 'routing'], predicate: (query) => !query.state.isInvalidated }, (previous) => previous && ({
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
  function updateInbox(id: number, inbox: BookInboxRead): void {
    const staysInScope = (value: unknown): boolean => value === 'outgoing'
      || (value === 'archived' ? !!inbox.archived_at : !inbox.archived_at && (value === 'done' ? !!inbox.done_at : !inbox.done_at))
    const remaining = (list.data?.items ?? []).filter((row) => row.id !== id)
    if (selectedId === id && !staysInScope(scope)) {
      // Work the queue: open the next book in place, or return to the empty list.
      const index = list.data?.items.findIndex((row) => row.id === id) ?? 0
      const next = remaining[index] ?? remaining[0]
      if (next) setBookParam(String(next.id))
      else bookPage.close()
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
  const open = selectedId !== null
  const reader = !isMobile && view === 'reader' && open
  const received = scope !== 'outgoing'
  const grid = received ? RECEIVED_GRID : OUTGOING_GRID
  const unread = summary.data?.unread ?? 0

  return (
    <section dir={i18n.dir()} className="flex min-h-0 flex-1 flex-col bg-surface" aria-label={t('ledger.tabs.books')}>
      {/* Keep the list mounted while a book is open so Back restores search and scroll. */}
      <div hidden={open} className={cn('min-h-0 flex-1 flex-col', open ? 'hidden' : 'flex')}>
        <div className="flex shrink-0 flex-wrap items-center gap-x-6 border-b border-border px-4 lg:px-6">
          <Tabs value={scope} onValueChange={selectScope} className="min-w-0 max-w-full">
            <TabsList className="gap-6 overflow-x-auto border-b-0">
              {(['incoming', 'done', 'outgoing', 'archived'] as const).map((value) => (
                <TabsTrigger key={value} value={value}>
                  {scopeLabel(value)}
                  {value === 'incoming' && unread > 0 && (
                    <span className="ms-2 font-mono text-xs font-semibold tabular-nums text-primary" aria-label={t('books.inbox.unread', { count: unread })}>{unread}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="w-full pb-3 sm:ms-auto sm:w-72 sm:py-2">
            <label htmlFor="routing-search" className="sr-only">{t('ledger.booksDesk.search')}</label>
            <Input id="routing-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('ledger.booksDesk.search')} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={list.isFetching}>
          {list.isPending ? <DeskLoading /> : list.isError ? (
            <div role="alert" className="px-4 py-8 text-sm text-destructive lg:px-6"><p>{apiErrorMessage(list.error)}</p><Button variant="outline" className="mt-3" onClick={() => void list.refetch()}>{t('ledger.booksDesk.retry')}</Button></div>
          ) : rows.length === 0 ? (
            <div className="max-w-prose px-4 py-10 text-sm lg:px-6">
              <h2 className="text-base font-semibold">{t(query ? 'ledger.booksDesk.noMatches' : `ledger.booksDesk.empty.${scope}`)}</h2>
              <p className="mt-2 text-muted-foreground">{t(query ? 'ledger.booksDesk.searchHint' : `ledger.booksDesk.emptyHint.${scope}`)}</p>
              {query && <Button variant="outline" className="mt-4" onClick={() => setSearch('')}>{t('ledger.booksDesk.clearSearch')}</Button>}
            </div>
          ) : (
            <>
              <div aria-hidden className={cn('sticky top-0 z-10 hidden gap-x-4 border-b border-hairline bg-surface px-6 py-2 text-xs font-medium text-muted-foreground lg:grid', grid)}>
                {received && <span>{t('books.send.purpose')}</span>}
                <span>{t('ledger.booksDesk.columns.ref')}</span>
                <span>{t('ledger.booksDesk.columns.subject')}</span>
                <span>{t(received ? 'ledger.booksDesk.from' : 'ledger.booksDesk.columns.createdBy')}</span>
                <span>{t('ledger.booksDesk.confidentiality')}</span>
                {received && <span>{t('ledger.booksDesk.columns.state')}</span>}
                <span className="text-end">{t(received ? 'ledger.booksDesk.sent' : 'ledger.booksDesk.created')}</span>
              </div>
              <ul ref={listRef} className="divide-y divide-hairline" aria-label={scopeLabel(scope)}>
                {rows.map((book) => {
                  const inbox = book.my_inbox
                  const papers = paperCountOf(book, { inmateReporter: false })
                  const who = inbox
                    ? pickEmployeeName({ name_en: inbox.sent_by_name ?? '', name_ar: inbox.sent_by_name_ar }, i18n.language)
                    : pickEmployeeName({ name_en: book.created_by_name ?? '', name_ar: book.created_by_name_ar }, i18n.language)
                  return (
                    <li key={book.id}>
                      <button
                        type="button"
                        data-book-id={book.id}
                        aria-current={book.id === lastOpenedId ? 'true' : undefined}
                        onClick={() => bookPage.open(String(book.id))}
                        className={cn(
                          'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 px-4 py-3 text-start text-sm transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:items-center lg:gap-x-4 lg:px-6',
                          grid,
                          book.id === lastOpenedId && 'bg-primary-soft hover:bg-primary-soft',
                        )}
                      >
                        {received && <span className="min-w-0">{inbox && <PurposeMark purpose={inbox.purpose} />}</span>}
                        <span title={book.ref_number} className="min-w-0 truncate font-mono text-xs tabular-nums text-muted-foreground"><bdi dir="ltr">{book.ref_number}</bdi></span>
                        <span className="col-span-3 flex min-w-0 items-baseline gap-3 lg:col-span-1">
                          <span dir="auto" className={cn('min-w-0 break-words', inbox && !inbox.read_at ? 'font-semibold' : 'font-medium')}>{book.subject || t('ledger.booksDesk.untitled')}</span>
                          {papers > 1 && <PaperCount count={papers} />}
                        </span>
                        <span className="col-span-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground lg:contents">
                          <bdi className="min-w-0 truncate lg:text-sm lg:text-foreground">{who}</bdi>
                          <span className="empty:hidden lg:empty:block"><ConfidentialityChip level={book.confidentiality} /></span>
                          {received && <span className="lg:text-sm">{inbox && <InboxState inbox={inbox} />}</span>}
                        </span>
                        <span className="col-start-3 row-start-1 text-end text-xs text-muted-foreground lg:col-start-auto lg:row-start-auto">
                          <BookDate value={inbox?.sent_at ?? book.created_at} />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
        {(offset > 0 || (list.data?.total ?? 0) > PAGE_SIZE) && (
          <div className="flex shrink-0 justify-between gap-2 border-t border-hairline px-4 py-3 lg:px-6">
            <Button variant="outline" size="sm" disabled={offset === 0 || list.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{t('ledger.booksDesk.previous')}</Button>
            <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= (list.data?.total ?? 0) || list.isFetching} onClick={() => setOffset(offset + PAGE_SIZE)}>{t('ledger.booksDesk.next')}</Button>
          </div>
        )}
      </div>
      {open && (
        detail.data ? (
          <BookDossier
            key={detail.data.id}
            book={detail.data}
            loading={detail.isPlaceholderData}
            reader={reader}
            isMobile={isMobile}
            onBack={bookPage.close}
            onToggleReader={() => setView(reader ? null : 'reader')}
            onInboxUpdated={updateInbox}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center border-b border-border bg-surface-raised px-3 py-2 lg:px-4">
              <Button variant="ghost" size="sm" onClick={bookPage.close}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />{t('ledger.booksDesk.backToList')}</Button>
            </div>
            {detail.isError
              ? <div role="alert" className="px-4 py-8 text-destructive lg:px-6"><p>{apiErrorMessage(detail.error)}</p><Button variant="outline" className="mt-3" onClick={() => void detail.refetch()}>{t('ledger.booksDesk.retry')}</Button></div>
              : <DeskLoading />}
          </div>
        )
      )}
    </section>
  )
}

function BookDossier({ book, loading, reader, isMobile, onBack, onToggleReader, onInboxUpdated }: {
  book: BookRead
  loading: boolean
  reader: boolean
  isMobile: boolean
  onBack: () => void
  onToggleReader: () => void
  onInboxUpdated: (id: number, inbox: BookInboxRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [sendOpen, setSendOpen] = useState(false)
  const [pickedPaper, setPickedPaper] = useState<PaperKey | null>(null)
  const papers = useMemo(() => papersOf(book, { inmateReporter: false }), [book])
  const selectedPaper = pickedPaper && papers.some((paper) => paperKey(paper) === pickedPaper)
    ? pickedPaper : defaultPaperKey(book, papers)
  const inboxActions = useInboxActions(loading ? null : book, onInboxUpdated)
  const reply = useReplyActions(loading ? null : book)
  const inbox = book.my_inbox
  const facts: { label: string; value: ReactNode }[] = inbox ? [
    { label: t('ledger.booksDesk.from'), value: <bdi>{pickEmployeeName({ name_en: inbox.sent_by_name ?? '', name_ar: inbox.sent_by_name_ar }, i18n.language)}</bdi> },
    { label: t('ledger.booksDesk.sent'), value: <BookDate value={inbox.sent_at} /> },
    { label: t('ledger.booksDesk.opened'), value: inbox.read_at ? <BookDate value={inbox.read_at} /> : t('books.send.notOpened') },
    { label: t('books.inbox.doneState'), value: inbox.done_at ? <BookDate value={inbox.done_at} /> : t('ledger.booksDesk.notDone') },
  ] : [
    { label: t('ledger.booksDesk.columns.createdBy'), value: <bdi>{pickEmployeeName({ name_en: book.created_by_name ?? '', name_ar: book.created_by_name_ar }, i18n.language)}</bdi> },
    { label: t('ledger.booksDesk.created'), value: <BookDate value={book.created_at} /> },
  ]
  facts.push({ label: t('ledger.booksDesk.columns.papers'), value: <bdi dir="ltr" className="font-mono tabular-nums">{papers.length}</bdi> })
  const titleId = `book-title-${book.id}`
  return (
    <article aria-labelledby={titleId} className={cn('flex min-h-0 min-w-0 flex-1 flex-col', isMobile && 'overflow-y-auto')}>
      <div className={cn('flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-3 py-2 lg:px-4', isMobile && 'sticky top-0 z-10')}>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onBack}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />{t('ledger.booksDesk.backToList')}</Button>
        <span aria-hidden className="mx-1 hidden h-5 w-px shrink-0 bg-border sm:block" />
        {inboxActions.map((action) => <Button key={action.key} className="shrink-0" variant={action.key === 'done' ? 'default' : 'outline'} size="sm" disabled={action.pending} aria-busy={action.pending} onClick={action.onSelect}>{action.icon}{action.label}</Button>)}
        {book.can_send && <Button className="shrink-0" variant="outline" size="sm" disabled={loading} onClick={() => setSendOpen(true)}><Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden />{t('ledger.booksDesk.forward')}</Button>}
        {reply.actions.map((action) => <Button key={action.key} className="shrink-0" variant="outline" size="sm" onClick={action.onSelect}>{action.icon}{action.label}</Button>)}
        <div className="ms-auto flex shrink-0 items-center gap-1 ps-2">
          {!isMobile && <Button variant="ghost" size="sm" onClick={onToggleReader}>{reader ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}{t(reader ? 'ledger.booksDesk.collapse' : 'ledger.booksDesk.expand')}</Button>}
          <Link to={`/books/${book.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}><BookText className="h-4 w-4" aria-hidden />{t('ledger.booksDesk.openInRecords')}</Link>
        </div>
      </div>
      <header className="shrink-0 border-b border-hairline px-4 py-4 lg:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {inbox && <PurposeMark purpose={inbox.purpose} />}
          <bdi dir="ltr" className="font-mono text-xs tabular-nums text-muted-foreground">{book.ref_number}</bdi>
          <ConfidentialityChip level={book.confidentiality} />
        </div>
        <h2 id={titleId} className="mt-2 max-w-[75ch] break-words text-xl font-semibold leading-snug tracking-tight"><bdi>{book.subject || t('ledger.booksDesk.untitled')}</bdi></h2>
      </header>
      <div className={cn('flex min-w-0', isMobile ? 'shrink-0 flex-col' : 'min-h-0 flex-1')}>
        <div className={cn('flex min-w-0 flex-col', isMobile ? 'h-[65dvh] min-h-[24rem] shrink-0' : 'min-h-0 flex-1')}>
          {loading ? <DeskLoading /> : papers.length === 0 ? (
            <DocumentState kind="empty" title={t('ledger.booksDesk.noDocument')} body={t('ledger.booksDesk.noDocumentHint')} />
          ) : <Suspense fallback={<DeskLoading />}><RecordPaperViewer papers={papers} selectedKey={selectedPaper} onSelectKey={setPickedPaper} mode="pane" initialFit="width" compact /></Suspense>}
        </div>
        {!reader && (
          <aside className={cn('shrink-0 border-hairline px-4 py-5 lg:px-6', isMobile ? 'border-t' : 'min-h-0 w-80 overflow-y-auto border-s xl:w-96')} aria-label={t('ledger.booksDesk.details')}>
            {inbox?.note && (
              <section className="mb-6">
                <h3 className="text-xs font-medium text-muted-foreground">{t('ledger.booksDesk.note')}</h3>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed"><bdi>{inbox.note}</bdi></p>
              </section>
            )}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 text-sm">
              {facts.map(({ label, value }) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words font-medium">{value}</dd></div>)}
            </dl>
            {!loading && <div className="mt-6 space-y-6"><RecordRecipientsPanel bookId={book.id} /><RecordThreadSection book={book} /></div>}
          </aside>
        )}
      </div>
      {book.can_send && <SendRecordDialog book={book} open={sendOpen} onOpenChange={setSendOpen} />}
      {reply.dialog}
    </article>
  )
}
