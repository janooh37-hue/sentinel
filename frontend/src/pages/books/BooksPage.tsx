/**
 * Records page (Book Reference).
 *
 * Desktop — three-pane register (visual contract:
 * docs/prototypes/records-redesign-2026-06-10/final-records.html):
 *   Header (title · meta · "New entry" pill)
 *   StatusSpine (All + 5 approval states, live counts — the active segment filters)
 *   FormRail (form kinds) | day-grouped RecordsList | RecordPane (papers + actions)
 *
 * Mobile — unchanged: BooksFilterBar + BookMobileCard list, now filtered
 * client-side over the single unfiltered fetch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, BookOpen, Plus, Send, Trash2 } from 'lucide-react'
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
import { BooksFilterBar, type BooksFilters } from './BooksFilterBar'
import { NewBookDialog } from './NewBookDialog'
import { SubmitForApprovalDialog } from '@/components/books/SubmitForApprovalDialog'
import { BookPreview } from '@/components/books/BookPreview'
import { BookStatusChips } from '@/components/books/BookStatusChips'
import { BookWordActions } from '@/components/books/BookWordActions'
import type { BookCreate } from '@/lib/api'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import { useIsMobile } from '@/lib/useIsMobile'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { PullToRefresh } from '@/components/refresh/PullToRefresh'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import { DEFAULT_BOOKS_FILTERS, normalizeFilters } from './booksFiltersUtils'
import { sealDescriptor, signedSourceOf } from './bookStateLabel'
import { StatusSpine, type SpineState } from './StatusSpine'
import { FormRail, type RailItem } from './FormRail'
import { RecordsList } from './RecordsList'
import { RecordPane } from './RecordPane'
import { FORM_KINDS, OTHER_KIND, formKindOf, type FormKind } from './formKind'

const DEFAULT_FILTERS = DEFAULT_BOOKS_FILTERS

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

export function BooksPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const canManage = has('books.manage')
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const isDesktop = !isMobile

  // ── Mobile filter state (in-memory so leaving the page resets it) ──────────
  const [rawFilters, setRawFilters] = useState<BooksFilters>(DEFAULT_FILTERS)
  // Merge stored value over defaults so newly-added fields are never undefined
  // even when a user's persisted object predates the field being added.
  const filters = useMemo(() => normalizeFilters(rawFilters), [rawFilters])
  const setFilters = (next: BooksFilters | ((prev: BooksFilters) => BooksFilters)): void => {
    setRawFilters(typeof next === 'function' ? (prev) => next(normalizeFilters(prev)) : next)
  }
  const [newBookOpen, setNewBookOpen] = useState(false)
  const [submitBookId, setSubmitBookId] = useState<number | null>(null)
  const [previewBookId, setPreviewBookId] = useState<number | null>(null)

  // ── Desktop pane state ──────────────────────────────────────────────────────
  const [spineState, setSpineState] = useState<SpineState>('all')
  const [railKind, setRailKind] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [showDrafts, setShowDrafts] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Multi-select for "Add to email" bulk action (book ids).
  const [selectedForBasket, setSelectedForBasket] = useState<Set<number>>(new Set())
  // Deep-link target waiting for data to load before resolving (desktop only).
  // Once listQuery.isSuccess the effect below either selects+highlights the row
  // or falls back to the full-screen record page (id not in the 500-row window).
  const [pendingOpenId, setPendingOpenId] = useState<number | null>(null)

  // ── Data: one unfiltered fetch; both branches filter client-side ───────────
  const listQuery = useQuery({
    queryKey: ['books', 'all'],
    queryFn: () => api.listBooks({ limit: 500 }),
  })
  const allRows: BookRead[] = useMemo(() => listQuery.data?.items ?? [], [listQuery.data])

  // ── Debounced server search (desktop, >= 2 chars) ───────────────────────────
  // Mirror BooksFilterBar's 300 ms debounce. When active, desktopRows comes
  // from the server query (which carries search_snippet) instead of allRows.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300)
  }, [])
  const serverSearchActive = debouncedSearch.trim().length >= 2
  const searchQuery = useQuery({
    queryKey: ['books', 'search', debouncedSearch],
    queryFn: () => api.listBooks({ q: debouncedSearch, limit: 500 }),
    enabled: serverSearchActive,
    staleTime: 30_000,
  })

  const categoriesQuery = useQuery({
    queryKey: ['book-categories'],
    queryFn: () => api.listBookCategories(),
    staleTime: Infinity,
  })
  const categories = categoriesQuery.data ?? []

  // Deep-link: `?open=<id>` from the dashboard arrives here when the operator
  // clicks a recent document row. The ledger book-chip uses a localStorage
  // handoff (`gssg.books.openId`) instead — the smart-link resolves a ref to a
  // book id, stashes it, then navigates here. On desktop the target row is
  // selected (RecordPane shows it) + briefly highlighted; on mobile we open the
  // full-screen record page. `?status=` pre-filters (spine on desktop, filter
  // bar on mobile).
  const [searchParams, setSearchParams] = useSearchParams()
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  // One-shot URL → state sync (the params are consumed + deleted), so setState
  // here is the point of the effect, not a cascading-render hazard.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const statusParam = searchParams.get('status')
    if (statusParam) {
      const mapped = statusParam === 'draft' ? 'none' : statusParam
      const allowed = ['all', 'none', 'pending', 'approved', 'returned', 'rejected']
      if (allowed.includes(mapped)) {
        setSpineState(mapped as SpineState)
        setFilters((f) => ({ ...f, status: mapped as BooksFilters['status'] }))
      }
      setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('status'); return n }, { replace: true })
    }

    let target: number | null = null
    const openParam = searchParams.get('open')
    if (openParam) {
      const parsed = Number.parseInt(openParam, 10)
      if (Number.isFinite(parsed)) target = parsed
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('open')
          return next
        },
        { replace: true },
      )
    }
    if (target === null) {
      try {
        const pending = window.localStorage.getItem('gssg.books.openId')
        if (pending) {
          window.localStorage.removeItem('gssg.books.openId')
          const parsed = Number.parseInt(pending, 10)
          if (Number.isFinite(parsed)) target = parsed
        }
      } catch {
        // ignore storage failures (private mode, quota)
      }
    }
    if (target !== null) {
      if (!isDesktop) {
        navigate(`/books/${target}`)
      } else {
        // Defer resolution until data is loaded — the pending-id effect below
        // either selects+highlights (row found) or falls back to /books/:id.
        setPendingOpenId(target)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  /* eslint-enable react-hooks/set-state-in-effect */
  // Auto-clear the highlight after a brief flash so re-navigating to the same
  // row again still produces a visible cue.
  useEffect(() => {
    if (highlightedId === null) return
    const handle = window.setTimeout(() => setHighlightedId(null), 1800)
    return () => window.clearTimeout(handle)
  }, [highlightedId])

  // Resolve a pending deep-link once data has loaded. If the target id is in
  // the fetched window select + highlight it; otherwise fall back to the
  // full-screen record page (deleted record, or beyond the 500-row cap).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (pendingOpenId === null || !listQuery.isSuccess) return
    const found = allRows.some((r) => r.id === pendingOpenId)
    if (found) {
      setSelectedId(pendingOpenId)
      setHighlightedId(pendingOpenId)
      window.setTimeout(() => {
        document.querySelector(`[data-id="${pendingOpenId}"]`)?.scrollIntoView({ block: 'center' })
      }, 100)
    } else {
      navigate(`/books/${pendingOpenId}`)
    }
    setPendingOpenId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenId, listQuery.isSuccess])
  /* eslint-enable react-hooks/set-state-in-effect */

  useShortcutAction(
    'newItem',
    useCallback(() => setNewBookOpen(true), []),
  )

  // ── Mobile: client-side filtering with the old server-side predicates ──────
  const mobileRows: BookRead[] = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return allRows.filter((row) => {
      if (filters.drafts) return row.is_draft && !row.voided_at
      if (filters.categoryIds.length > 0 && !filters.categoryIds.includes(row.category_id)) return false
      if (filters.direction !== 'all' && row.direction !== filters.direction) return false
      if (filters.status !== 'all' && row.approval_state !== filters.status) return false
      const day = row.created_at.slice(0, 10)
      if (filters.fromDate && day < filters.fromDate) return false
      if (filters.toDate && day > filters.toDate) return false
      if (q && !`${row.ref_number} ${row.subject ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [allRows, filters])

  // Mobile open routing: full-screen record page (`/books/:id`) in any state.
  const openBook = useCallback(
    (row: BookRead): void => {
      navigate(`/books/${row.id}`)
    },
    [navigate],
  )

  const hasFilters =
    filters.categoryIds.length > 0 ||
    filters.direction !== 'all' ||
    filters.status !== 'all' ||
    !!filters.fromDate ||
    !!filters.toDate ||
    !!filters.q.trim() ||
    !!filters.drafts

  // Header-line counts
  const total = listQuery.data?.total ?? 0

  // ── Desktop facets ──────────────────────────────────────────────────────────
  const spineCounts = useMemo<Record<SpineState, number>>(() => {
    const counts: Record<SpineState, number> = {
      all: allRows.length,
      none: 0,
      pending: 0,
      awaiting_scan: 0,
      returned: 0,
      approved: 0,
      rejected: 0,
    }
    for (const row of allRows) {
      const s = row.approval_state as SpineState
      if (s !== 'all' && s in counts) counts[s] += 1
    }
    return counts
  }, [allRows])

  const railItems = useMemo<RailItem[]>(() => {
    const byKind = new Map<string, { count: number; states: Set<string> }>()
    for (const row of allRows) {
      const kind = formKindOf(row.subject)
      let entry = byKind.get(kind.id)
      if (!entry) {
        entry = { count: 0, states: new Set() }
        byKind.set(kind.id, entry)
      }
      entry.count += 1
      if (row.approval_state !== 'none') entry.states.add(row.approval_state)
    }
    const items: RailItem[] = [
      { kindId: 'all', glyph: '🗂', labelKey: 'books.formKind.all', count: allRows.length, states: [] },
    ]
    const ordered: FormKind[] = [...FORM_KINDS, OTHER_KIND]
    for (const kind of ordered) {
      const entry = byKind.get(kind.id)
      if (!entry) continue
      items.push({
        kindId: kind.id,
        glyph: kind.glyph,
        labelKey: kind.labelKey,
        count: entry.count,
        states: [...entry.states],
      })
    }
    return items
  }, [allRows])

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
      return serverRows
        .filter((row) => {
          if (showDrafts) return row.is_draft && !row.voided_at
          if (spineState !== 'all' && row.approval_state !== spineState) return false
          if (railKind !== 'all' && formKindOf(row.subject).id !== railKind) return false
          return true
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    }
    const q = search.trim().toLowerCase()
    const filtered = allRows.filter((row) => {
      if (showDrafts) return row.is_draft && !row.voided_at
      if (spineState !== 'all' && row.approval_state !== spineState) return false
      if (railKind !== 'all' && formKindOf(row.subject).id !== railKind) return false
      if (q && !`${row.ref_number} ${row.subject ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
    // Sort desc by created_at defensively — RecordsList groups *adjacent* dates,
    // so unsorted input would split a day into duplicate sections (key collision).
    // `filtered` is already a copy; never mutate allRows.
    return filtered.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [allRows, spineState, railKind, search, showDrafts, serverSearchActive, searchQuery.data])

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
    const results = await Promise.allSettled(
      ids.map((id) => {
        const book = allRows.find((r) => r.id === id)
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
  }, [selectedForBasket, allRows, t])

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
    desktopRows.length > 0 &&
    (selectedId === null || !desktopRows.some((r) => r.id === selectedId))
  ) {
    setSelectedId(desktopRows[0].id)
  }

  const createMutation = useMutation({
    mutationFn: (body: BookCreate) => api.createBook(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      setNewBookOpen(false)
      toast.success(t('books.toast.created'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      {isDesktop ? (
        /* ───── Desktop: spine + three panes ───── */
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-4">
          <header className="mb-3 flex shrink-0 items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[1.45em] font-bold tracking-tight text-foreground">{t('books.title')}</h1>
              <div className="mt-0.5 text-[0.8em] text-muted-foreground">
                {listQuery.isPending ? t('books.subtitle') : t('books.pageMeta', { total })}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <RefreshButton />
              <button
                type="button"
                onClick={() => setNewBookOpen(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                {t('books.newEntry')}
              </button>
            </div>
          </header>
          <StatusSpine counts={spineCounts} active={spineState} onChange={setSpineState} />
          <div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)_clamp(360px,36%,480px)] gap-3">
            <FormRail items={railItems} active={railKind} onChange={setRailKind} />
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
                      <div className="rounded-xl border border-dashed border-warning/50 bg-warning-soft/30 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-[0.75em] font-bold uppercase tracking-[0.07em] text-warning">
                            {t('books.filters.drafts')} ({draftBooks.length})
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowDrafts(true)}
                            className="text-[0.72em] text-muted-foreground underline hover:text-foreground"
                          >
                            {t('books.filters.drafts')}
                          </button>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {draftBooks.slice(0, 3).map((draft) => (
                            <div
                              key={draft.id}
                              className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5"
                            >
                              <span className="font-mono text-[0.72em] font-bold text-primary">
                                {draft.ref_number}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[0.75em] text-foreground">
                                {draft.subject ?? '—'}
                              </span>
                              <BookStatusChips book={draft} noClassification />
                              <BookWordActions book={draft} />
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
                      </div>
                    </div>
                  )}
                  {selectedForBasket.size > 0 && (
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
                      {canManage && (
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
                    selected={selectedForBasket}
                    onToggleSelect={handleToggleSelect}
                  />
                </>
              )}
            </section>
            <RecordPane
              book={selectedBook}
              onOpenRecord={(id) => navigate(`/books/${id}`)}
              onContinueDraft={(id) => setPreviewBookId(id)}
              onSubmit={(id) => setSubmitBookId(id)}
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
                  {listQuery.isPending
                    ? t('books.subtitle')
                    : t('books.pageMeta', { total })}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <RefreshButton />
                <button
                  type="button"
                  onClick={() => setNewBookOpen(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  {t('books.newEntry')}
                </button>
              </div>
            </div>
          </header>

          {/* Filter bar — TAMM surface pill */}
          <div className="px-6 pb-2">
            <BooksFilterBar
              filters={filters}
              categories={categories}
              onChange={setFilters}
            />
          </div>

          {/* Card list */}
          <div className="flex-1 min-h-0">
          <PullToRefresh>
          <div className="px-6 pb-6">
            {listQuery.isPending ? (
              <div className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} cols={5} />
                ))}
              </div>
            ) : listQuery.isError ? (
              <div className="rounded-2xl border border-hairline bg-surface py-12">
                <EmptyState
                  icon={BookOpen}
                  message={t('common.loadError')}
                  actionLabel={t('common.retry')}
                  onAction={() => void listQuery.refetch()}
                />
              </div>
            ) : mobileRows.length === 0 ? (
              <div className="rounded-2xl border border-hairline bg-surface py-12">
                <EmptyState
                  icon={BookOpen}
                  message={hasFilters ? t('books.empty') : t('books.emptyUnfiltered')}
                  actionLabel={hasFilters ? undefined : t('books.newEntry')}
                  onAction={hasFilters ? undefined : () => setNewBookOpen(true)}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2 pb-24">
                {mobileRows.map((row) => (
                  <BookMobileCard
                    key={row.id}
                    row={row}
                    isAr={isAr}
                    canManage={canManage}
                    highlighted={row.id === highlightedId}
                    onSubmit={() => setSubmitBookId(row.id)}
                    onOpen={() => openBook(row)}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
          </PullToRefresh>
          </div>
        </>
      )}

      {newBookOpen && (
        <NewBookDialog
          categories={categories}
          onSubmit={async (body) => {
            await createMutation.mutateAsync(body)
          }}
          onClose={() => setNewBookOpen(false)}
          submitting={createMutation.isPending}
        />
      )}

      {submitBookId !== null && (
        <SubmitForApprovalDialog
          bookId={submitBookId}
          onClose={() => setSubmitBookId(null)}
        />
      )}

      <BookPreview
        bookId={previewBookId}
        onClose={() => setPreviewBookId(null)}
        onSubmitForApproval={(id) => { setPreviewBookId(null); setSubmitBookId(id) }}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={t('books.bulk.deleteTitle', { count: selectedForBasket.size })}
        description={t('books.bulk.deleteBody')}
        confirmLabel={t('books.bulk.delete')}
        onConfirm={() => deleteMutation.mutate([...selectedForBasket])}
        destructive
      />
    </div>
  )
}

function ApprovalStatePill({
  state,
  signingPath,
  signedSource,
  t,
}: {
  state: string
  signingPath?: string | null
  signedSource?: string | null
  t: (key: string) => string
}): React.JSX.Element {
  // Mobile keeps its own (amber-draft) chip palette for now — known deferral
  // for the next mobile pass; labels are path-aware via sealDescriptor.
  const variants: Record<string, string> = {
    none: 'bg-warning-soft text-warning',
    pending: 'bg-warning-soft text-warning',
    awaiting_scan: 'bg-info-soft text-info',
    approved: 'bg-success-soft text-success',
    rejected: 'bg-destructive/10 text-destructive',
    returned: 'bg-info-soft text-info',
  }
  const cls = variants[state] ?? 'bg-surface-tinted text-muted-foreground'
  // sealDescriptor falls back to the raw state string for unknown states.
  const label = t(sealDescriptor(state, { signingPath, signedSource }).labelKey)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em]',
        cls,
      )}
    >
      {label}
    </span>
  )
}

function DirectionPill({
  direction,
  t,
}: {
  direction: string | null
  t: (key: string) => string
}): React.JSX.Element {
  if (!direction) return <span className="text-muted-foreground">—</span>
  const isIncoming = direction === 'incoming'
  const Icon = isIncoming ? ArrowDownLeft : ArrowUpRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em]',
        isIncoming
          ? 'bg-info-soft text-info'
          : 'bg-success-soft text-success',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {t(`books.direction.${direction}`)}
    </span>
  )
}

// ─── Mobile-only book card ───────────────────────────────────────────────────
// Mirrors the desktop row but stacks ref + approval / subject / meta so the
// approval column never overflows the viewport (the dense table clips it).

interface BookMobileCardProps {
  row: BookRead
  isAr: boolean
  canManage: boolean
  highlighted: boolean
  onSubmit: () => void
  onOpen: () => void
  t: (key: string) => string
}

function BookMobileCard({
  row,
  isAr,
  canManage,
  highlighted,
  onSubmit,
  onOpen,
  t,
}: BookMobileCardProps): React.JSX.Element {
  const catLabel = isAr
    ? (row.category.name_ar ?? row.category.name_en)
    : (row.category.name_en ?? row.category.name_ar)
  return (
    <article
      data-id={row.id}
      role="button"
      tabIndex={0}
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-2xl border border-hairline bg-surface p-3.5 transition-colors',
        highlighted && 'bg-accent-soft',
      )}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {/* ref + approval action */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.85em] font-semibold text-primary">
          <bdi dir="ltr">{row.ref_number}</bdi>
        </span>
        {row.approval_state !== 'none' ? (
          <ApprovalStatePill
            state={row.approval_state}
            signingPath={row.signing_path}
            signedSource={signedSourceOf(row)}
            t={t}
          />
        ) : (
          <>
            <ApprovalStatePill state="none" t={t} />
            {canManage ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onSubmit() }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[0.72em] font-medium transition-colors min-h-[36px]',
                  'border border-hairline text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  row.category.requires_approval &&
                    'border-warning/50 text-warning hover:border-warning hover:text-warning',
                )}
              >
                <Send className="h-2.5 w-2.5" strokeWidth={2} />
                {row.category.requires_approval
                  ? t('books.approval.needsApproval')
                  : t('books.approval.submitForApproval')}
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* subject */}
      {row.subject ? (
        <p className="line-clamp-2 text-[0.85em] leading-snug text-foreground" dir="auto">
          {row.subject}
        </p>
      ) : null}

      {/* category · direction · date */}
      <div className="flex flex-wrap items-center gap-2 text-[0.72em] text-muted-foreground">
        <span className="inline-flex items-center rounded-full bg-surface-tinted px-2.5 py-0.5 font-medium uppercase tracking-[0.06em]">
          {catLabel}
        </span>
        {row.direction && <DirectionPill direction={row.direction} t={t} />}
        <span className="ms-auto font-mono">{formatDate(row.created_at)}</span>
      </div>
    </article>
  )
}
