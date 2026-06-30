/**
 * Records inner tab.
 *
 * Desktop (≥ md): the Annual Report view (`report/LeavesReport`) — masthead,
 * figure folio, insight line, register table. It owns its own fetch and
 * loading / empty / error states.
 *
 * Mobile (< md): unchanged — sticky search + FilterSheet (RecordsFilterBar
 * `variant="sheet"`) over a virtualized card list, with the LeaveDetailDrawer
 * for row taps and status transitions.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, X } from 'lucide-react'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { LeaveListItem, LeaveRead, LeaveStatus } from '@/lib/api'
import { splitBilingual } from '@/lib/bilingualValue'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterSheet } from '@/components/ui/filter-sheet'
import { Input } from '@/components/ui/input'
import { SkeletonRow } from '@/components/ui/skeleton'
import { actionsFor, displayState, lifecycleGroup } from './lifecycle'
import { NationalServiceDialog } from './NationalServiceDialog'
import { NsControls } from './NsControls'
import { ReturnFormDialog } from './ReturnFormDialog'
import { StatusBadge } from './StatusBadge'
import { LeaveEmployeePicker } from './LeaveEmployeePicker'
import { leaveEmployeeName } from './leaveEmployeeName'
import { LeavesReport } from './report/LeavesReport'
import { SendWhatsAppButton } from '@/components/whatsapp/SendWhatsAppButton'
import { SendSmsButton } from '@/components/sms/SendSmsButton'

// ─── types ──────────────────────────────────────────────────────────────────

const ALL_STATUSES: LeaveStatus[] = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Completed']

interface Filters {
  employeeId: string | null
  statuses: LeaveStatus[]
  leaveType: string
  fromDate: string
  toDate: string
  q: string
}

const DEFAULT_FILTERS: Filters = {
  employeeId: null,
  statuses: [],
  leaveType: '',
  fromDate: '',
  toDate: '',
  q: '',
}

// ─── RecordsFilterBar ────────────────────────────────────────────────────────

function RecordsFilterBar({
  filters,
  onChange,
  variant = 'bar',
}: {
  filters: Filters
  onChange: (f: Filters) => void
  /**
   * `'bar'` (default) — the desktop surface pill. `'sheet'` — rendered inside
   * the mobile FilterSheet: no pill chrome, stacked vertically, full-width /
   * tap-sized controls.
   */
  variant?: 'bar' | 'sheet'
}): React.JSX.Element {
  const { t } = useTranslation()
  const isSheet = variant === 'sheet'

  function toggleStatus(s: LeaveStatus): void {
    const next = filters.statuses.includes(s)
      ? filters.statuses.filter((x) => x !== s)
      : [...filters.statuses, s]
    onChange({ ...filters, statuses: next })
  }

  const hasFilters =
    !!filters.employeeId ||
    filters.statuses.length > 0 ||
    !!filters.leaveType ||
    !!filters.fromDate ||
    !!filters.toDate ||
    !!filters.q

  return (
    <div
      className={cn(
        isSheet
          ? 'flex flex-col gap-4'
          : 'flex flex-wrap items-center gap-2 rounded-2xl bg-surface px-3 py-2',
      )}
      data-testid="leaves-filter-bar"
    >
      {/* Employee picker */}
      <div className={cn(isSheet && '[&_>*]:w-full')}>
        <LeaveEmployeePicker
          selectedId={filters.employeeId}
          onSelect={(id) => onChange({ ...filters, employeeId: id })}
        />
      </div>

      {/* Status multi-toggle chips */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="status-filter">
        {ALL_STATUSES.map((s) => {
          const isActive = filters.statuses.includes(s)
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              aria-pressed={isActive}
              className={cn(
                'inline-flex items-center rounded-full px-3 py-1 text-[0.78em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background max-md:min-h-[36px] max-md:py-1.5',
                isActive
                  ? 'bg-primary-soft font-semibold text-primary'
                  : 'bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
              )}
            >
              {t(`leaves.status.${s}`)}
            </button>
          )
        })}
      </div>

      {/* Date range — side-by-side in the sheet, inline on the bar */}
      <div
        className={cn(
          isSheet ? 'grid grid-cols-2 items-center gap-2' : 'contents',
        )}
      >
        <input
          type="date"
          aria-label={t('leaves.filters.from')}
          value={filters.fromDate}
          onChange={(e) => onChange({ ...filters, fromDate: e.target.value })}
          className={cn(
            'rounded-full border border-hairline bg-surface px-3 font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isSheet ? 'h-11 w-full text-sm' : 'h-8 text-[0.78em]',
          )}
        />
        {!isSheet && <span className="text-xs text-muted-foreground">—</span>}
        <input
          type="date"
          aria-label={t('leaves.filters.to')}
          value={filters.toDate}
          onChange={(e) => onChange({ ...filters, toDate: e.target.value })}
          className={cn(
            'rounded-full border border-hairline bg-surface px-3 font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isSheet ? 'h-11 w-full text-sm' : 'h-8 text-[0.78em]',
          )}
        />
      </div>

      {/* Text search — hidden in the sheet (the page keeps a sticky search field) */}
      {!isSheet && (
        <Input
          placeholder={t('leaves.filters.search')}
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          className="h-8 w-[180px] rounded-full border-hairline bg-surface text-[0.85em]"
        />
      )}

      {/* Clear */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className={cn(
            'gap-1 rounded-full text-[0.78em] text-muted-foreground',
            isSheet ? 'h-11 w-full' : 'h-8',
          )}
        >
          <X className="h-3.5 w-3.5" />
          {t('leaves.filters.clear')}
        </Button>
      )}
    </div>
  )
}

