/**
 * Records page (Book Reference).
 *
 * Desktop (≥ 768) — spine + register. The wrapper is a CSS container
 * (`@container/page`) and `useListTier` reads the same width for behaviour:
 *   drawer  < 64rem    full-width list; rail → Service chip; pane = end drawer
 *                      (× / Esc), nothing auto-selected
 *   icons   64–80rem   `w-14` icon rail + inline pane
 *   full    ≥ 80rem    15rem rail + inline pane
 * The inmate-reporter variant has no rail in any tier (the drawer still applies
 * below 64rem). Header · StatusSpine (All + approval states, counts from
 * /books/facets) · FormRail | day-grouped RecordsList | RecordPane.
 *
 * Mobile — BooksFilterBar + BooksMobileList.
 *
 * Both layouts scope the list fetch SERVER-side to the selected service
 * (`railScope`, see below) — desktop from the rail, mobile from the filter bar's
 * Service popover. Filtering a service client-side would silently truncate it to
 * whatever fell inside the 500-row window.
 *
 * Every open of a record from here (row, ref link, pane, Enter) goes through
 * `openRecord` with `{ from, queue, scrollY }`, so the record page can step
 * J/K through this list and Back returns here with the row selected.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronRight, Stamp, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import type { BookRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { copyToClipboard } from '@/lib/clipboard'
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
import { useLocalStorage } from '@/lib/useLocalStorage'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import { cn } from '@/lib/utils'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import {
  DEFAULT_BOOKS_FILTERS,
  hasActiveFilters,
  matchesBookFilters,
  matchesDesktopSearchRow,
  normalizeFilters,
  type BooksFilters,
} from './booksFiltersUtils'
import { booksFacetsKey, useMyRecordsCount } from './useMyRecordsCount'
import { StatusSpine, type SpineState } from './StatusSpine'
import { FormRail, MineChip, type RailItem } from './FormRail'
import { bookHeaderText, railItemsFrom, spineCountsFrom, useServiceLabel } from './serviceLabels'
import { BooksMobileList } from './BooksMobileList'
import { RecordsList } from './RecordsList'
import { FiltersPopover, ServicePopover } from './RecordsFilterPopovers'
import { RecordPane, type PaneSize } from './RecordPane'
import { deleteBlockReason } from './recordDelete'
import { useRecordDelete } from './RecordDeleteProvider'
import { openRecord, useListReturnFocus, type RecordNavState } from './useRecordNavContext'
import { useListTier } from './useListTier'
import { ScanBackEntry } from '@/pages/scanBack/ScanBackEntry'
import { ApiError } from '@/lib/api'
import { useInmateReportSubmit } from '@/components/books/useInmateReportSubmit'
import { serviceHref } from '@/lib/quickActions'
import { newRecordHref } from './newRecordHref'
import { useSearchParam } from '@/lib/urlState'

const PANE_SIZE_STORAGE_KEY = 'gssg.books.pane.size'

/** Pane column widths per size (the grid's third track; collapsed is a strip). */
const PANE_WIDTH: Record<PaneSize, string> = {
  collapsed: '52px',
  normal: 'clamp(22rem,34%,32rem)',
  wide: 'clamp(30rem,52%,56rem)',
}

