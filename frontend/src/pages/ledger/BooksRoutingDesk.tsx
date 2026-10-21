import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive, ArrowDownUp, ArrowLeft, BookText, CheckCheck, Eye, FileText, Flag, FolderArchive, FolderCheck,
  FolderInput, FolderOutput, Maximize2, MessageSquareText, Minimize2, Search, Send, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { ConfidentialityMark } from '@/components/books/ConfidentialityChip'
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
import { Kbd } from '@/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, apiErrorMessage } from '@/lib/api'
import type { BookInboxRead, BookListResponse, BookRead, BookRecipientRead, SendPurpose } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { pickEmployeeName } from '@/lib/employeeName'
import { formatDmy } from '@/lib/formatDmy'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import { useIsMobile } from '@/lib/useIsMobile'
import { useSearchParam, useUrlOverlay } from '@/lib/urlState'
import { cn } from '@/lib/utils'
import { inboxSummaryKey, useInboxSummary } from '@/pages/books/useInboxCount'
import { defaultPaperKey, paperCountOf, paperKey, papersOf } from '@/pages/books/recordPapers'
import type { PaperKey } from '@/pages/books/recordPapers'

const RecordPaperViewer = lazy(() => import('@/pages/books/RecordPaperViewer'))

type Scope = 'incoming' | 'done' | 'outgoing' | 'archived'
type ListScope = Scope | 'any'
const SCOPES: readonly Scope[] = ['incoming', 'done', 'outgoing', 'archived']
const INBOX_BY_SCOPE: Record<ListScope, 'received' | 'done' | 'sent' | 'archived' | 'any'> = {
  incoming: 'received', done: 'done', outgoing: 'sent', archived: 'archived', any: 'any',
}
// One folder family so the four places read as a set; in/out arrows mirror in RTL.
const SCOPE_ICON: Record<Scope, { icon: LucideIcon; className?: string }> = {
  incoming: { icon: FolderInput, className: 'rtl:-scale-x-100' },
  done: { icon: FolderCheck },
  outgoing: { icon: FolderOutput, className: 'rtl:-scale-x-100' },
  archived: { icon: FolderArchive },
}
const SORTS = ['newest', 'oldest', 'secret', 'urgent'] as const
type Sort = (typeof SORTS)[number]
const SORT_KEY: Record<Sort, string> = {
  newest: 'ledger.booksDesk.sortNewest', oldest: 'ledger.booksDesk.sortOldest',
  secret: 'ledger.booksDesk.sortSecret', urgent: 'ledger.booksDesk.sortUrgent',
}
const PAGE_SIZE = 50

function BookDate({ value }: { value: string }): React.JSX.Element {
  return <time dateTime={value} dir="ltr" className="font-mono tabular-nums">{formatDmy(value.slice(0, 10))}</time>
}

function ScopeIcon({ scope, className }: { scope: Scope; className?: string }): React.JSX.Element {
  const { icon: Icon, className: flip } = SCOPE_ICON[scope]
  return <Icon className={cn('h-4 w-4 shrink-0', flip, className)} strokeWidth={1.8} aria-hidden />
}

/** Which desk place a search hit lives in, from the caller's own send row. */
function scopeOf(book: BookRead): Scope {
  const inbox = book.my_inbox
  if (!inbox) return 'outgoing'
  return inbox.archived_at ? 'archived' : inbox.done_at ? 'done' : 'incoming'
}

/** A labelled fact on a row's meta line: muted label, readable value. */
function Meta({ label, title, children }: { label: string; title?: string; children: ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1" title={title}>
      <span className="shrink-0">{label}</span>
      <bdi className="min-w-0 truncate text-foreground">{children}</bdi>
    </span>
  )
}

function DeskLoading(): React.JSX.Element {
  return <div className="space-y-4 p-5" aria-busy="true"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-1/2" /></div>
}

