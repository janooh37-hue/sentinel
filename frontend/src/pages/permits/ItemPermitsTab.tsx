/**
 * Item permits tab — the register of item-entry (إدخال مواد) permits. Same
 * shape as the security register: search + New toolbar, approval quick
 * filters, table (cards on mobile), and URL-bound overlays (`itemPreview`
 * quick view, `item` detail, `itemAction` form) that don't collide with the
 * security tab's `preview` / `open` / `action`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { PackagePlus, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { api, type ItemPermitRead } from '@/lib/api'
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
import { useCapabilities } from '@/lib/useCapabilities'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useReducedMotion } from '@/lib/useFakeProgress'
import { useIsMobile } from '@/lib/useIsMobile'
import { useSearchParam, useUrlOverlay } from '@/lib/urlState'
import { cn } from '@/lib/utils'
import { ItemPermitFormDialog } from './ItemPermitFormDialog'
import { ItemPermitDetailDialog } from './ItemPermitDetailDialog'
import { PermitFilterBar, type FilterTile } from './PermitFilterBar'
import { PermitQuickView } from './PermitQuickView'
import {
  approvalTone,
  fmtLongDate,
  zoneTone,
  type PermitApprovalState,
} from './permitUtils'
import { usePrefetchLetter, type PrefetchHandlers } from './usePrefetchLetter'

const searchCls =
  'h-10 min-w-full rounded-md border border-input bg-surface px-2.5 text-sm text-foreground transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none sm:min-w-[12rem] sm:flex-1 md:h-9'

const APPROVAL_TILES: { key: PermitApprovalState; tone: FilterTile['tone'] }[] = [
  { key: 'none', tone: 'neutral' },
  { key: 'pending', tone: 'warning' },
  { key: 'approved', tone: 'success' },
  { key: 'returned', tone: 'info' },
  { key: 'rejected', tone: 'destructive' },
]

const approvalOf = (row: ItemPermitRead): PermitApprovalState =>
  (row.approval_state ?? 'none') as PermitApprovalState

const employeeName = (row: ItemPermitRead, language: string): string =>
  language.startsWith('ar') ? row.employee_name : row.employee_name_en

export function ItemPermitsTab(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has, isLoading: capabilitiesLoading } = useCapabilities()
  const canCreate = has('permits.create')
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()
  const reducedMotion = useReducedMotion()

  const [q, setQ] = useSearchParam('iq')
  const [status, setStatus] = useSearchParam('istatus')
  const previewOverlay = useUrlOverlay('itemPreview')
  const detailOverlay = useUrlOverlay('item')
  const actionOverlay = useUrlOverlay('itemAction')
  const [editing, setEditing] = useState<ItemPermitRead | null>(null)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  // Set by onSaved, consumed by the dialog's follow-up onOpenChange(false).
  const createdRef = useRef<ItemPermitRead | null>(null)
  // The just-issued permit, so its quick view renders before the list refetches.
  const [lastCreated, setLastCreated] = useState<ItemPermitRead | null>(null)
  const fallbackFor = useRef<number | null>(null)

  const debouncedQ = useDebouncedValue(q, 300)
  const params = useMemo(() => ({ q: debouncedQ || undefined, limit: 500 }), [debouncedQ])
  const detailId = detailOverlay.value === null ? null : Number(detailOverlay.value)
  const previewId = previewOverlay.value === null ? null : Number(previewOverlay.value)
  const formOpen = actionOverlay.value === 'new' || editing !== null

  useEffect(() => {
    if (capabilitiesLoading || actionOverlay.value !== 'new' || canCreate) return
    actionOverlay.close()
  }, [actionOverlay, actionOverlay.value, canCreate, capabilitiesLoading])

  const listQuery = useQuery({
    queryKey: ['item-permits-list', params],
    queryFn: () => api.listItemPermits(params),
  })
  const rows = useMemo(() => listQuery.data?.items ?? [], [listQuery.data])

  // ponytail: counts/filter are client-side over the ≤500-row list; move
  // server-side if the register outgrows it.
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const row of rows) c[approvalOf(row)] = (c[approvalOf(row)] ?? 0) + 1
    return c
  }, [rows])
  const visible = useMemo(
    () => (status ? rows.filter((row) => approvalOf(row) === status) : rows),
    [rows, status],
  )
  const tiles: FilterTile[] = APPROVAL_TILES.map(({ key, tone }) => ({
    key,
    tone,
    label: t(`permits.approval.${key}`),
    count: listQuery.isSuccess ? (counts[key] ?? 0) : null,
  }))

  const previewRow =
    previewId === null
      ? null
      : (rows.find((row) => row.id === previewId) ??
        (lastCreated?.id === previewId ? lastCreated : null))

  /** One replace navigation (keeps `tab` and any other keys): drop, then set. */
  const replaceSearch = (drop: string[], set: Record<string, string> = {}, keepOverlay = true): void => {
    const next = new URLSearchParams(location.search)
    drop.forEach((key) => next.delete(key))
    Object.entries(set).forEach(([key, value]) => next.set(key, value))
    const state = keepOverlay ? location.state : { ...(location.state as object | null), overlay: false }
    navigate({ search: next.toString() }, { replace: true, state })
  }

  // A shared `itemPreview` link to a permit outside the loaded list: fall back
  // to the full detail dialog (which fetches by id) once, instead of nothing.
  useEffect(() => {
    if (previewId === null || !Number.isFinite(previewId) || previewRow) return
    if (!listQuery.isSuccess || listQuery.isFetching || fallbackFor.current === previewId) return
    fallbackFor.current = previewId
    replaceSearch(['itemPreview'], { item: String(previewId) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replaceSearch is recreated each render
  }, [previewId, previewRow, listQuery.isSuccess, listQuery.isFetching])

  // Scroll the new row into view once the preview is out of the way, then fade
  // the highlight.
  useEffect(() => {
    if (highlightedId === null || previewId !== null) return
    const node = document.querySelector<HTMLElement>(`[data-item-permit-id="${highlightedId}"]`)
    if (!node) return
    node.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' })
    const handle = window.setTimeout(() => setHighlightedId(null), 1800)
    return () => window.clearTimeout(handle)
  }, [highlightedId, previewId, visible, reducedMotion])

  const openNew = (): void => {
    setEditing(null)
    actionOverlay.open('new')
  }
  const clearFilters = (): void => replaceSearch(['iq', 'istatus'])
  const letterPrefetch = usePrefetchLetter()
  const openPreview = (row: ItemPermitRead): void => previewOverlay.open(String(row.id))
  const filtered = Boolean(q || status)

  return (
    <>
      <PermitFilterBar
        label={t('permits.items.approvalFilters')}
        tiles={tiles}
        value={status}
        onSelect={setStatus}
        className="mb-3 grid-cols-3 sm:grid-cols-5"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className={searchCls}
          placeholder={t('permits.items.search')}
          aria-label={t('permits.items.search')}
          value={q}
          dir="auto"
          onChange={(e) => setQ(e.target.value || null)}
        />
        {filtered && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            <X className="me-1.5 h-4 w-4" aria-hidden />
            {t('permits.filters.clear')}
          </Button>
        )}
        {canCreate && (
          <Button type="button" size="sm" className="ms-auto" onClick={openNew}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden />
            {t('permits.items.new')}
          </Button>
        )}
      </div>

      <p aria-live="polite" className="mb-2 min-h-4 text-xs text-muted-foreground">
        {listQuery.isSuccess && (
          <>
            {t('permits.resultCount', { count: visible.length })}
            {listQuery.data.total > rows.length &&
              ` · ${t('permits.resultCapped', { shown: rows.length, total: listQuery.data.total })}`}
          </>
        )}
      </p>

      {listQuery.isError ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={PackagePlus}
            message={t('permits.items.loadError')}
            actionLabel={t('common.retry')}
            onAction={() => void listQuery.refetch()}
          />
        </div>
      ) : listQuery.isLoading ? (
        <div className="overflow-hidden rounded-xl border border-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} cols={7} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          message={filtered ? t('permits.items.empty') : t('permits.items.emptyRegister')}
          {...(filtered
            ? { actionLabel: t('permits.filters.clear'), onAction: clearFilters }
            : canCreate
              ? { actionLabel: t('permits.items.new'), onAction: openNew }
              : {})}
        />
      ) : isMobile ? (
        <div className="flex flex-col gap-2">
          {visible.map((row) => (
            <ItemPermitCard
              key={row.id}
              row={row}
              highlighted={row.id === highlightedId}
              onOpen={() => openPreview(row)}
              prefetch={letterPrefetch(row.book_id)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('permits.items.columns.ref')}</TableHead>
                <TableHead>{t('permits.items.columns.employee')}</TableHead>
                <TableHead>{t('permits.items.columns.zone')}</TableHead>
                <TableHead>{t('permits.items.columns.items')}</TableHead>
                <TableHead>{t('permits.items.columns.approval')}</TableHead>
                <TableHead>{t('permits.items.columns.created')}</TableHead>
                <TableHead className="w-16 text-end">{t('permits.columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <ItemPermitRow
                  key={row.id}
                  row={row}
                  highlighted={row.id === highlightedId}
                  onOpen={() => openPreview(row)}
                  prefetch={letterPrefetch(row.book_id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ItemPermitFormDialog
        open={formOpen}
        permit={editing}
        onOpenChange={(open) => {
          if (open) return
          setEditing(null)
          const created = createdRef.current
          createdRef.current = null
          if (created) {
            // Land on the new permit: one replace (not close + open, which would
            // race navigate(-1)). The entry loses its overlay marker, so closing the
            // preview stays on the cleared register with the new row highlighted.
            setLastCreated(created)
            setHighlightedId(created.id)
            toast.success(
              created.book_ref
                ? t('permits.items.createdToast', { ref: created.book_ref })
                : t('permits.items.createdToastNoRef'),
            )
            replaceSearch(['itemAction', 'iq', 'istatus'], { itemPreview: String(created.id) }, false)
          } else if (actionOverlay.value === 'new') {
            actionOverlay.close()
          }
        }}
        onSaved={(p) => {
          if (!editing) {
            createdRef.current = p
            return
          }
          // After editing from the detail dialog, keep the detail open on it.
          if (String(p.id) !== detailOverlay.value) detailOverlay.open(String(p.id))
        }}
      />
      {previewRow && detailId === null && (
        <PermitQuickView
          open
          onClose={() => previewOverlay.close()}
          reference={previewRow.book_ref ?? `#${previewRow.id}`}
          title={employeeName(previewRow, i18n.language)}
          status={previewRow.book_id ? <ApprovalBadge row={previewRow} /> : undefined}
          facts={[
            {
              label: t('permits.items.columns.employee'),
              value: (
                <span className="font-mono" dir="ltr">
                  {previewRow.employee_id}
                </span>
              ),
            },
            { label: t('permits.items.columns.zone'), value: <ItemZone row={previewRow} /> },
            { label: t('permits.items.columns.items'), value: <ItemsSummary row={previewRow} full /> },
            {
              label: t('permits.items.columns.created'),
              value: fmtLongDate(previewRow.created_at, i18n.language),
            },
          ]}
          bookId={previewRow.book_id ?? null}
          onOpenFull={() => detailOverlay.open(String(previewRow.id), { itemPreview: null })}
        />
      )}
      {detailId !== null && Number.isFinite(detailId) && (
        <ItemPermitDetailDialog
          permitId={detailId}
          open
          onOpenChange={(open) => !open && detailOverlay.close()}
          onNotFound={() => detailOverlay.close()}
          onEdit={(p) => setEditing(p)}
        />
      )}
    </>
  )
}

/** The permit's zone badges, one per zone — the one place zone rendering lives. */
function ItemZone({ row }: { row: ItemPermitRead }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1">
      {row.zones.map((z) => (
        <Badge key={z} tone={zoneTone(z)} shape="square">
          {t(`permits.zone.${z}`)}
        </Badge>
      ))}
    </div>
  )
}

function ApprovalBadge({ row }: { row: ItemPermitRead }): React.JSX.Element {
  const { t } = useTranslation()
  const approval = approvalOf(row)
  return <Badge tone={approvalTone(approval)}>{t(`permits.approval.${approval}`)}</Badge>
}

/** Item count + the first three names (row, card and quick view). */
function ItemsSummary({
  row,
  full = false,
}: {
  row: ItemPermitRead
  full?: boolean
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <>
      <div className="text-xs font-medium">{t('permits.items.count', { count: row.items.length })}</div>
      <div
        className={cn('text-xs text-muted-foreground', !full && 'max-w-[16rem] truncate')}
        dir="auto"
      >
        {row.items
          .slice(0, 3)
          .map((i) => i.name)
          .join(i18n.language.startsWith('ar') ? '، ' : ', ')}
        {row.items.length > 3 && ` ${t('permits.items.more', { count: row.items.length - 3 })}`}
      </div>
    </>
  )
}

function ItemPermitRow({
  row,
  highlighted,
  onOpen,
  prefetch,
}: {
  row: ItemPermitRead
  highlighted: boolean
  onOpen: () => void
  prefetch: PrefetchHandlers
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <TableRow
      className={cn(
        'cursor-pointer transition-colors duration-700 motion-reduce:transition-none',
        highlighted && 'bg-accent-soft',
      )}
      data-item-permit-id={row.id}
      tabIndex={-1}
      onClick={onOpen}
      {...prefetch}
    >
      <TableCell className="whitespace-nowrap font-mono text-xs">
        <bdi dir="ltr">{row.book_ref ?? '—'}</bdi>
      </TableCell>
      <TableCell>
        <div className="max-w-[14rem] truncate font-medium" dir="auto">
          {employeeName(row, i18n.language)}
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          <bdi dir="ltr">{row.employee_id}</bdi>
        </div>
      </TableCell>
      <TableCell>
        <ItemZone row={row} />
      </TableCell>
      <TableCell>
        <ItemsSummary row={row} />
      </TableCell>
      <TableCell>{row.book_id ? <ApprovalBadge row={row} /> : '—'}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {fmtLongDate(row.created_at, i18n.language)}
      </TableCell>
      {/* Keyboard-reachable open (the row's onClick is mouse-only). */}
      <TableCell className="w-16 text-end" onClick={(e) => e.stopPropagation()}>
        <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
          {t('permits.actions.view')}
        </Button>
      </TableCell>
    </TableRow>
  )
}

/** Mobile row: the whole card is one button (no tabIndex=-1 — it IS the keyboard target). */
function ItemPermitCard({
  row,
  highlighted,
  onOpen,
  prefetch,
}: {
  row: ItemPermitRead
  highlighted: boolean
  onOpen: () => void
  prefetch: PrefetchHandlers
}): React.JSX.Element {
  const { i18n } = useTranslation()
  return (
    <button
      type="button"
      data-item-permit-id={row.id}
      onClick={onOpen}
      {...prefetch}
      className={cn(
        'flex w-full flex-col gap-2 rounded-xl border border-border bg-surface p-3.5 text-start transition-colors duration-700',
        'hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        highlighted && 'bg-accent-soft',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground" dir="ltr">
          {row.book_ref ?? `#${row.id}`}
        </span>
        {row.book_id && <ApprovalBadge row={row} />}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">
          <bdi>{employeeName(row, i18n.language)}</bdi>
        </span>
        <span className="self-start font-mono text-xs text-muted-foreground" dir="ltr">
          {row.employee_id}
        </span>
      </div>
      <div>
        <ItemZone row={row} />
      </div>
      <div>
        <ItemsSummary row={row} />
      </div>
      <span className="text-xs text-muted-foreground">{fmtLongDate(row.created_at, i18n.language)}</span>
    </button>
  )
}