export function BooksPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { has } = useCapabilities()
  const { user } = useAuth()
  const isInmateReporter = user?.role === 'inmate_reporter'
  const canDelete = has('books.delete')
  const canSubmit = has('books.submit')
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()
  const isDesktop = !isMobile
  const { scheduleDelete, pendingIds } = useRecordDelete()

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
  const clearAllFilters = (): void => setFilters({ ...DEFAULT_BOOKS_FILTERS })
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

  // ── Layout tier + pane state ────────────────────────────────────────────────
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null)
  const tier = useListTier(wrapEl)
  const inlinePane = isDesktop && (tier === 'icons' || tier === 'full')
  const drawerTier = isDesktop && tier === 'drawer'
  const [storedPaneSize, setPaneSize] = useLocalStorage<PaneSize>(PANE_SIZE_STORAGE_KEY, 'normal')
  const paneSize: PaneSize =
    storedPaneSize === 'collapsed' || storedPaneSize === 'wide' ? storedPaneSize : 'normal'
  const scrollerRef = useRef<HTMLDivElement | null>(null)

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
  // Multi-select for the bulk actions (Add to email / Delete), book ids.
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
  const { count: myRecordsCount } = useMyRecordsCount({ enabled: !isInmateReporter })

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
  // Rows whose delete is pending (6 s Undo window) are gone everywhere here —
  // desktop list, search results, pane pool and the rows handed to the phone list.
  const allRows: BookRead[] = useMemo(
    () => (listQuery.data?.items ?? []).filter((row) => !pendingIds.has(row.id)),
    [listQuery.data, pendingIds],
  )

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
  const searchItems: BookRead[] | undefined = useMemo(
    () => searchQuery.data?.items.filter((row) => !pendingIds.has(row.id)),
    [searchQuery.data, pendingIds],
  )

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
      document.querySelector(`[data-book-id="${target}"]`)?.scrollIntoView({ block: 'center' })
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

  // Newest first, always: the list is grouped by day, so rows must arrive sorted.
  const desktopRows: BookRead[] = useMemo(() => {
    // Category / direction / date come from the Filters popover (the phone's
    // BooksFilterBar writes the same URL params).
    const passesAdvanced = (row: BookRead): boolean => {
      if (filters.categoryIds.length > 0 && !filters.categoryIds.includes(row.category_id)) return false
      if (filters.direction !== 'all' && row.direction !== filters.direction) return false
      const day = row.created_at.slice(0, 10)
      if (filters.fromDate && day < filters.fromDate) return false
      if (filters.toDate && day > filters.toDate) return false
      return true
    }
    // When a debounced server search is active (>= 2 chars), use server results
    // (which carry search_snippet on body-hit rows) instead of client filtering.
    if (serverSearchActive && searchItems) {
      // The debounced search hits the server unscoped by service, so (unlike
      // the main list query below) this branch still needs a client guard.
      return searchItems
        .filter((row) => matchesDesktopSearchRow(row, { railService, showDrafts, spineState }) && passesAdvanced(row))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    }
    // The server already scoped allRows to railService (listQuery), so no
    // service filter is needed here.
    const q = search.trim().toLowerCase()
    const filtered = allRows.filter((row) => {
      if (!passesAdvanced(row)) return false
      if (showDrafts) return row.is_draft && !row.voided_at
      if (spineState !== 'all' && row.approval_state !== spineState) return false
      if (q && !`${row.ref_number} ${row.subject ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
    // Sort desc by created_at defensively — RecordsList groups *adjacent* dates,
    // so unsorted input would split a day into duplicate sections (key collision).
    // `filtered` is already a copy; never mutate allRows.
    return filtered.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [allRows, filters, spineState, railService, search, showDrafts, serverSearchActive, searchItems])
  const desktopRowIds = useMemo(() => desktopRows.map((row) => row.id), [desktopRows])

  const selectedBook = useMemo(() => {
    const pool = serverSearchActive && searchItems ? searchItems : allRows
    return pool.find((r) => r.id === selectedId) ?? allRows.find((r) => r.id === selectedId) ?? null
  }, [allRows, selectedId, serverSearchActive, searchItems])
  // Below 64rem the pane is a drawer, open while a record is selected.
  const drawerOpen = drawerTier && selectedBook !== null

  // ── Navigation: every open carries the list context ─────────────────────────
  const listUrl = `${location.pathname}${location.search}`
  const buildNav = useCallback(
    (): RecordNavState => ({
      from: listUrl,
      queue: desktopRowIds,
      scrollY: scrollerRef.current?.scrollTop ?? 0,
    }),
    [listUrl, desktopRowIds],
  )
  const openFromList = useCallback(
    (id: number): void => openRecord(navigate, id, buildNav()),
    [navigate, buildNav],
  )

  // Back from a record: restore the scroll, select the row (inline tiers) or
  // flash it (drawer tier — selecting would pop the drawer open).
  useListReturnFocus(scrollerRef, {
    isDesktop: inlinePane,
    ready: isDesktop && tier !== null && listQuery.isSuccess,
    onSelect: setSelectedId,
    onFlash: setHighlightedId,
  })
  const returnPending = typeof (location.state as { focusBookId?: unknown } | null)?.focusBookId === 'number'

  const closeDrawer = (): void => {
    const id = selectedId
    setOpenParam(null)
    // Focus returns to the row that opened the drawer.
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-book-id="${id}"] button`)?.focus()
    })
  }

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedForBasket((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // ── Bulk actions ─────────────────────────────────────────────────────────────
  // A checkbox can only be set on a row that's currently rendered (desktopRows),
  // which during an active search comes from searchItems, not allRows.
  const selectedRows = useMemo(() => {
    const pool = serverSearchActive && searchItems ? searchItems : allRows
    return [...selectedForBasket].flatMap((id) => {
      const row = pool.find((r) => r.id === id) ?? allRows.find((r) => r.id === id)
      return row ? [row] : []
    })
  }, [selectedForBasket, serverSearchActive, searchItems, allRows])
  // Signed / in-flight / Word-session rows are skipped, never deleted.
  const deletableRows = useMemo(
    () => selectedRows.filter((row) => deleteBlockReason(row, { has, isInmateReporter }) === null),
    [selectedRows, has, isInmateReporter],
  )
  const skippedCount = selectedRows.length - deletableRows.length
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // After rows are scheduled for deletion the selection moves to the nearest
  // surviving row (inline tiers) or the drawer closes.
  const moveSelectionAfterDelete = (removed: ReadonlySet<number>): void => {
    if (selectedId === null || !removed.has(selectedId)) return
    if (drawerTier) {
      setOpenParam(null)
      return
    }
    const at = desktopRows.findIndex((row) => row.id === selectedId)
    const remaining = desktopRows.filter((row) => !removed.has(row.id))
    const next = remaining[Math.min(Math.max(at, 0), remaining.length - 1)]
    setOpenParam(next ? String(next.id) : null)
  }

  const handleBulkDelete = (): void => {
    const removed = new Set(deletableRows.map((row) => row.id))
    scheduleDelete(deletableRows.map((row) => ({ id: row.id, ref: row.ref_number })))
    setSelectedForBasket(new Set())
    moveSelectionAfterDelete(removed)
  }

  const handleAddToEmail = useCallback(async () => {
    const results = await Promise.allSettled(selectedRows.map((row) => buildRecordBasketItem(row)))
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
  }, [selectedRows, t])

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

  // ── Keyboard: J/K move the selection, Enter opens, Ctrl+Enter opens in a new
  //    tab, C copies the ref, Esc closes the drawer ──────────────────────────────
  // Active only on the desktop list and, in the drawer tier, only while the
  // drawer is open (nothing is "selected" in the user's mind otherwise).
  const keysActive = isDesktop && tier !== null && desktopRows.length > 0 && (!drawerTier || drawerOpen)
  const stepSelection = (delta: 1 | -1): boolean => {
    if (!keysActive) return false
    const at = desktopRows.findIndex((row) => row.id === selectedId)
    const nextIndex = at === -1 ? (delta > 0 ? 0 : desktopRows.length - 1) : at + delta
    const next = desktopRows[Math.min(Math.max(nextIndex, 0), desktopRows.length - 1)]
    if (next.id !== selectedId) {
      setSelectedId(next.id)
      scrollerRef.current
        ?.querySelector(`[data-book-id="${next.id}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
    return true
  }
  useShortcutAction('recordNext', () => stepSelection(1))
  useShortcutAction('recordPrev', () => stepSelection(-1))
  useShortcutAction('recordOpen', () => {
    if (!keysActive || selectedBook === null) return false
    openFromList(selectedBook.id)
  })
  useShortcutAction('recordOpenNewTab', () => {
    // A focused row wins over the selection (Ctrl+Enter works from a Tab-focused row).
    const focusedRow = document.activeElement?.closest<HTMLElement>('[data-book-id]')
    const id = Number(focusedRow?.dataset.bookId) || selectedBook?.id
    if (!keysActive || !id) return false
    window.open(`/books/${id}`, '_blank', 'noopener')
  })
  useShortcutAction('copyRef', () => {
    if (!keysActive || selectedBook === null) return false
    const { ref_number: ref } = selectedBook
    void copyToClipboard(ref).then((ok) => {
      if (ok) toast.success(t('books.record.copiedRef', { ref: bidi(ref) }))
      else toast.error(t('common.copyFailed'))
    })
  })
  useShortcutAction('escape', () => {
    if (!drawerOpen) return false
    closeDrawer()
  })

  // Auto-select the first visible row when nothing is selected or the selected
  // row fell out of the current filter. An effect, not a render-time call: the
  // selection is a URL param, and navigating while rendering updates the router
  // mid-render (React's "Cannot update a component while rendering" error).
  // Inline tiers only: the drawer tier keeps the list full-width until a row is
  // chosen, and mobile never uses selectedId. A pending Back-restore selects its
  // own row, so it must not be pre-empted by the first row.
  const firstRowId = desktopRows[0]?.id ?? null
  const needsAutoSelect =
    inlinePane &&
    !returnPending &&
    !openParam &&
    firstRowId !== null &&
    (selectedId === null || !desktopRows.some((r) => r.id === selectedId))
  useEffect(() => {
    if (needsAutoSelect && firstRowId !== null) setOpenParam(String(firstRowId))
  }, [needsAutoSelect, firstRowId, setOpenParam])

  const mineToggle = isInmateReporter
    ? undefined
    : {
        pressed: mine,
        count: myRecordsCount,
        onToggle: () => setFilters({ ...filters, mine: !filters.mine }),
      }

  const listEmpty = hasFilters ? (
    <EmptyState
      icon={BookOpen}
      message={t('books.list.noMatch')}
      actionLabel={t('books.filters.clear')}
      onAction={clearAllFilters}
    />
  ) : (
    <EmptyState
      icon={BookOpen}
      message={t('books.emptyUnfiltered')}
      actionLabel={t('books.newRecord')}
      onAction={() =>
        navigate(newRecordHref(isInmateReporter))
      }
    />
  )

  const paneProps = {
    nav: buildNav,
    onSizeChange: setPaneSize,
    onContinueDraft: (id: number) => setPreviewBookId(id),
    onSubmit: submitBook,
    onSelectBook: (id: number) => setSelectedId(id),
    onAddToEmail: handleAddOneToEmail,
    onDeleted: (id: number) => moveSelectionAfterDelete(new Set([id])),
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      {isDesktop ? (
        /* ───── Desktop: spine + register + pane ───── */
        <div
          ref={setWrapEl}
          data-records-page
          data-tier={tier ?? undefined}
          className="@container/page flex min-h-0 flex-1 flex-col px-6 pb-5 pt-4"
        >
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
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface-tinted px-4 py-2 text-[0.85em] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
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
                className="rounded-full border border-hairline px-3 py-1 text-[0.75em] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
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
            style={{ '--pane-w': PANE_WIDTH[inlinePane ? paneSize : 'normal'] } as React.CSSProperties}
            className={cn(
              'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3',
              isInmateReporter
                ? '@5xl/page:grid-cols-[minmax(0,1fr)_var(--pane-w)]'
                : '@5xl/page:grid-cols-[3.5rem_minmax(0,1fr)_var(--pane-w)] @7xl/page:grid-cols-[15rem_minmax(0,1fr)_var(--pane-w)]',
            )}
          >
            {!isInmateReporter && (
              <div className="hidden min-h-0 @5xl/page:grid">
                {facetsQuery.isError ? (
                  <div className="rounded-2xl border border-hairline bg-surface py-8">
                    <EmptyState
                      icon={BookOpen}
                      message={t('common.loadError')}
                      actionLabel={t('common.retry')}
                      onAction={() => void facetsQuery.refetch()}
                    />
                  </div>
                ) : (
                  <FormRail
                    items={railItems}
                    active={railService}
                    onChange={setRailService}
                    tier={tier === 'icons' ? 'icons' : 'full'}
                    mine={mineToggle}
                  />
                )}
              </div>
            )}
            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline p-2.5">
                <Input
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t('books.pane.searchPlaceholder')}
                  className="h-8 min-w-[10rem] flex-1 rounded-full border-hairline bg-surface-raised text-[0.82em] pointer-coarse:h-11"
                  data-testid="records-search"
                />
                {/* Below 64rem there is no rail: its two jobs move into the toolbar. */}
                {!isInmateReporter && (
                  <span className="contents @5xl/page:hidden">
                    <ServicePopover items={railItems} active={railService} onChange={setRailService} />
                  </span>
                )}
                {!isInmateReporter && (
                  <FiltersPopover filters={filters} categories={categories} onChange={setFilters} />
                )}
                {mineToggle && (
                  <span className="contents @5xl/page:hidden">
                    <MineChip {...mineToggle} variant="chip" />
                  </span>
                )}
                {/* Drafts filter pill — shows only when there are drafts */}
                {draftBooks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowDrafts((v) => !v)}
                    aria-pressed={showDrafts}
                    className={cn(
                      'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.75em] font-semibold transition-colors motion-reduce:transition-none pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      showDrafts
                        ? 'border-warning/40 bg-warning-soft text-warning'
                        : 'border-hairline bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
                    )}
                  >
                    {t('books.filters.drafts')}
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/20 px-1 text-[0.85em] font-bold text-warning">
                      <bdi dir="ltr">{draftBooks.length}</bdi>
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
                              className="h-3.5 w-3.5 transition-transform motion-reduce:transition-none group-open:rotate-90 rtl:-scale-x-100"
                            />
                            {t('books.filters.drafts')} (<bdi dir="ltr">{draftBooks.length}</bdi>)
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
                              className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5"
                            >
                              <span className="font-mono text-[0.72em] font-bold text-primary">
                                <bdi dir="ltr">{draft.ref_number}</bdi>
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[0.75em] text-foreground">
                                {draft.subject ?? '—'}
                              </span>
                              <BookStatusChips book={draft} noClassification />
                              {!isInmateReporter && <WordSessionActions book={draft} labelled />}
                            </div>
                          ))}
                          {draftBooks.length > 3 && (
                            <button
                              type="button"
                              onClick={() => setShowDrafts(true)}
                              className="text-start text-[0.72em] text-muted-foreground underline hover:text-foreground"
                            >
                              +<bdi dir="ltr">{draftBooks.length - 3}</bdi> {t('books.filters.drafts')}
                            </button>
                          )}
                        </div>
                      </details>
                    </div>
                  )}
                  {!isInmateReporter && selectedForBasket.size > 0 && (
                    <div
                      role="region"
                      aria-label={t('books.list.selected', { count: selectedForBasket.size })}
                      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline bg-surface-raised px-3.5 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-xs text-foreground">
                          {t('books.list.selected', { count: selectedForBasket.size })}
                        </span>
                        {skippedCount > 0 && (
                          <small className="text-[0.7rem] text-muted-foreground">
                            {t('books.list.skippedMany', { count: skippedCount })}
                          </small>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleAddToEmail()}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 motion-reduce:transition-none pointer-coarse:min-h-11"
                      >
                        {t('basket.addN', { count: selectedForBasket.size })}
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          aria-disabled={deletableRows.length === 0 ? true : undefined}
                          onClick={() => {
                            if (deletableRows.length > 0) setConfirmDeleteOpen(true)
                          }}
                          className={cn(
                            'ms-auto inline-flex min-h-8 items-center gap-1.5 rounded-full border border-accent/40 px-3 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 motion-reduce:transition-none pointer-coarse:min-h-11',
                            deletableRows.length === 0 && 'opacity-50',
                          )}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          {t('books.list.deleteMany', { count: deletableRows.length })}
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
                    from={listUrl}
                    scrollerRef={scrollerRef}
                    empty={listEmpty}
                  />
                </>
              )}
            </section>
            {inlinePane && (
              <RecordPane
                {...paneProps}
                book={selectedBook}
                mode="inline"
                size={paneSize}
              />
            )}
          </div>
          {drawerOpen &&
            createPortal(
              <>
                <div
                  aria-hidden
                  className="fixed inset-0 z-40 bg-foreground/15"
                  onClick={closeDrawer}
                />
                <div
                  data-state="open"
                  className="drawer-end fixed inset-y-0 end-0 z-40 w-full max-w-[26rem] shadow-2xl"
                >
                  <RecordPane
                    {...paneProps}
                    book={selectedBook}
                    mode="drawer"
                    size="normal"
                    onClose={closeDrawer}
                  />
                </div>
              </>,
              document.body,
            )}
        </div>
      ) : (
        /* ───── Mobile: header + filter bar + card list ───── */
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
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface-tinted px-4 py-2 text-[0.85em] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
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
            onClearFilters={clearAllFilters}
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
          title={t('books.list.deleteMany', { count: deletableRows.length })}
          description={
            skippedCount > 0
              ? `${t('books.record.deleteBody')} ${t('books.list.skippedMany', { count: skippedCount })}`
              : t('books.record.deleteBody')
          }
          confirmLabel={t('books.bulk.delete')}
          onConfirm={handleBulkDelete}
          destructive
        />
      )}
    </div>
  )
}