// ─── MobileLeaveList (virtualized) ───────────────────────────────────────────

// Cards are roughly ~136px (id/status row + name + type + dates). measureElement
// reconciles wrapping.
const MOBILE_CARD_ESTIMATE = 136

function MobileLeaveList({
  rows,
  onRowClick,
}: {
  rows: LeaveListItem[]
  onRowClick: (id: number) => void
}): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => MOBILE_CARD_ESTIMATE,
    overscan: 6,
  })

  return (
    <div ref={parentRef} className="h-full overflow-auto pb-24">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          if (!row) return null
          return (
            <div
              key={row.id}
              ref={virtualizer.measureElement}
              data-index={vi.index}
              style={{
                position: 'absolute',
                top: 0,
                insetInlineStart: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 8,
              }}
            >
              <LeaveMobileCard row={row} onRowClick={onRowClick} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── LeaveMobileCard ─────────────────────────────────────────────────────────

function LeaveMobileCard({
  row,
  onRowClick,
}: {
  row: LeaveListItem
  onRowClick: (id: number) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onRowClick(row.id)}
      className="flex w-full flex-col gap-2 rounded-2xl border border-hairline bg-surface p-3.5 text-start transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* top row: id + status */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.78em] text-muted-foreground">#{row.id}</span>
        <StatusBadge status={row.status} leaveType={row.leave_type} endDate={row.end_date} hasCertificate={row.has_certificate} />
      </div>

      {/* employee name + id */}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[0.85em] font-medium text-foreground">
          {leaveEmployeeName(row, i18n.language)}
        </span>
        <span className="truncate font-mono text-[0.72em] text-muted-foreground">
          {row.employee_id}
        </span>
      </div>

      {/* leave type */}
      <span className="text-[0.85em] text-foreground">
        {t(`leaves.type.${row.leave_type}`, {
          defaultValue: splitBilingual(row.leave_type, i18n.language),
        })}
      </span>

      {/* dates + days */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.78em] text-muted-foreground">
        <span>{row.start_date}</span>
        <span>—</span>
        <span>{row.end_date}</span>
        <span className="ms-auto tabular-nums">
          {row.days} {t('leaves.columns.days')}
        </span>
      </div>
    </button>
  )
}

// ─── LeaveDetailDrawer ───────────────────────────────────────────────────────

function LeaveDetailDrawer({
  leaveId,
  onClose,
  onMutated,
}: {
  leaveId: number
  onClose: () => void
  onMutated: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const detailQuery = useQuery({
    queryKey: ['leave', leaveId],
    queryFn: () => api.getLeave(leaveId),
  })

  const leave: LeaveRead | undefined = detailQuery.data

  const updateMutation = useMutation({
    mutationFn: ({ status, n }: { status: LeaveStatus; n: string }) =>
      api.updateLeave(leaveId, { status, notes: n || undefined }),
    onSuccess: (_data, { status }) => {
      void qc.invalidateQueries({ queryKey: ['leave', leaveId] })
      void qc.invalidateQueries({ queryKey: ['leaves-list'] })
      if (status === 'Approved') toast.success(t('leaves.toast.approved'))
      else if (status === 'Rejected') toast.success(t('leaves.toast.rejected'))
      else if (status === 'Cancelled') toast.success(t('leaves.toast.cancelled'))
      else toast.success(t('common.savedToast'))
      onMutated()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteLeave(leaveId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leaves-list'] })
      toast.success(t('leaves.toast.deleted'))
      onClose()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  // Lifecycle-driven actions (derived from the loaded leave detail).
  const isNs = leave ? lifecycleGroup(leave.leave_type) === 'ns' : false
  const hasCertificate = !!leave?.certificate_path
  const acts = leave ? actionsFor(leave.leave_type, leave.status, leave.end_date, today, hasCertificate) : []
  const hasRequestActions =
    acts.includes('approve') || acts.includes('reject') || acts.includes('cancel')
  const awaitingCert =
    leave != null &&
    isNs &&
    displayState(leave.leave_type, leave.status, leave.end_date, today, hasCertificate) === 'AwaitingCertificate'

  return (
    <>
    {/* Overlay */}
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t('leaves.columns.id') + ' ' + String(leaveId)}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-hairline bg-surface px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">
            <span className="font-mono">#{leaveId}</span>
            <span className="ms-2 text-muted-foreground">{t('leaves.columns.id')}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {detailQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : !leave ? null : (
          <div className="flex flex-1 flex-col gap-5 p-5">
            {/* Fields */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {([
                ['leaves.columns.employee', leaveEmployeeName(leave, i18n.language)],
                ['leaves.columns.leaveType', t(`leaves.type.${leave.leave_type}`, { defaultValue: splitBilingual(leave.leave_type, i18n.language) })],
                ['leaves.columns.startDate', leave.start_date],
                ['leaves.columns.endDate', leave.end_date],
                ['leaves.columns.days', String(leave.days)],
                ['leaves.columns.status', undefined],
              ] as Array<[string, string | undefined]>).map(([labelKey, val]) => (
                <div key={labelKey} className="flex flex-col gap-0.5">
                  <dt className="text-[0.7em] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {t(labelKey)}
                  </dt>
                  <dd>
                    {labelKey === 'leaves.columns.status' ? (
                      <StatusBadge status={leave.status} leaveType={leave.leave_type} endDate={leave.end_date} hasCertificate={hasCertificate} />
                    ) : (
                      <span className="font-mono text-[0.9em]">{val}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {/* Notes — shown for request actions */}
            {hasRequestActions && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[0.7em] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('leaves.report.notes')}
                </label>
                <textarea
                  rows={3}
                  value={notes || leave.notes || ''}
                  onChange={(e) => setNotes(e.target.value)}
                  className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}

            {/* Request action buttons: Approve / Reject / Cancel */}
            {hasRequestActions && (
              <div className="flex flex-wrap gap-2">
                {acts.includes('approve') && (
                  <Button
                    size="sm"
                    onClick={() => updateMutation.mutate({ status: 'Approved', n: notes })}
                    disabled={updateMutation.isPending}
                    className="rounded-full"
                  >
                    {t('leaves.actions.approve')}
                  </Button>
                )}
                {acts.includes('reject') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => updateMutation.mutate({ status: 'Rejected', n: notes })}
                    disabled={updateMutation.isPending}
                    className="rounded-full"
                  >
                    {t('leaves.actions.reject')}
                  </Button>
                )}
                {acts.includes('cancel') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => updateMutation.mutate({ status: 'Cancelled', n: notes })}
                    disabled={updateMutation.isPending}
                    className="rounded-full"
                  >
                    {t('leaves.report.cancel')}
                  </Button>
                )}
              </div>
            )}

            {/* File return form */}
            {acts.includes('return') && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => setReturnOpen(true)}
                  className="rounded-full"
                >
                  {t('leaves.report.fileReturn')}
                </Button>
              </div>
            )}

            {/* WhatsApp notifications */}
            {leave.status === 'Approved' && (
              <SendWhatsAppButton eventType="leave_approved" recordId={leave.id} />
            )}
            {(!!leave.return_date || !!leave.return_doc_path) && (
              <SendWhatsAppButton eventType="duty_resumption" recordId={leave.id} />
            )}
            {/* SMS notifications */}
            {leave.status === 'Approved' && (
              <SendSmsButton eventType="leave_approved" recordId={leave.id} />
            )}
            {(!!leave.return_date || !!leave.return_doc_path) && (
              <SendSmsButton eventType="duty_resumption" recordId={leave.id} />
            )}

            {/* NS controls: Delay / Extend / Certificate.
                Also rendered for Completed NS rows with a certificate so the
                user can always access View certificate. */}
            {isNs && (acts.length > 0 || hasCertificate) && (
              <div className="border-t border-hairline pt-3">
                <NsControls
                  row={leave}
                  hasCertificate={hasCertificate}
                  awaitingCert={awaitingCert}
                  onMutated={onMutated}
                />
              </div>
            )}

            {/* Delete */}
            <div className="mt-auto border-t border-hairline pt-4">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-accent">
                    {t('leaves.actions.confirmDelete')}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-full"
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-full bg-accent text-white hover:bg-accent-hover"
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                  >
                    {t('leaves.actions.softDelete')}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full text-accent hover:text-accent"
                  onClick={() => setConfirmDelete(true)}
                >
                  {t('common.delete')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    {leave && (
      <ReturnFormDialog
        open={returnOpen}
        leave={leave}
        onOpenChange={setReturnOpen}
        onFiled={onMutated}
      />
    )}
    </>
  )
}

// ─── TabRecords ──────────────────────────────────────────────────────────────

export function TabRecords(): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // In-memory so leaving the page resets filters/search (no stale state on return).
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Desktop deep-link token — consumed by LeavesReport (expand + center the
  // row), then handed back through `onOpenConsumed`.
  const [desktopOpenId, setDesktopOpenId] = useState<number | null>(null)
  const handleOpenConsumed = useCallback(() => setDesktopOpenId(null), [])

  // National Service create dialog — opened when ?ns=new arrives in the URL
  // (from the Services gallery tile). The param is stripped immediately so
  // refresh / back-nav don't re-open the dialog.
  const [nsDialogOpen, setNsDialogOpen] = useState(false)

  // Deep-link: when `?open=<leave_id>` is in the URL (e.g. coming from the
  // dashboard "On leave today" row), open that leave — desktop report
  // expansion at ≥768px, mobile detail drawer below — and strip the param so
  // refresh / back-nav land cleanly. Viewport is evaluated once, at the time
  // the param is consumed (no reactive listener; a deep-link arrives with a
  // settled viewport). Mirrors the URL-param-hydration pattern from
  // ApplicationPage.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const nsParam = searchParams.get('ns')
    if (nsParam === 'new') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL-param hydration
      setNsDialogOpen(true)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('ns')
          return next
        },
        { replace: true },
      )
      return
    }
    const openParam = searchParams.get('open')
    if (!openParam) return
    const parsed = Number.parseInt(openParam, 10)
    if (Number.isFinite(parsed)) {
      if (window.matchMedia('(min-width: 768px)').matches) {
        setDesktopOpenId(parsed)
      } else {
        setSelectedId(parsed)
      }
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('open')
        return next
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Build query params. Text search (`q`) is resolved server-side now — see
  // leave_service.list_leaves. The `q` key isn't yet in the generated
  // api.listLeaves param type (see report), so it's attached via a widened
  // object; `qs()` spreads it into the querystring regardless.
  //
  // NOTE: both leaves-list queries — this mobile one (limit: 200) and the
  // report's (limit: 500, in useLeaveReport) — deliberately run on ALL
  // viewports: the panes are only CSS-hidden (`max-md:hidden` / `md:hidden`),
  // so both stay mounted. If this duplicate fetch ever matters, gate each
  // query's `enabled` on a media query (or lazy-mount the hidden pane).
  const params = {
    employee_id: filters.employeeId ?? undefined,
    status: filters.statuses.length === 1 ? filters.statuses[0] : undefined,
    leave_type: filters.leaveType || undefined,
    from_date: filters.fromDate || undefined,
    to_date: filters.toDate || undefined,
    q: filters.q.trim() || undefined,
    limit: 200,
  }

  const listQuery = useQuery({
    queryKey: ['leaves-list', params],
    queryFn: () =>
      api.listLeaves(params as Parameters<typeof api.listLeaves>[0]),
  })

  // Multi-status selection still narrows client-side: the backend takes a
  // single `status` value, so when 2+ chips are active we fetch unfiltered by
  // status and filter the union here.
  let rows: LeaveListItem[] = listQuery.data?.items ?? []
  if (filters.statuses.length > 1) {
    rows = rows.filter((r) => filters.statuses.includes(r.status as LeaveStatus))
  }

  const hasFilters =
    !!filters.employeeId ||
    filters.statuses.length > 0 ||
    !!filters.leaveType ||
    !!filters.fromDate ||
    !!filters.toDate ||
    !!filters.q.trim()

  // Count of active filter controls behind the mobile Filters sheet (text
  // search lives in the always-visible sticky field and is counted separately).
  const activeFilterCount = [
    !!filters.employeeId,
    filters.statuses.length > 0,
    !!filters.leaveType,
    !!filters.fromDate || !!filters.toDate,
  ].filter(Boolean).length

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden px-4 pb-6 pt-3 md:gap-3 md:px-6 md:pt-4">
      {/* Desktop — the Annual Report view (own fetch + loading/empty states) */}
      <div className="max-md:hidden h-full overflow-auto">
        <LeavesReport openId={desktopOpenId} onOpenConsumed={handleOpenConsumed} />
      </div>

      {/* Mobile filter row — sticky search + Filters bottom-sheet trigger */}
      <div className="md:hidden flex items-center gap-2">
        <Input
          placeholder={t('leaves.filters.search')}
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          className="h-11 min-w-0 flex-1 rounded-full border-hairline bg-surface text-sm"
        />
        <FilterSheet
          title={t('leaves.filters.title')}
          triggerLabel={t('leaves.filters.button')}
          activeCount={activeFilterCount}
        >
          <RecordsFilterBar filters={filters} onChange={setFilters} variant="sheet" />
        </FilterSheet>
      </div>

      {/* Result count — folded into the list top edge to keep the list dominant. */}
      <div className="md:hidden -mb-1 px-1">
        <span className="font-mono text-[0.72em] text-muted-foreground">
          {listQuery.isPending
            ? t('common.loading')
            : `${rows.length} / ${listQuery.data?.total ?? 0}`}
        </span>
      </div>

      {/* Mobile list pane — desktop loading/empty states live in LeavesReport */}
      <div className="md:hidden flex-1 overflow-hidden">
        {listQuery.isPending ? (
          <div className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} cols={7} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-hairline bg-surface">
            <EmptyState
              icon={CalendarDays}
              message={hasFilters ? t('leaves.empty') : t('leaves.emptyUnfiltered')}
            />
          </div>
        ) : (
          <div className="h-full">
            <MobileLeaveList rows={rows} onRowClick={(id) => setSelectedId(id)} />
          </div>
        )}
      </div>

      {selectedId !== null && (
        <LeaveDetailDrawer
          leaveId={selectedId}
          onClose={() => setSelectedId(null)}
          onMutated={() => {
            void qc.invalidateQueries({ queryKey: ['leaves-list'] })
          }}
        />
      )}

      <NationalServiceDialog
        open={nsDialogOpen}
        onClose={() => setNsDialogOpen(false)}
        onCreated={(id) => {
          setNsDialogOpen(false)
          // The ?open= effect fires on the next render and deep-opens the record
          // (desktop expand or mobile drawer depending on viewport).
          setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('open', String(id)); return next }, { replace: true })
        }}
      />
    </div>
  )
}
