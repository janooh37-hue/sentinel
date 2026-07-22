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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Plus, Printer, ShieldCheck, Paperclip } from 'lucide-react'
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
import { useCapabilities } from '@/lib/useCapabilities'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { PermitFormDialog } from './PermitFormDialog'
import { PermitDetailDialog } from './PermitDetailDialog'
import { ZoneBadge } from './ZoneBadge'
import { fmtDate, statusTone } from './permitUtils'

const STATE_OPTIONS = ['', 'valid', 'active', 'expiring', 'expired', 'revoked'] as const
const ZONE_OPTIONS: ('' | PermitZone)[] = ['', 'green', 'red', 'work_residence']

const selectCls =
  'h-9 rounded-md border border-input bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function PermitsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const canManage = has('permits.manage')

  const [state, setState] = useState<string>('')
  const [zone, setZone] = useState<string>('')
  const [q, setQ] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PermitRead | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
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
    setFormOpen(true)
  }

  const tiles: { key: string; label: string; value: number; tone: string }[] = summary
    ? [
        { key: 'active', label: t('permits.summary.active'), value: summary.active, tone: 'text-success' },
        { key: 'expiring', label: t('permits.summary.expiring'), value: summary.expiring, tone: 'text-warning' },
        { key: 'expired', label: t('permits.summary.expired'), value: summary.expired, tone: 'text-destructive' },
        { key: 'green', label: t('permits.summary.peopleGreen'), value: summary.people_green, tone: 'text-success' },
        { key: 'red', label: t('permits.summary.peopleRed'), value: summary.people_red, tone: 'text-destructive' },
        { key: 'work', label: t('permits.summary.peopleWork'), value: summary.people_work_residence, tone: 'text-info' },
      ]
    : []

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
              {t('permits.title')}
            </h1>
            <div className="mt-1 hidden text-[0.86em] text-muted-foreground md:block">
              {t('permits.subtitle')}
            </div>
          </div>
          <RefreshButton />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6" data-print-hide>
        {/* Summary tiles */}
        {tiles.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map((tile) => (
              <div key={tile.key} className="rounded-xl border border-border bg-surface px-3 py-2.5">
                <div className={`text-2xl font-bold ${tile.tone}`}>{tile.value}</div>
                <div className="text-[0.72rem] leading-tight text-muted-foreground">{tile.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className={selectCls} value={state} onChange={(e) => setState(e.target.value)} aria-label={t('permits.filters.state')}>
            {STATE_OPTIONS.map((s) => (
              <option key={s || 'all'} value={s}>
                {s === '' ? t('permits.filters.all') : s === 'valid' ? t('permits.filters.valid') : t(`permits.status.${s}`)}
              </option>
            ))}
          </select>
          <select className={selectCls} value={zone} onChange={(e) => setZone(e.target.value)} aria-label={t('permits.filters.zone')}>
            {ZONE_OPTIONS.map((z) => (
              <option key={z || 'all'} value={z}>
                {z === '' ? t('permits.filters.all') : t(`permits.zone.${z}`)}
              </option>
            ))}
          </select>
          <input
            className={`${selectCls} min-w-[12rem] flex-1`}
            placeholder={t('permits.filters.search')}
            value={q}
            dir="auto"
            onChange={(e) => setQ(e.target.value)}
          />

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
            {canManage && (
              <Button type="button" size="sm" onClick={openNew}>
                <Plus className="me-1.5 h-4 w-4" aria-hidden />
                {t('permits.new')}
              </Button>
            )}
          </div>
        </div>

        {/* Table / states */}
        {listQuery.isError ? (
          <p className="py-8 text-center text-sm text-destructive">{t('permits.loadError')}</p>
        ) : listQuery.isLoading ? (
          <div className="overflow-hidden rounded-xl border border-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} cols={7} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            message={filtersActive ? t('permits.empty') : t('permits.emptyRegister')}
            {...(!filtersActive && canManage
              ? { actionLabel: t('permits.new'), onAction: openNew }
              : {})}
          />
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
                    onToggle={() => toggleOne(row.id)}
                    onOpen={() => setDetailId(row.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
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
        onOpenChange={setFormOpen}
        onSaved={(p) => {
          // After editing from the detail dialog, keep the detail open on it.
          if (editing) setDetailId(p.id)
        }}
      />
      {detailId !== null && (
        <PermitDetailDialog
          permitId={detailId}
          open={detailId !== null}
          onOpenChange={(o) => !o && setDetailId(null)}
          onEdit={(p) => {
            setEditing(p)
            setFormOpen(true)
          }}
        />
      )}
    </div>
  )
}

function PermitRowView({
  row,
  selected,
  onToggle,
  onOpen,
}: {
  row: PermitListItem
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const remaining =
    row.derived_status === 'revoked' || row.days_remaining === null
      ? null
      : row.days_remaining < 0
        ? t('permits.expiredOn', { date: fmtDate(row.end_date) })
        : row.days_remaining === 0
          ? t('permits.endsToday')
          : t('permits.daysLeft', { count: row.days_remaining })

  return (
    <TableRow className={`cursor-pointer ${selected ? 'bg-primary-soft/40' : ''}`} onClick={onOpen}>
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
        {row.permit_no ?? `#${row.id}`}
        {row.has_document && (
          <Paperclip className="ms-1.5 inline h-3 w-3 align-middle text-muted-foreground" aria-label={t('permits.paper.attached')} />
        )}
      </TableCell>
      <TableCell className="max-w-[14rem] truncate font-medium" dir="auto">
        {row.company}
      </TableCell>
      <TableCell>
        <ZoneBadge zones={row.zones} square />
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        <span dir="ltr">
          {fmtDate(row.start_date)} → {fmtDate(row.end_date)}
        </span>
        {remaining && <span className="ms-2 not-italic">· {remaining}</span>}
      </TableCell>
      <TableCell className="text-end tabular-nums">{row.people_count}</TableCell>
      <TableCell className="text-end tabular-nums">{row.vehicle_count}</TableCell>
      <TableCell>
        <Badge tone={statusTone(row.derived_status)}>{t(`permits.status.${row.derived_status}`)}</Badge>
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
    <div className="hidden bg-white p-0 text-black print:block">
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
  const { t } = useTranslation()
  const people = permit.people.filter((p) => p.removed_at === null)
  const vehicles = permit.vehicles.filter((v) => v.removed_at === null)
  return (
    <section className="break-inside-avoid border border-neutral-400">
      {/* Facts strip */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-neutral-400 bg-neutral-100 px-2 py-1 text-[10px]">
        <span className="font-mono text-[11px] font-bold">{permit.permit_no ?? `#${permit.id}`}</span>
        <span className="text-[11px] font-semibold" dir="auto">{permit.company}</span>
        <span>{permit.zones.map((z) => t(`permits.zone.${z}Short`)).join(' + ')}</span>
        <span className="font-mono" dir="ltr">
          {fmtDate(permit.start_date)} → {fmtDate(permit.end_date)}
        </span>
        <span>{t('permits.duration', { count: permit.duration_days })}</span>
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
