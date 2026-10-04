/**
 * Records page (Book Reference).
 *
 * Desktop — three-pane register (visual contract:
 * docs/prototypes/records-redesign-2026-06-10/final-records.html):
 *   Header (title · meta · "New entry" pill)
 *   StatusSpine (All + 5 approval states, counts from /books/facets — the active
 *     segment filters, and the counts scope to the selected service)
 *   FormRail (one entry per service) | day-grouped RecordsList | RecordPane
 *
 * Mobile — BooksFilterBar + BooksMobileList.
 *
 * Both layouts scope the list fetch SERVER-side to the selected service
 * (`railScope`, see below) — desktop from the rail, mobile from the filter bar's
 * Service popover. Filtering a service client-side would silently truncate it to
 * whatever fell inside the 500-row window.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, ChevronRight, Stamp, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import type { BookRead } from '@/lib/api'
import { addToBasket } from '@/lib/emailBasket'
import { buildRecordBasketItem } from './recordsBasket'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { SkeletonRow } from '@/components/ui/skeleton'
import { BooksFilterBar } from './BooksFilterBar'
import { SubmitForApprovalDialog } from '@/components/books/SubmitForApprovalDialog'
import { BookPreview } from '@/components/books/BookPreview'
import { BookStatusChips } from '@/components/books/BookStatusChips'
import { WordSessionActions } from '@/components/books/BookWordActions'
import { useIsMobile } from '@/lib/useIsMobile'
import { useCapabilities } from '@/lib/useCapabilities'
import { useAuth } from '@/lib/authContext'
import { cn } from '@/lib/utils'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import {
  hasActiveFilters,
  matchesBookFilters,
  matchesDesktopSearchRow,
  normalizeFilters,
  type BooksFilters,
} from './booksFiltersUtils'
import { booksFacetsKey, useMyRecordsCount } from './useMyRecordsCount'
import { StatusSpine, type SpineState } from './StatusSpine'
import { FormRail, type RailItem } from './FormRail'
import { bookHeaderText, railItemsFrom, spineCountsFrom, useServiceLabel } from './serviceLabels'
import { BooksMobileList } from './BooksMobileList'
import { RecordsList } from './RecordsList'
import { RecordPane } from './RecordPane'
import { ScanBackEntry } from '@/pages/scanBack/ScanBackEntry'
import { ApiError } from '@/lib/api'
import { useInmateReportSubmit } from '@/components/books/useInmateReportSubmit'
import { serviceHref } from '@/lib/quickActions'
import { useSearchParam } from '@/lib/urlState'

export function BooksPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const { user } = useAuth()
  const isInmateReporter = user?.role === 'inmate_reporter'
  const canDelete = has('books.delete')
  const canSubmit = has('books.submit')
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const isDesktop = !isMobile

  // Every filter is URL-backed (replace), so they survive a remount, a reload
  // and a Back from a record.
  const [searchParams, setSearchParams] = useSearchParams()
  const [statusParam, setStatusParam] = useSearchParam('status', { fallback: 'all' })
  const [serviceParam, setServiceParam] = useSearchParam('service', { fallback: 'all' })
  const [searchParam, setSearchParam] = useSearchParam('q')
  const [draftsParam, setDraftsParam] = useSearchParam('drafts')
  const [categoriesParam] = useSearchParam('categories')
  const [directionParam] = useSearchParam('direction', { fallback: 'all' })
  const [fromParam] = useSearchParam('from')
  const [toParam] = useSearchParam('to')
  const [mineParam] = useSearchParam('mine')
  const [openParam, setOpenParam] = useSearchParam('open')
  const status = (statusParam === 'draft' ? 'none' : statusParam) as BooksFilters['status']
  // "Created by me" is hidden for inmate reporters, so the param is ignored.
  const mine = mineParam === '1' && !isInmateReporter
  const filters = useMemo(
    () => normalizeFilters({
      categoryIds: categoriesParam ? categoriesParam.split(',').filter(Boolean) : [],
      direction:
        directionParam === 'incoming' || directionParam === 'outgoing' ? directionParam : 'all',
      fromDate: fromParam,
      toDate: toParam,
      status,
      serviceId: serviceParam,
      q: searchParam,
      drafts: draftsParam === '1',
      mine,
    }),
    [categoriesParam, directionParam, fromParam, toParam, status, serviceParam, searchParam, draftsParam, mine],
  )
  const setFilters = (next: BooksFilters | ((prev: BooksFilters) => BooksFilters)): void => {
    const value = typeof next === 'function' ? next(filters) : next
    const params = new URLSearchParams(searchParams)
    const update = (key: string, value: string, fallback: string): void => {
      if (value === fallback) params.delete(key)
      else params.set(key, value)
    }
    update('status', value.status, 'all')
    update('service', value.serviceId, 'all')
    update('q', value.q, '')
    update('drafts', value.drafts ? '1' : '', '')
    update('categories', value.categoryIds.join(','), '')
    update('direction', value.direction, 'all')
    update('from', value.fromDate, '')
    update('to', value.toDate, '')
    update('mine', value.mine ? '1' : '', '')
    setSearchParams(params, { replace: true })
  }
  const [submitBookId, setSubmitBookId] = useState<number | null>(null)
  const [previewBookId, setPreviewBookId] = useState<number | null>(null)
  const reporterSubmitMutation = useInmateReportSubmit({
    onSuccess: () => toast.success(t('books.approval.submitted')),
    onError: (err, message, bookId) => {
      if (err instanceof ApiError && err.code === 'INMATE_REPORT_INCOMPLETE') {
        toast.error(message, {
          action: {
            label: t('books.pane.continueDraft'),
            onClick: () =>
              navigate(`${serviceHref('Inmate Conduct Violations')}?revise=${bookId}`),
          },
        })
      } else {
        toast.error(message)
      }
    },
  })
  const submitBook = (bookId: number): void => {
    if (isInmateReporter) reporterSubmitMutation.mutate(bookId)
    else setSubmitBookId(bookId)
  }

  // ── Desktop pane state (filters and master-detail selection live in URL) ───
  const spineState = status
  const setSpineState = (value: SpineState): void => setStatusParam(value)
  const railService = serviceParam
  const setRailService = (value: string): void => setServiceParam(value)
  const search = searchParam
  const showDrafts = draftsParam === '1'
  const setShowDrafts = (value: boolean | ((prev: boolean) => boolean)): void => {
    const next = typeof value === 'function' ? value(showDrafts) : value
    setDraftsParam(next ? '1' : null)
  }
  const selectedId = Number.parseInt(openParam, 10) || null
  const setSelectedId = (value: number): void => setOpenParam(String(value))
  // Multi-select for "Add to email" bulk action (book ids).
  const [selectedForBasket, setSelectedForBasket] = useState<Set<number>>(new Set())
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  // Rail + spine numbers over EVERY record — the 500-row page window is why
  // these used to disagree with the page's own total.
  // Page facets follow the "Created by me" toggle; the badge count below is a
  // separate always-on query (same key as this one while the toggle is on).
  const facetsQuery = useQuery({
    queryKey: booksFacetsKey(mine),
    queryFn: () => api.getBookFacets(mine ? { created_by_me: true } : {}),
  })
  useMyRecordsCount({ enabled: !isInmateReporter })

  // ── Data: one server-scoped fetch; both branches filter client-side ────────
  // `railService` (the desktop rail's own selection) is a desktop-only concept
  // — it must never leak into mobile, so a desktop→mobile resize with a rail
  // service selected can't leave the mobile list silently filtered with no
  // indicator that a filter is active. Mobile instead scopes on
  // `filters.serviceId`, the operator's own visible choice in the mobile
  // Service popover (its trigger shows the selected label), so the scoping is
  // never silent. Without this, mobile filtered client-side over an unscoped
  // 500-row window, undercounting services with more rows further back in the
  // table (e.g. Leave Application Form: 276 true vs 230 visible).
  const railScope = isDesktop ? railService : filters.serviceId
  const listQuery = useQuery({
    queryKey: ['books', 'all', railScope, mine],
    queryFn: () =>
      api.listBooks({
        limit: 500,
        ...(railScope === 'all' ? {} : { service_id: railScope }),
        ...(mine ? { created_by_me: true } : {}),
      }),
  })
  const allRows: BookRead[] = useMemo(() => listQuery.data?.items ?? [], [listQuery.data])

  // ── Debounced server search (desktop, >= 2 chars) ───────────────────────────
  // Mirror BooksFilterBar's 300 ms debounce. When active, desktopRows comes
  // from the server query (which carries search_snippet) instead of allRows.
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const handleSearchChange = useCallback((val: string) => {
    setSearchParam(val || null)
  }, [setSearchParam])
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 300)
    return () => window.clearTimeout(handle)
  }, [search])
  const serverSearchActive = debouncedSearch.trim().length >= 2
  const searchQuery = useQuery({
    queryKey: ['books', 'search', debouncedSearch, mine],
    queryFn: () =>
      api.listBooks({ q: debouncedSearch, limit: 500, ...(mine ? { created_by_me: true } : {}) }),
    enabled: serverSearchActive,
    staleTime: 30_000,
  })

  const categoriesQuery = useQuery({
    queryKey: ['book-categories'],
    queryFn: () => api.listBookCategories(),
    staleTime: Infinity,
  })
  const categories = categoriesQuery.data ?? []

  // A `?open=<id>` the page was loaded with (deep link, refresh): on desktop
  // flash + scroll to the row once; on mobile, or when the row is outside the
  // fetched window, open the full record page in place of this entry. Later
  // in-page selections only update `open`, so they never re-trigger this.
  const deepLinkOpenRef = useRef<number | null>(Number.parseInt(openParam, 10) || null)
  useEffect(() => {
    const target = deepLinkOpenRef.current
    if (target === null) return
    if (isDesktop && !listQuery.isSuccess) return
    deepLinkOpenRef.current = null
    if (!isDesktop || !allRows.some((row) => row.id === target)) {
      navigate(`/books/${target}`, { replace: true })
      return
    }
    setHighlightedId(target)
    window.setTimeout(() => {
      document.querySelector(`[data-id="${target}"]`)?.scrollIntoView({ block: 'center' })
    }, 100)
  }, [isDesktop, listQuery.isSuccess, allRows, navigate])
  // Auto-clear the highlight after a brief flash so re-navigating to the same
  // row again still produces a visible cue.
  useEffect(() => {
    if (highlightedId === null) return
    const handle = window.setTimeout(() => setHighlightedId(null), 1800)
    return () => window.clearTimeout(handle)
  }, [highlightedId])

  // ── Mobile: client-side filtering with the old server-side predicates ──────

  // Predicate lives in booksFiltersUtils.ts (single source of truth, unit-tested
  // directly) so this ordering can't drift out of sync with the desktop paths again.
  const mobileRows: BookRead[] = useMemo(
    () => allRows.filter((row) => matchesBookFilters(row, filters)),
    [allRows, filters],
  )

  // Mobile open routing: full-screen record page (`/books/:id`) in any state.
  const openBook = useCallback(
    (row: BookRead): void => {
      navigate(`/books/${row.id}`)
    },
    [navigate],
  )

  const hasFilters = hasActiveFilters(filters)

  // Header-line counts. Sourced from facets (global), not listQuery (now
  // service-scoped) — this must agree with the rail's "All" count.
  const total = facetsQuery.data?.total ?? 0
  // One status object both the desktop and mobile headers pass through
  // bookHeaderText — a single decision they can't diverge on (that's how the
  // mobile header missed the facets-error case: two hand-copied ternaries).
  const headerStatus = {
    listPending: listQuery.isPending,
    facetsPending: facetsQuery.isPending,
    facetsError: facetsQuery.isError,
    total,
  }

  // ── Desktop facets ──────────────────────────────────────────────────────────
  const serviceLabel = useServiceLabel()

  const spineCounts = useMemo<Record<SpineState, number>>(
    () => spineCountsFrom(facetsQuery.data, railService),
    [facetsQuery.data, railService],
  )

  const railItems = useMemo<RailItem[]>(
    () => railItemsFrom(facetsQuery.data, t('books.formKind.all'), serviceLabel),
    [facetsQuery.data, serviceLabel, t],
  )

  // Draft books (is_draft && !voided_at) — shown in the group card above the list
  const draftBooks: BookRead[] = useMemo(
    () => allRows.filter((r) => r.is_draft && !r.voided_at),
    [allRows],
  )

  const desktopRows: BookRead[] = useMemo(() => {
    // When a debounced server search is active (>= 2 chars), use server results
    // (which carry search_snippet on body-hit rows) instead of client filtering.
    if (serverSearchActive && searchQuery.data) {
      const serverRows = searchQuery.data.items
      // The debounced search hits the server unscoped by service, so (unlike
      // the main list query below) this branch still needs a client guard.
      return serverRows
        .filter((row) => matchesDesktopSearchRow(row, { railService, showDrafts, spineState }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    }
    // The server already scoped allRows to railService (listQuery), so no
    // service filter is needed here.
    const q = search.trim().toLowerCase()
    const filtered = allRows.filter((row) => {
      if (showDrafts) return row.is_draft && !row.voided_at
      if (spineState !== 'all' && row.approval_state !== spineState) return false
      if (q && !`${row.ref_number} ${row.subject ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
    // Sort desc by created_at defensively — RecordsList groups *adjacent* dates,
    // so unsorted input would split a day into duplicate sections (key collision).
    // `filtered` is already a copy; never mutate allRows.
    return filtered.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [allRows, spineState, railService, search, showDrafts, serverSearchActive, searchQuery.data])

  const selectedBook = useMemo(() => {
    const pool = serverSearchActive && searchQuery.data ? searchQuery.data.items : allRows
    return pool.find((r) => r.id === selectedId) ?? allRows.find((r) => r.id === selectedId) ?? null
  }, [allRows, selectedId, serverSearchActive, searchQuery.data])

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedForBasket((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Bulk soft-delete of the checkbox selection. Uses the same DELETE /books/{id}
  // endpoint as a single delete (sets deleted_at; ref numbers are not reused).
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const deleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.allSettled(ids.map((id) => api.deleteBook(id)))
      const failed = results.filter((r) => r.status === 'rejected').length
      return { total: ids.length, failed }
    },
    onSuccess: ({ total, failed }) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      setSelectedForBasket(new Set())
      const removed = total - failed
      if (removed > 0) toast.success(t('books.bulk.deleted', { count: removed }))
      if (failed > 0) toast.error(t('books.bulk.deleteError', { count: failed }))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const handleAddToEmail = useCallback(async () => {
    const ids = [...selectedForBasket]
    // Same pool-then-fallback as selectedBook: a checkbox can only be set on a
    // row that's currently rendered (desktopRows), which during an active
    // search comes from searchQuery.data, not allRows.
    const pool = serverSearchActive && searchQuery.data ? searchQuery.data.items : allRows
    const results = await Promise.allSettled(
      ids.map((id) => {
        const book = pool.find((r) => r.id === id) ?? allRows.find((r) => r.id === id)
        return book ? buildRecordBasketItem(book) : Promise.resolve(null)
      }),
    )
    let added = 0
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        if (addToBasket(r.value).added) added += 1
      }
    }
    setSelectedForBasket(new Set())
    if (added > 0) {
      toast.success(t('basket.tray.added', { kind: t('basket.add') }))
    } else {
      toast(t('basket.tray.alreadyIn', { kind: t('basket.add') }))
    }
  }, [selectedForBasket, allRows, serverSearchActive, searchQuery.data, t])

  // Single-record "Add to email" from the record pane (same enrichment as the
  // bulk multi-select; toasts added / already-in / not-found).
  const handleAddOneToEmail = useCallback(
    async (book: BookRead) => {
      const item = await buildRecordBasketItem(book)
      if (!item) {
        toast.error(t('basket.addError'))
        return
      }
      if (addToBasket(item).added) {
        toast.success(t('basket.tray.added', { kind: t('basket.add') }))
      } else {
        toast(t('basket.tray.alreadyIn', { kind: t('basket.add') }))
      }
    },
    [t],
  )

  // Auto-select the first visible row when nothing is selected or the selected
  // row fell out of the current filter. Render-time adjust (not an effect) —
  // converges in one extra render and avoids a flash of the empty pane.
  // Gated on isDesktop: mobile never uses selectedId so this is a no-op there,
  // but the redundant setState still wastes a render cycle on every mobile paint.
  if (
    isDesktop &&
    !openParam &&
    desktopRows.length > 0 &&
    (selectedId === null || !desktopRows.some((r) => r.id === selectedId))
  ) {
    setOpenParam(String(desktopRows[0].id))
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      {isDesktop ? (
        /* ───── Desktop: spine + three panes ───── */
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-4">
          <header className="mb-3 flex shrink-0 items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[1.45em] font-bold tracking-tight text-foreground">{t('books.title')}</h1>
              <div className="mt-0.5 text-[0.8em] text-muted-foreground">
                {bookHeaderText(headerStatus, t)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <RefreshButton />
              {!isInmateReporter && (
                <button
                  type="button"
                  onClick={() => navigate('/books/approvals')}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface-tinted px-4 py-2 text-[0.85em] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  <Stamp className="h-3.5 w-3.5" strokeWidth={2} />
                  {t('books.approvals.title')}
                </button>
              )}
            </div>
          </header>
          {!isInmateReporter && <ScanBackEntry />}
          {facetsQuery.isError ? (
            // A failed facets fetch must never render as an honest "0" — the spine's
            // whole reason to exist is to be a number the operator can trust. Show a
            // retry affordance in its place, matching the list pane's error pattern.
            <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface px-3.5 py-2.5">
              <span className="text-[0.8em] text-muted-foreground">{t('common.loadError')}</span>
              <button
                type="button"
                onClick={() => void facetsQuery.refetch()}
                className="rounded-full border border-hairline px-3 py-1 text-[0.75em] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <StatusSpine
              counts={spineCounts}
              active={spineState}
              onChange={setSpineState}
              showAwaitingScan={!isInmateReporter}
            />
          )}
          <div
            className={cn(
              'grid min-h-0 flex-1 gap-3',
              isInmateReporter
                ? 'grid-cols-[minmax(0,1fr)_clamp(360px,36%,480px)]'
                : 'grid-cols-[15rem_minmax(0,1fr)_clamp(360px,36%,480px)]',
            )}
          >
            {!isInmateReporter &&
              (facetsQuery.isError ? (
                <div className="rounded-2xl border border-hairline bg-surface py-8">
                  <EmptyState
                    icon={BookOpen}
                    message={t('common.loadError')}
                    actionLabel={t('common.retry')}
                    onAction={() => void facetsQuery.refetch()}
                  />
                </div>
              ) : (
                <FormRail items={railItems} active={railService} onChange={setRailService} />
              ))}
            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
              <div className="flex shrink-0 items-center gap-2 border-b border-hairline p-2.5">
                <Input
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t('books.pane.searchPlaceholder')}
                  className="h-8 min-w-0 flex-1 rounded-full border-hairline bg-surface-raised text-[0.82em]"
                  data-testid="records-search"
                />
                {/* Drafts filter pill — shows only when there are drafts */}
                {draftBooks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowDrafts((v) => !v)}
                    aria-pressed={showDrafts}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.75em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      showDrafts
                        ? 'border-warning/40 bg-warning-soft text-warning'
                        : 'border-hairline bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
                    )}
                  >
                    {t('books.filters.drafts')}
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/20 px-1 text-[0.85em] font-bold text-warning">
                      {draftBooks.length}
                    </span>
                  </button>
                )}
              </div>
              {listQuery.isPending ? (
                <div className="flex flex-col">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <SkeletonRow key={i} cols={4} />
                  ))}
                </div>
              ) : listQuery.isError ? (
                <div className="py-12">
                  <EmptyState
                    icon={BookOpen}
                    message={t('common.loadError')}
                    actionLabel={t('common.retry')}
                    onAction={() => void listQuery.refetch()}
                  />
                </div>
              ) : (
                <>
                  {/* Drafts group card — dashed border, raised bg, above the list */}
                  {draftBooks.length > 0 && !showDrafts && (
                    <div className="shrink-0 border-b border-hairline bg-surface-raised px-3 py-2.5">
                      <details className="group rounded-xl border border-dashed border-warning/50 bg-warning-soft/30 p-3">
                        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm">
                          <span className="flex items-center gap-1.5 text-[0.75em] font-bold uppercase tracking-[0.07em] text-warning">
                            <ChevronRight
                              aria-hidden
                              className="h-3.5 w-3.5 transition-transform group-open:rotate-90 rtl:-scale-x-100"
                            />
                            {t('books.filters.drafts')} ({draftBooks.length})
                          </span>
                        </summary>
                        <div className="mt-2 flex flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowDrafts(true)}
                            className="self-end text-[0.72em] text-muted-foreground underline hover:text-foreground"
                          >
                            {t('books.filters.drafts')}
                          </button>
                          {draftBooks.slice(0, 3).map((draft) => (
                            <div
                              key={draft.id}
                              className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5"
                            >
                              <span className="font-mono text-[0.72em] font-bold text-primary">
                                <bdi dir="ltr">{draft.ref_number}</bdi>
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[0.75em] text-foreground">
                                {draft.subject ?? '—'}
                              </span>
                              <BookStatusChips book={draft} noClassification />
                              {!isInmateReporter && <WordSessionActions book={draft} />}
                            </div>
                          ))}
                          {draftBooks.length > 3 && (
                            <button
                              type="button"
                              onClick={() => setShowDrafts(true)}
                              className="text-start text-[0.72em] text-muted-foreground underline hover:text-foreground"
                            >
                              +{draftBooks.length - 3} {t('books.filters.drafts')}
                            </button>
                          )}
                        </div>
                      </details>
                    </div>
                  )}
                  {!isInmateReporter && selectedForBasket.size > 0 && (
                    <div className="flex shrink-0 items-center gap-3 border-b border-hairline bg-surface-raised px-3.5 py-2">
                      <span className="text-xs text-muted-foreground">
                        {t('basket.tray.count', { count: selectedForBasket.size })}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleAddToEmail()}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                      >
                        {t('basket.addN', { count: selectedForBasket.size })}
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteOpen(true)}
                          disabled={deleteMutation.isPending}
                          className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-3 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                          {t('books.bulk.delete')}
                        </button>
                      )}
                    </div>
                  )}
                  <RecordsList
                    rows={desktopRows}
                    selectedId={selectedId}
                    highlightedId={highlightedId}
                    onSelect={setSelectedId}
                    selected={isInmateReporter ? undefined : selectedForBasket}
                    onToggleSelect={isInmateReporter ? undefined : handleToggleSelect}
                  />
                </>
              )}
            </section>
            <RecordPane
              book={selectedBook}
              onOpenRecord={(id) => navigate(`/books/${id}`)}
              onContinueDraft={(id) => setPreviewBookId(id)}
              onSubmit={submitBook}
              onSelectBook={(id) => setSelectedId(id)}
              onAddToEmail={handleAddOneToEmail}
            />
          </div>
        </div>
      ) : (
        /* ───── Mobile: header + filter bar + card list (unchanged) ───── */
        <>
          <header className="px-6 pb-3 pt-5">
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {t('books.eyebrow', { defaultValue: t('employees.eyebrow') })}
                </div>
                <h1 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
                  {t('books.title')}
                </h1>
                <div className="mt-1 text-[0.86em] text-muted-foreground">
                  {bookHeaderText(headerStatus, t)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <RefreshButton />
                {!isInmateReporter && (
                  <button
                    type="button"
                    onClick={() => navigate('/books/approvals')}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface-tinted px-4 py-2 text-[0.85em] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <Stamp className="h-3.5 w-3.5" strokeWidth={2} />
                    {t('books.approvals.title')}
                  </button>
                )}
              </div>
            </div>
          </header>

          {!isInmateReporter && (
            <div className="px-6">
              <ScanBackEntry />
            </div>
          )}

          <div className="px-6 pb-2">
            {isInmateReporter ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface px-3 py-2">
                <Input
                  value={filters.q}
                  onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                  placeholder={t('books.pane.searchPlaceholder')}
                  className="h-8 min-w-0 flex-1 rounded-full border-hairline bg-surface-raised text-[0.82em]"
                />
                <select
                  value={filters.status}
                  onChange={(e) =>
                    setFilters({ ...filters, status: e.target.value as BooksFilters['status'] })
                  }
                  aria-label={t('books.filters.status')}
                  className="h-8 rounded-full border border-hairline bg-surface-tinted px-3 text-[0.78em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="all">{t('books.filters.statusAll')}</option>
                  <option value="none">{t('books.approval.stateDraft')}</option>
                  <option value="pending">{t('books.approval.statePending')}</option>
                  <option value="approved">{t('books.approval.stateApproved')}</option>
                  <option value="returned">{t('books.approval.stateReturned')}</option>
                  <option value="rejected">{t('books.approval.stateRejected')}</option>
                </select>
              </div>
            ) : (
              <BooksFilterBar
                filters={filters}
                categories={categories}
                services={facetsQuery.data?.services ?? []}
                onChange={setFilters}
              />
            )}
          </div>

          <BooksMobileList
            isPending={listQuery.isPending}
            isError={listQuery.isError}
            onRetry={() => void listQuery.refetch()}
            rows={mobileRows}
            hasFilters={hasFilters}
            isAr={isAr}
            isInmateReporter={isInmateReporter}
            canSubmit={canSubmit}
            userId={user?.id}
            highlightedId={highlightedId}
            onSubmit={submitBook}
            onOpen={openBook}
          />
        </>
      )}

      {!isInmateReporter && submitBookId !== null && (
        <SubmitForApprovalDialog
          bookId={submitBookId}
          onClose={() => setSubmitBookId(null)}
        />
      )}

      <BookPreview
        bookId={previewBookId}
        onClose={() => setPreviewBookId(null)}
        onSubmitForApproval={(id) => {
          setPreviewBookId(null)
          submitBook(id)
        }}
      />

      {!isInmateReporter && (
        <ConfirmDialog
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
          title={t('books.bulk.deleteTitle', { count: selectedForBasket.size })}
          description={t('books.bulk.deleteBody')}
          confirmLabel={t('books.bulk.delete')}
          onConfirm={() => deleteMutation.mutate([...selectedForBasket])}
          destructive
        />
      )}
    </div>
  )
}

