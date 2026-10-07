/**
 * Security Permits — the register page.
 *
 * Layout mirrors LeavesPage: a TAMM-style header (eyebrow · title · subtitle),
 * a row of summary tiles, a filter + action toolbar, and the permits table.
 * Issuing / editing goes through PermitFormDialog; viewing and amending
 * (add/remove person, renew, revoke, delete) through PermitDetailDialog.
 *
 * Whether a permit is expired / expiring is decided server-side from its end
 * date, so the badges here are always correct without any client clock logic.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Car, Plus, Printer, ShieldCheck, Paperclip, Users, X } from 'lucide-react'
import { toast } from 'sonner'

import { api, type PermitListItem, type PermitRead, type PermitZone } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonRow } from '@/components/ui/skeleton'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/useIsMobile'
import { useReducedMotion } from '@/lib/useFakeProgress'
import { useCapabilities } from '@/lib/useCapabilities'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { PermitFormDialog } from './PermitFormDialog'
import { PermitDetailDialog } from './PermitDetailDialog'
import { PermitAccessBadge } from './PermitAccessBadge'
import { PermitFilterBar, type FilterTile } from './PermitFilterBar'
import { PermitQuickView } from './PermitQuickView'
import { ItemPermitsTab } from './ItemPermitsTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSearchParam, useUrlOverlay } from '@/lib/urlState'
import { fmtDate, fmtLongDate, permitBookQuery, statusTone } from './permitUtils'

const STATE_OPTIONS = ['', 'valid', 'active', 'expiring', 'expired', 'revoked'] as const
const ZONE_OPTIONS: ('' | PermitZone)[] = ['', 'green', 'red', 'work_residence']

const selectCls =
  'h-9 rounded-md border border-input bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Validity text + remaining-days text, shared by the table cell, the mobile card and the quick view. */
function permitWindow(
  t: TFunction,
  language: string,
  row: PermitListItem,
): { validity: string; remaining: string | null } {
  const remaining =
    row.derived_status === 'revoked' || row.days_remaining === null
      ? null
      : row.days_remaining < 0
        ? t('permits.expired')
        : row.days_remaining === 0
          ? t('permits.endsToday')
          : t('permits.daysLeft', { count: row.days_remaining })
  return {
    validity: t('permits.validityFrom', {
      period: t(`permits.validityPeriod.${row.validity.unit}`, { count: row.validity.value }),
      date: fmtLongDate(row.start_date, language),
    }),
    remaining,
  }
}