/** Where the book stands in my inbox: shape + text, so colour is never the only cue. */
function InboxState({ inbox }: { inbox: BookInboxRead }): React.JSX.Element {
  const { t } = useTranslation()
  if (inbox.archived_at) return <span className="inline-flex items-center gap-1.5"><Archive className="h-3.5 w-3.5 shrink-0" aria-hidden />{t('ledger.booksDesk.state.archived')}</span>
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
  const [rawSort, setSort] = useSearchParam('sort', { fallback: 'newest' })
  const sort: Sort = (SORTS as readonly string[]).includes(rawSort) ? (rawSort as Sort) : 'newest'
  const [bookParam, setBookParam] = useSearchParam('book')
  // Opening pushes, so the toolbar Back and the browser Back both return to the list.
  const bookPage = useUrlOverlay('book', ['view'])
  const [view, setView] = useSearchParam('view')
  const selectedId = /^\d+$/.test(bookParam) && Number(bookParam) > 0 ? Number(bookParam) : null
  const [lastOpenedId, setLastOpenedId] = useState(selectedId)
  if (selectedId !== null && selectedId !== lastOpenedId) setLastOpenedId(selectedId)
  const deskRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setOffset(0) }, 300)
    return () => window.clearTimeout(timer)
  }, [search])
  // A search looks through every place at once; each hit shows where it lives.
  const listScope: ListScope = query ? 'any' : scope
  const open = selectedId !== null
  useShortcutAction('focusSearch', useCallback(() => {
    if (open || !searchRef.current) return false
    searchRef.current.focus()
    searchRef.current.select()
  }, [open]))
  useEffect(() => {
    // Back returns focus to the opened row, or to the scope tab (search box while searching) when that row left the list.
    if (selectedId !== null || lastOpenedId === null) return
    const desk = deskRef.current
    ;(desk?.querySelector<HTMLElement>(`[data-book-id="${lastOpenedId}"]`)
      ?? desk?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?? searchRef.current)?.focus()
  }, [selectedId, lastOpenedId])
  const summary = useInboxSummary()
  const list = useQuery({
    queryKey: ['books', 'routing', listScope, query, sort, offset],
    queryFn: () => api.listBooks({ inbox: INBOX_BY_SCOPE[listScope], q: query || undefined, sort, limit: PAGE_SIZE, offset }),
    staleTime: 30_000,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === listScope ? keepPreviousData(previous) : undefined,
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
    setSearch('')
    setQuery('')
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('scope', value)
      next.delete('book')
      next.delete('view')
      return next
    }, { replace: true })
  }
  function updateInbox(id: number, inbox: BookInboxRead): void {
    const staysInScope = (value: unknown): boolean => value === 'outgoing' || value === 'any'
      || (value === 'archived' ? !!inbox.archived_at : !inbox.archived_at && (value === 'done' ? !!inbox.done_at : !inbox.done_at))
    const remaining = (list.data?.items ?? []).filter((row) => row.id !== id)
    if (selectedId === id && !staysInScope(listScope)) {
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
  const reader = !isMobile && view === 'reader' && open
  const unread = summary.data?.unread ?? 0
  const searching = listScope === 'any'

  return (
    <section ref={deskRef} dir={i18n.dir()} className="flex min-h-0 flex-1 flex-col bg-surface" aria-label={t('ledger.tabs.books')}>
      {/* Keep the list mounted while a book is open so Back restores search and scroll. */}
      <div hidden={open} className={cn('min-h-0 flex-1 flex-col', open ? 'hidden' : 'flex')}>
        <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 pb-3 sm:pb-0 lg:px-6">
          <Tabs value={searching ? '' : scope} onValueChange={selectScope} className="min-w-0 max-w-full">
            <TabsList className="gap-6 overflow-x-auto border-b-0">
              {SCOPES.map((value) => (
                <TabsTrigger key={value} value={value} className="gap-2">
                  <ScopeIcon scope={value} />
                  {scopeLabel(value)}
                  {value === 'incoming' && unread > 0 && (
                    <span className="font-mono text-xs font-semibold tabular-nums text-primary" aria-label={t('books.inbox.unread', { count: unread })}>{unread}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex w-full items-center gap-2 sm:ms-auto sm:w-auto sm:py-2">
            <div className="relative min-w-0 flex-1 sm:w-96 sm:flex-none">
              <label htmlFor="routing-search" className="sr-only">{t('ledger.booksDesk.searchLabel')}</label>
              <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                ref={searchRef}
                id="routing-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  // Esc clears first, then leaves the box; it never reaches page-level Esc handlers.
                  event.preventDefault()
                  event.stopPropagation()
                  if (search) setSearch('')
                  else event.currentTarget.blur()
                }}
                placeholder={t('ledger.booksDesk.search')}
                aria-keyshortcuts="Control+K"
                className="pe-16 ps-8 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => { setSearch(''); searchRef.current?.focus() }}
                  className="absolute inset-y-0 end-1 my-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t('ledger.booksDesk.clearSearch')}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : (
                <span className="pointer-events-none absolute inset-y-0 end-2 my-auto hidden h-fit text-xs text-muted-foreground sm:inline-flex" aria-hidden><Kbd>Ctrl K</Kbd></span>
              )}
            </div>
            <Select dir={i18n.dir()} value={sort} onValueChange={(value) => { setOffset(0); setSort(value) }}>
              <SelectTrigger className="w-auto shrink-0 gap-2" aria-label={t('ledger.booksDesk.sortLabel')}>
                <ArrowDownUp className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SORTS.map((value) => <SelectItem key={value} value={value}>{t(SORT_KEY[value])}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={list.isFetching}>
          {searching && list.data && (
            <p role="status" className="border-b border-hairline px-4 py-2 text-xs text-muted-foreground lg:px-6">{t('ledger.booksDesk.results', { count: list.data.total })}</p>
          )}
          {list.isPending ? <DeskLoading /> : list.isError ? (
            <div role="alert" className="px-4 py-8 text-sm text-destructive lg:px-6"><p>{apiErrorMessage(list.error)}</p><Button variant="outline" className="mt-3" onClick={() => void list.refetch()}>{t('ledger.booksDesk.retry')}</Button></div>
          ) : rows.length === 0 ? (
            <div className="max-w-prose px-4 py-10 text-sm lg:px-6">
              <h2 className="text-base font-semibold">{t(query ? 'ledger.booksDesk.noMatches' : `ledger.booksDesk.empty.${scope}`)}</h2>
              <p className="mt-2 text-muted-foreground">{t(query ? 'ledger.booksDesk.searchHint' : `ledger.booksDesk.emptyHint.${scope}`)}</p>
              {query && <Button variant="outline" className="mt-4" onClick={() => setSearch('')}>{t('ledger.booksDesk.clearSearch')}</Button>}
            </div>
          ) : (
            <ul className="divide-y divide-hairline" aria-label={searching ? t('ledger.booksDesk.searchLabel') : scopeLabel(scope)}>
              {rows.map((book) => (
                <li key={book.id}>
                  <BookRow book={book} asSent={!searching && scope === 'outgoing'} showScope={searching} current={book.id === lastOpenedId} onOpen={() => bookPage.open(String(book.id))} />
                </li>
              ))}
            </ul>
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

/**
 * One book on the desk: enough to decide before opening it. Line 1 is what it
 * is (subject, papers, urgency); the routing note follows; the meta line says
 * where it came from, who it went to and whose signature it carries. The end
 * column is when, plus my state (received) or the recipients' progress (sent).
 */
function BookRow({ book, asSent, showScope, current, onOpen }: {
  book: BookRead
  /** Outgoing tab: show my send even when I also received this book. */
  asSent: boolean
  showScope: boolean
  current: boolean
  onOpen: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const me = useAuth().user?.id
  const name = (en: string | null | undefined, ar: string | null | undefined): string => pickEmployeeName({ name_en: en ?? '', name_ar: ar }, i18n.language)
  const inbox = asSent ? null : book.my_inbox
  const place = scopeOf(book)
  const recipients = book.recipients ?? []
  // Received: my own row. Sent: the rows I sent (other forwards are not my send).
  const mine = inbox ? [] : recipients.filter((row) => row.sent_by_user_id === me)
  const purpose: SendPurpose | undefined = inbox?.purpose ?? mine[0]?.purpose
  const note = inbox ? inbox.note : mine.find((row) => row.note)?.note
  const sentAt = inbox?.sent_at ?? mine.at(-1)?.created_at ?? book.created_at
  const toRows: BookRecipientRead[] = inbox ? (recipients.length > 1 ? recipients : []) : mine
  const toNames = toRows.map((row) => row.user_id === me ? t('ledger.booksDesk.you') : name(row.user_name, row.user_name_ar))
  const listSep = i18n.language.startsWith('ar') ? '، ' : ', '
  const papers = paperCountOf(book, { inmateReporter: false })
  const category = book.category ? (i18n.language.startsWith('ar') ? book.category.name_ar : book.category.name_en) || book.category.name_en : null
  const signer = book.signer_name || book.signer_name_ar ? name(book.signer_name, book.signer_name_ar) : null
  const opened = mine.filter((row) => row.read_at).length
  const done = mine.filter((row) => row.done_at).length
  return (
    <button
      type="button"
      data-book-id={book.id}
      aria-current={current ? 'true' : undefined}
      onClick={onOpen}
      className={cn(
        // Mobile: purpose above the subject, date column beside both. lg: purpose gets its own scanning column.
        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-4 py-3 text-start text-sm transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:grid-cols-[7rem_minmax(0,1fr)_auto] lg:px-6',
        current && 'bg-primary-soft hover:bg-primary-soft',
      )}
    >
      <span className="col-start-1 row-start-1 empty:hidden lg:pt-px lg:empty:block">{purpose && <PurposeMark purpose={purpose} />}</span>
      <span className="col-start-1 row-start-2 min-w-0 lg:col-start-2 lg:row-start-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span dir="auto" className={cn('min-w-0 break-words', inbox && !inbox.read_at ? 'font-semibold' : 'font-medium')}>{book.subject || t('ledger.booksDesk.untitled')}</span>
          {papers > 1 && <PaperCount count={papers} />}
          {book.priority === 'High' && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-warning">
              <Flag className="h-3.5 w-3.5 rtl:-scale-x-100" strokeWidth={1.8} aria-hidden />{t('ledger.booksDesk.urgent')}
            </span>
          )}
        </span>
        {note && (
          <span className="mt-1 flex min-w-0 items-start gap-1.5 text-muted-foreground">
            <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" strokeWidth={1.8} aria-hidden />
            <span className="sr-only">{t('ledger.booksDesk.noteShort')}: </span>
            <bdi className="line-clamp-2 min-w-0 break-words">{note}</bdi>
          </span>
        )}
        <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {showScope && <span className="inline-flex items-center gap-1 font-medium text-foreground"><ScopeIcon scope={place} className="h-3.5 w-3.5" />{t(`ledger.booksDesk.${place}`)}</span>}
          <span title={book.ref_number}><span className="sr-only">{t('ledger.booksDesk.columns.ref')}: </span><bdi dir="ltr" className="font-mono tabular-nums">{book.ref_number}</bdi></span>
          {category && <bdi className="min-w-0 truncate">{category}</bdi>}
          {inbox
            ? <Meta label={t('ledger.booksDesk.from')}>{name(inbox.sent_by_name, inbox.sent_by_name_ar)}</Meta>
            : !toRows.length && <Meta label={t('ledger.booksDesk.columns.createdBy')}>{name(book.created_by_name, book.created_by_name_ar)}</Meta>}
          {toNames.length > 0 && (
            <Meta label={t('ledger.booksDesk.to')} title={toNames.join(listSep)}>
              {toNames.slice(0, 2).join(listSep)}
              {toNames.length > 2 && <bdi dir="ltr" className="ms-1 text-muted-foreground">{t('ledger.booksDesk.moreNames', { count: toNames.length - 2 })}</bdi>}
            </Meta>
          )}
          {signer && <Meta label={t('ledger.booksDesk.signer')}>{signer}</Meta>}
          <ConfidentialityMark level={book.confidentiality} />
        </span>
      </span>
      <span className="col-start-2 row-span-2 row-start-1 flex flex-col items-end gap-1.5 text-xs text-muted-foreground lg:col-start-3 lg:row-span-1">
        <span><span className="sr-only">{t(inbox || mine.length ? 'ledger.booksDesk.sent' : 'ledger.booksDesk.created')}: </span><BookDate value={sentAt} /></span>
        {inbox ? <InboxState inbox={inbox} /> : mine.length > 0 && (
          <span className="inline-flex items-center gap-3 font-mono tabular-nums">
            <span className="inline-flex items-center gap-1" title={t('ledger.booksDesk.openedOf', { count: opened, total: mine.length })}>
              <Eye className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden /><bdi dir="ltr" aria-hidden>{opened}/{mine.length}</bdi>
              <span className="sr-only">{t('ledger.booksDesk.openedOf', { count: opened, total: mine.length })}</span>
            </span>
            <span className={cn('inline-flex items-center gap-1', done === mine.length && 'text-success')} title={t('ledger.booksDesk.doneOf', { count: done, total: mine.length })}>
              <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden /><bdi dir="ltr" aria-hidden>{done}/{mine.length}</bdi>
              <span className="sr-only">{t('ledger.booksDesk.doneOf', { count: done, total: mine.length })}</span>
            </span>
          </span>
        )}
      </span>
    </button>
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
    { label: t('ledger.booksDesk.doneOn'), value: inbox.done_at ? <BookDate value={inbox.done_at} /> : t('ledger.booksDesk.notDone') },
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
          <ConfidentialityMark level={book.confidentiality} />
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