export function PermitsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has, isLoading: capabilitiesLoading } = useCapabilities()
  const canCreate = has('permits.create')

  const [state, setState] = useSearchParam('state')
  const [zone, setZone] = useSearchParam('zone')
  const [q, setQ] = useSearchParam('q')
  const [tabParam, setTab] = useSearchParam('tab')
  const tab = tabParam === 'items' ? 'items' : 'security'
  const detailOverlay = useUrlOverlay('open')
  const actionOverlay = useUrlOverlay('action')

  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const isMobile = useIsMobile()
  const reducedMotion = useReducedMotion()
  const previewOverlay = useUrlOverlay('preview')

  const [editing, setEditing] = useState<PermitRead | null>(null)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  // Set by onSaved when a permit was just issued; consumed when the form closes.
  const createdRef = useRef<PermitRead | null>(null)
  // A deep-linked preview of a permit the list doesn't contain falls back to the full dialog once.
  const fallbackRef = useRef<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [printing, setPrinting] = useState(false)

  // Debounce the free-text search so a burst of keystrokes doesn't fire a
  // 500-row refetch (and a selection reset) per character.
  const debouncedQ = useDebouncedValue(q, 300)
  const params = useMemo(
    () => ({
      state: state || undefined,
      zone: (zone || undefined) as PermitZone | undefined,
      q: debouncedQ || undefined,
    }),
    [state, zone, debouncedQ],
  )
  const filtersActive = Boolean(state || zone || q)
  const detailId = detailOverlay.value === null ? null : Number(detailOverlay.value)
  const previewId = previewOverlay.value === null ? null : Number(previewOverlay.value)
  const formOpen = actionOverlay.value === 'new' || editing !== null

  // One replace-navigation, so no stale param survives (three setters would race on the same search string).
  const clearFilters = (): void => {
    const next = new URLSearchParams(location.search)
    for (const key of ['state', 'zone', 'q']) next.delete(key)
    const search = next.toString()
    navigate({ search: search ? `?${search}` : '' }, { replace: true, state: location.state })
  }

  useEffect(() => {
    if (capabilitiesLoading || actionOverlay.value !== 'new' || canCreate) return
    actionOverlay.close()
  }, [actionOverlay, actionOverlay.value, canCreate, capabilitiesLoading])

  const summaryQuery = useQuery({
    queryKey: ['permits-summary'],
    queryFn: () => api.permitsSummary(),
  })
  const listQuery = useQuery({
    queryKey: ['permits-list', params],
    queryFn: () => api.listPermits({ ...params, limit: 500 }),
  })

  const rows = listQuery.data?.items ?? []
  const summary = summaryQuery.data
  const previewRow = previewId === null ? undefined : rows.find((r) => r.id === previewId)

  useEffect(() => {
    // `debouncedQ !== q`: right after a landing that cleared the search, the list still reflects the old query.
    if (previewId === null || previewRow || !listQuery.isSuccess || listQuery.isFetching || debouncedQ !== q) return
    if (fallbackRef.current === previewId) return
    fallbackRef.current = previewId
    const next = new URLSearchParams(location.search)
    next.delete('preview')
    next.set('open', String(previewId))
    navigate({ search: `?${next}` }, { replace: true, state: location.state })
  }, [previewId, previewRow, listQuery.isSuccess, listQuery.isFetching, debouncedQ, q, location.search, location.state, navigate])

  // Scroll the just-issued permit into view once its preview is closed, then fade the highlight.
  useEffect(() => {
    if (highlightedId === null || previewId !== null || listQuery.isFetching) return
    document
      .querySelector<HTMLElement>(`[data-permit-id="${highlightedId}"]`)
      ?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' })
    const handle = window.setTimeout(() => setHighlightedId(null), 1800)
    return () => window.clearTimeout(handle)
  }, [highlightedId, previewId, listQuery.isFetching, reducedMotion])

  const prefetchLetter = (row: PermitListItem): void => {
    if (row.book_id) void qc.prefetchQuery({ ...permitBookQuery(row.book_id), staleTime: 30_000 })
  }

  // Selection drives Print. When the filter changes the visible set changes,
  // so clear the selection to avoid acting on now-hidden rows.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set())
  }, [params])

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleOne = (id: number): void =>
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = (): void =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))

  // Print fetches FULL records (people + vehicles) for the ticked rows — or the
  // whole filtered set when nothing is ticked — in one request.
  const printParams = useMemo(
    () => (selected.size ? { ...params, ids: [...selected].join(',') } : params),
    [selected, params],
  )
  const printQuery = useQuery({
    queryKey: ['permits-detailed', printParams],
    queryFn: () => api.listPermitsDetailed(printParams),
    enabled: printing,
  })

  // Once the detailed data has loaded (and the print view has committed to the
  // DOM), hand it to the browser to print.
  useEffect(() => {
    if (!printing) return
    if (printQuery.isError) {
      toast.error(t('permits.loadError'))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrinting(false)
      return
    }
    if (!printQuery.isSuccess) return
    window.print()
    setPrinting(false)
  }, [printing, printQuery.isSuccess, printQuery.isError, t])

  const openNew = (): void => {
    setEditing(null)
    actionOverlay.open('new')
  }

  const statusTiles: FilterTile[] = [
    { key: 'active', label: t('permits.summary.active'), count: summary?.active ?? null, tone: 'success' },
    { key: 'expiring', label: t('permits.summary.expiring'), count: summary?.expiring ?? null, tone: 'warning' },
    { key: 'expired', label: t('permits.summary.expired'), count: summary?.expired ?? null, tone: 'destructive' },
    { key: 'revoked', label: t('permits.summary.revoked'), count: summary?.revoked ?? null, tone: 'neutral' },
  ]
  const zoneTiles: FilterTile[] = [
    { key: 'green', label: t('permits.summary.peopleGreen'), count: summary?.people_green ?? null, tone: 'success' },
    { key: 'red', label: t('permits.summary.peopleRed'), count: summary?.people_red ?? null, tone: 'destructive' },
    {
      key: 'work_residence',
      label: t('permits.summary.peopleWork'),
      count: summary?.people_work_residence ?? null,
      tone: 'info',
    },
  ]

  const quickFacts = (row: PermitListItem): { label: string; value: React.ReactNode }[] => {
    const w = permitWindow(t, i18n.language, row)
    return [
      {
        label: t('permits.columns.zone'),
        value: <PermitAccessBadge accessAreas={row.access_areas} zones={row.zones} square />,
      },
      { label: t('permits.columns.window'), value: `${w.validity}${w.remaining ? ` · ${w.remaining}` : ''}` },
      { label: t('permits.columns.people'), value: row.people_count },
      { label: t('permits.columns.vehicles'), value: row.vehicle_count },
      ...(row.has_document ? [{ label: t('permits.paper.title'), value: t('permits.paper.attached') }] : []),
    ]
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {t('permits.eyebrow')}
            </div>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground md:text-[1.7em]">
              {t(tab === 'items' ? 'permits.items.title' : 'permits.title')}
            </h1>
            <div className="mt-1 hidden text-[0.86em] text-muted-foreground md:block">
              {t(tab === 'items' ? 'permits.items.subtitle' : 'permits.subtitle')}
            </div>
          </div>
          <RefreshButton />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6" data-print-hide>
        <Tabs value={tab} onValueChange={(v) => setTab(v === 'items' ? v : null)}>
          <TabsList>
            <TabsTrigger value="security">{t('permits.tabs.security')}</TabsTrigger>
            <TabsTrigger value="items">{t('permits.tabs.items')}</TabsTrigger>
          </TabsList>
          <TabsContent value="security" className="mt-4">
            {/* Quick filters: count tiles bound to ?state= / ?zone= */}
            <div className="mb-4 grid gap-2 lg:grid-cols-[4fr_3fr]">
              <PermitFilterBar
                label={t('permits.statusFilters')}
                tiles={statusTiles}
                value={state}
                onSelect={setState}
                className="grid-cols-4"
              />
              <PermitFilterBar
                label={t('permits.zoneFilters')}
                tiles={zoneTiles}
                value={zone}
                onSelect={setZone}
                className="grid-cols-3"
              />
            </div>

            {/* Toolbar */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select className={selectCls} value={state} onChange={(e) => setState(e.target.value || null)} aria-label={t('permits.filters.state')}>
                {STATE_OPTIONS.map((s) => (
                  <option key={s || 'all'} value={s}>
                    {s === '' ? t('permits.filters.all') : s === 'valid' ? t('permits.filters.valid') : t(`permits.status.${s}`)}
                  </option>
                ))}
              </select>
              <select className={selectCls} value={zone} onChange={(e) => setZone(e.target.value || null)} aria-label={t('permits.filters.zone')}>
                {ZONE_OPTIONS.map((z) => (
                  <option key={z || 'all'} value={z}>
                    {z === '' ? t('permits.filters.all') : t(`permits.zone.${z}`)}
                  </option>
                ))}
              </select>
              <input
                className={`${selectCls} min-w-[12rem] flex-1`}
                placeholder={t('permits.filters.search')}
                aria-label={t('permits.filters.search')}
                value={q}
                dir="auto"
                onChange={(e) => setQ(e.target.value || null)}
              />
              {filtersActive && (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="me-1.5 h-4 w-4" aria-hidden />
                  {t('permits.filters.clear')}
                </Button>
              )}

              <div className="flex items-center gap-2 ms-auto">
                {selected.size > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t('permits.selectedCount', { count: selected.size })}
                    <button
                      type="button"
                      className="ms-1.5 font-medium text-primary hover:underline"
                      onClick={() => setSelected(new Set())}
                    >
                      {t('permits.clearSelection')}
                    </button>
                  </span>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => setPrinting(true)}>
                  <Printer className="me-1.5 h-4 w-4" aria-hidden />
                  {selected.size ? t('permits.printSelected', { count: selected.size }) : t('permits.print')}
                </Button>
                {canCreate && (
                  <Button type="button" size="sm" onClick={openNew}>
                    <Plus className="me-1.5 h-4 w-4" aria-hidden />
                    {t('permits.new')}
                  </Button>
                )}
              </div>
            </div>

            <p aria-live="polite" className="mb-2 min-h-4 text-xs text-muted-foreground">
              {listQuery.isSuccess && (
                <>
                  {t('permits.resultCount', { count: rows.length })}
                  {listQuery.data.total > rows.length &&
                    ` · ${t('permits.resultCapped', { shown: rows.length, total: listQuery.data.total })}`}
                </>
              )}
            </p>

            {/* Table / cards / states */}
            {listQuery.isError ? (
              <div className="rounded-xl border border-border bg-surface">
                <EmptyState
                  message={t('permits.loadError')}
                  actionLabel={t('common.retry')}
                  onAction={() => void listQuery.refetch()}
                />
              </div>
            ) : listQuery.isLoading ? (
              <div className="overflow-hidden rounded-xl border border-border">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} cols={9} />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                message={filtersActive ? t('permits.empty') : t('permits.emptyRegister')}
                {...(filtersActive
                  ? { actionLabel: t('permits.filters.clear'), onAction: clearFilters }
                  : canCreate
                    ? { actionLabel: t('permits.new'), onAction: openNew }
                    : {})}
              />
            ) : isMobile ? (
              <div className="flex flex-col gap-2.5">
                {rows.map((row) => (
                  <PermitCard
                    key={row.id}
                    row={row}
                    highlighted={highlightedId === row.id}
                    onOpen={() => previewOverlay.open(String(row.id))}
                    onPrefetch={() => prefetchLetter(row)}
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label={t('permits.selectAll')}
                          checked={allSelected}
                          onChange={toggleAll}
                          className="h-4 w-4 cursor-pointer accent-primary"
                        />
                      </TableHead>
                      <TableHead>{t('permits.columns.permitNo')}</TableHead>
                      <TableHead>{t('permits.columns.company')}</TableHead>
                      <TableHead>{t('permits.columns.zone')}</TableHead>
                      <TableHead>{t('permits.columns.window')}</TableHead>
                      <TableHead className="text-end">{t('permits.columns.people')}</TableHead>
                      <TableHead className="text-end">{t('permits.columns.vehicles')}</TableHead>
                      <TableHead>{t('permits.columns.status')}</TableHead>
                      <TableHead className="w-16 text-end">{t('permits.columns.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <PermitRowView
                        key={row.id}
                        row={row}
                        selected={selected.has(row.id)}
                        highlighted={highlightedId === row.id}
                        onToggle={() => toggleOne(row.id)}
                        onOpen={() => previewOverlay.open(String(row.id))}
                        onPrefetch={() => prefetchLetter(row)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
          <TabsContent value="items" className="mt-4">
            <ItemPermitsTab />
          </TabsContent>
        </Tabs>
      </div>

      {/* Print-only view — mounted once the detailed records load, hidden on
          screen. The selected rows, or the whole filtered set when none ticked. */}
      {printing && printQuery.isSuccess && (
        <PermitPrintView permits={printQuery.data} scope={selected.size ? 'selected' : 'all'} />
      )}

      {/* Dialogs */}
      <PermitFormDialog
        open={formOpen}
        permit={editing}
        onOpenChange={(open) => {
          if (open) return
          setEditing(null)
          const created = createdRef.current
          if (created) {
            // Land on the new permit: ONE replace (not close + open, which would race
            // navigate(-1)). Dropping the overlay marker makes closing the preview stay
            // on the cleared register with the new row highlighted.
            createdRef.current = null
            const next = new URLSearchParams(location.search)
            for (const key of ['action', 'state', 'zone', 'q']) next.delete(key)
            next.set('preview', String(created.id))
            navigate({ search: `?${next}` }, { replace: true, state: { ...(location.state as object | null), overlay: false } })
            return
          }
          if (actionOverlay.value === 'new') actionOverlay.close()
        }}
        onSaved={(p) => {
          if (!editing) {
            createdRef.current = p
            setHighlightedId(p.id)
            toast.success(t('permits.createdToast', { no: p.permit_no ?? `#${p.id}` }))
            return
          }
          // After editing from the detail dialog, keep the detail open on it.
          if (String(p.id) !== detailOverlay.value) detailOverlay.open(String(p.id))
        }}
      />
      {previewRow && (
        <PermitQuickView
          open
          onClose={previewOverlay.close}
          reference={previewRow.permit_no ?? `#${previewRow.id}`}
          title={previewRow.company}
          status={<Badge tone={statusTone(previewRow.derived_status)}>{t(`permits.status.${previewRow.derived_status}`)}</Badge>}
          facts={quickFacts(previewRow)}
          bookId={previewRow.book_id ?? null}
          onOpenFull={() => detailOverlay.open(String(previewRow.id), { preview: null })}
        />
      )}
      {detailId !== null && Number.isFinite(detailId) && (
        <PermitDetailDialog
          permitId={detailId}
          open
          onOpenChange={(open) => !open && detailOverlay.close()}
          onNotFound={() => detailOverlay.close()}
          onEdit={(p) => setEditing(p)}
        />
      )}
    </div>
  )
}

function PermitRowView({
  row,
  selected,
  highlighted,
  onToggle,
  onOpen,
  onPrefetch,
}: {
  row: PermitListItem
  selected: boolean
  highlighted: boolean
  onToggle: () => void
  onOpen: () => void
  onPrefetch: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { validity, remaining } = permitWindow(t, i18n.language, row)

  return (
    <TableRow
      data-permit-id={row.id}
      tabIndex={-1}
      className={cn('cursor-pointer', selected && 'bg-primary-soft/40', highlighted && 'bg-accent-soft')}
      onClick={onOpen}
      onPointerEnter={onPrefetch}
    >
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={t('permits.selectRow', { no: row.permit_no ?? row.id })}
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 cursor-pointer accent-primary"
        />
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs">
        <bdi dir="ltr">{row.permit_no ?? `#${row.id}`}</bdi>
        {row.has_document && (
          <Paperclip className="ms-1.5 inline h-3 w-3 align-middle text-muted-foreground" aria-label={t('permits.paper.attached')} />
        )}
      </TableCell>
      <TableCell className="max-w-[14rem] truncate font-medium" dir="auto">
        {row.company}
      </TableCell>
      <TableCell>
        <PermitAccessBadge accessAreas={row.access_areas} zones={row.zones} square />
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        <span>{validity}</span>
        {remaining && <span className="ms-2 not-italic">· {remaining}</span>}
      </TableCell>
      <TableCell className="text-end tabular-nums">{row.people_count}</TableCell>
      <TableCell className="text-end tabular-nums">{row.vehicle_count}</TableCell>
      <TableCell>
        <Badge tone={statusTone(row.derived_status)}>{t(`permits.status.${row.derived_status}`)}</Badge>
      </TableCell>
      {/* Keyboard-reachable open (the row's onClick is mouse-only). */}
      <TableCell className="w-16 text-end" onClick={(e) => e.stopPropagation()}>
        <Button type="button" variant="ghost" size="sm" onClick={onOpen} onFocus={onPrefetch}>
          {t('permits.actions.view')}
        </Button>
      </TableCell>
    </TableRow>
  )
}

/** Mobile register row: the whole card is one button that opens the quick view. */
function PermitCard({
  row,
  highlighted,
  onOpen,
  onPrefetch,
}: {
  row: PermitListItem
  highlighted: boolean
  onOpen: () => void
  onPrefetch: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { validity, remaining } = permitWindow(t, i18n.language, row)

  return (
    <button
      type="button"
      data-permit-id={row.id}
      onClick={onOpen}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      className={cn(
        'flex min-h-11 w-full flex-col gap-2 rounded-xl border border-border bg-surface p-3.5 text-start transition-colors',
        'hover:border-border-strong motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        highlighted && 'bg-accent-soft',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span dir="ltr" className="font-mono text-xs">
          {row.permit_no ?? `#${row.id}`}
          {row.has_document && (
            <Paperclip className="ms-1.5 inline h-3 w-3 align-middle text-muted-foreground" aria-label={t('permits.paper.attached')} />
          )}
        </span>
        <Badge tone={statusTone(row.derived_status)}>{t(`permits.status.${row.derived_status}`)}</Badge>
      </span>
      <span className="truncate font-medium">
        <bdi>{row.company}</bdi>
      </span>
      <PermitAccessBadge accessAreas={row.access_areas} zones={row.zones} square />
      <span className="text-[0.78em] text-muted-foreground">
        <span className="tabular-nums">{validity}</span>
        {remaining && <span className="ms-2">· {remaining}</span>}
      </span>
      <span className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{t('permits.columns.people')}</span>
          <bdi className="tabular-nums">{row.people_count}</bdi>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Car className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{t('permits.columns.vehicles')}</span>
          <bdi className="tabular-nums">{row.vehicle_count}</bdi>
        </span>
      </span>
    </button>
  )
}

/**
 * Detailed, multi-page print. Hidden on screen (`hidden`), revealed by the
 * print stylesheet (`print:block`). Global @media print rules hide the app
 * chrome + `data-print-hide` content, so only this reaches the paper.
 *
 * One block per permit — header facts + full people & vehicle tables — so the
 * printout carries ALL of a permit's data, not just the register summary.
 * Tight small font; a permit block never splits across pages.
 */
function PermitPrintView({
  permits,
  scope,
}: {
  permits: PermitRead[]
  scope: 'selected' | 'all'
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    // print-register = the named @page that carries this printout's 12mm margin
    // (the default @page has none, so the record sheet prints full-bleed).
    <div className="print-register hidden bg-white p-0 text-black print:block">
      <div className="mb-2 flex items-center gap-3 border-b border-black pb-1.5">
        <img src="/brand/gssg-logo.png" alt="" className="h-10 w-auto" />
        <div>
          <h1 className="text-base font-bold">{t('permits.printout.title')}</h1>
          <p className="text-[10px] text-neutral-600">
            {t(scope === 'selected' ? 'permits.printout.subtitleSelected' : 'permits.printout.subtitleAll', {
              count: permits.length,
            })}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {permits.map((p) => (
          <PermitPrintCard key={p.id} permit={p} />
        ))}
      </div>
    </div>
  )
}

function PermitPrintCard({ permit }: { permit: PermitRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const people = permit.people.filter((p) => p.removed_at === null)
  const vehicles = permit.vehicles.filter((v) => v.removed_at === null)
  return (
    <section className="break-inside-avoid border border-neutral-400">
      {/* Facts strip */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-neutral-400 bg-neutral-100 px-2 py-1 text-[10px]">
        <span className="font-mono text-[11px] font-bold">{permit.permit_no ?? `#${permit.id}`}</span>
        <span className="text-[11px] font-semibold" dir="auto">{permit.company}</span>
        <PermitAccessBadge accessAreas={permit.access_areas} zones={permit.zones} square />
        <span className="font-mono">
          {t('permits.validityFrom', {
            period: t(`permits.validityPeriod.${permit.validity.unit}`, { count: permit.validity.value }),
            date: fmtLongDate(permit.start_date, i18n.language),
          })}
        </span>
        <span className="font-semibold">{t(`permits.status.${permit.derived_status}`)}</span>
        {permit.purpose && (
          <span className="text-neutral-600" dir="auto">
            · {permit.purpose}
          </span>
        )}
      </div>

      {/* People */}
      <table className="w-full border-collapse text-[9px]">
        <thead>
          <tr className="bg-neutral-50">
            <PrintTh className="w-6 text-center">#</PrintTh>
            <PrintTh>{t('permits.person.name')}</PrintTh>
            <PrintTh>{t('permits.person.uaeId')}</PrintTh>
            <PrintTh>{t('permits.person.nationality')}</PrintTh>
            <PrintTh>{t('permits.person.role')}</PrintTh>
          </tr>
        </thead>
        <tbody>
          {people.length === 0 ? (
            <tr>
              <PrintTd className="text-neutral-500" colSpan={5}>
                {t('permits.detail.noPeople')}
              </PrintTd>
            </tr>
          ) : (
            people.map((p, i) => (
              <tr key={p.id} className="border-t border-neutral-200">
                <PrintTd className="text-center">{i + 1}</PrintTd>
                <PrintTd dir="auto">{p.name}</PrintTd>
                <PrintTd className="font-mono">{p.uae_id ?? ''}</PrintTd>
                <PrintTd dir="auto">{p.nationality ?? ''}</PrintTd>
                <PrintTd dir="auto">{p.role ?? ''}</PrintTd>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Vehicles */}
      {vehicles.length > 0 && (
        <table className="w-full border-collapse border-t border-neutral-400 text-[9px]">
          <thead>
            <tr className="bg-neutral-50">
              <PrintTh>{t('permits.vehicle.plate')}</PrintTh>
              <PrintTh>{t('permits.vehicle.plateEmirate')}</PrintTh>
              <PrintTh>{t('permits.vehicle.plateCategory')}</PrintTh>
              <PrintTh>{t('permits.vehicle.trafficNo')}</PrintTh>
              <PrintTh>{t('permits.vehicle.makeModel')}</PrintTh>
              <PrintTh>{t('permits.vehicle.vehicleType')}</PrintTh>
              <PrintTh>{t('permits.vehicle.colour')}</PrintTh>
              <PrintTh>{t('permits.vehicle.regExpiry')}</PrintTh>
              <PrintTh>{t('permits.vehicle.driver')}</PrintTh>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-t border-neutral-200">
                <PrintTd className="font-mono">{v.plate_no ?? ''}</PrintTd>
                <PrintTd dir="auto">{v.plate_emirate ?? ''}</PrintTd>
                <PrintTd dir="auto">{v.plate_category ?? ''}</PrintTd>
                <PrintTd className="font-mono">{v.traffic_no ?? ''}</PrintTd>
                <PrintTd dir="auto">{v.make_model ?? ''}</PrintTd>
                <PrintTd dir="auto">{v.vehicle_type ?? ''}</PrintTd>
                <PrintTd dir="auto">{v.colour ?? ''}</PrintTd>
                <PrintTd className="font-mono">{v.reg_expiry ? fmtDate(v.reg_expiry) : ''}</PrintTd>
                <PrintTd dir="auto">{v.driver_name ?? ''}</PrintTd>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function PrintTh({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <th className={`border-e border-neutral-200 px-1 py-0.5 text-start font-semibold ${className}`}>
      {children}
    </th>
  )
}

function PrintTd({
  children,
  className = '',
  colSpan,
  dir,
}: {
  children: React.ReactNode
  className?: string
  colSpan?: number
  dir?: 'auto' | 'ltr' | 'rtl'
}): React.JSX.Element {
  return (
    <td colSpan={colSpan} dir={dir} className={`border-e border-neutral-200 px-1 py-0.5 align-top ${className}`}>
      {children}
    </td>
  )
}
