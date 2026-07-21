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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Plus, Printer, Download, ShieldCheck, Paperclip } from 'lucide-react'

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
import { RefreshButton } from '@/components/refresh/RefreshButton'
import { useCapabilities } from '@/lib/useCapabilities'
import { PermitFormDialog } from './PermitFormDialog'
import { PermitDetailDialog } from './PermitDetailDialog'
import { ZoneBadge } from './ZoneBadge'
import { fmtDate, statusTone } from './permitUtils'

const STATE_OPTIONS = ['', 'valid', 'active', 'expiring', 'expired', 'revoked'] as const
const ZONE_OPTIONS: ('' | PermitZone)[] = ['', 'green', 'red', 'both']

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

  const params = useMemo(
    () => ({ state: state || undefined, zone: (zone || undefined) as PermitZone | undefined, q: q || undefined }),
    [state, zone, q],
  )

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

  const openNew = (): void => {
    setEditing(null)
    setFormOpen(true)
  }

  const tiles: { key: string; label: string; value: number; tone: string }[] = summary
    ? [
        { key: 'active', label: t('permits.summary.active'), value: summary.active, tone: 'text-success' },
        { key: 'expiring', label: t('permits.summary.expiring'), value: summary.expiring, tone: 'text-warning' },
        { key: 'expired', label: t('permits.summary.expired'), value: summary.expired, tone: 'text-destructive' },
        { key: 'green', label: t('permits.summary.peopleGreen'), value: summary.people_green, tone: 'text-foreground' },
        { key: 'red', label: t('permits.summary.peopleRed'), value: summary.people_red, tone: 'text-foreground' },
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

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
        {/* Summary tiles */}
        {tiles.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
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
            <a href={api.permitsExportUrl(params)} className="inline-flex">
              <Button type="button" variant="outline" size="sm">
                <Download className="me-1.5 h-4 w-4" aria-hidden />
                {t('permits.export')}
              </Button>
            </a>
            <Button type="button" variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
              <Printer className="me-1.5 h-4 w-4" aria-hidden />
              {t('permits.print')}
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
        ) : rows.length === 0 && !listQuery.isLoading ? (
          <EmptyState icon={ShieldCheck} message={t('permits.empty')} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('permits.columns.permitNo')}</TableHead>
                  <TableHead>{t('permits.columns.company')}</TableHead>
                  <TableHead>{t('permits.columns.zone')}</TableHead>
                  <TableHead>{t('permits.columns.window')}</TableHead>
                  <TableHead className="text-end">{t('permits.columns.people')}</TableHead>
                  <TableHead>{t('permits.columns.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <PermitRowView key={row.id} row={row} onOpen={() => setDetailId(row.id)} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

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

function PermitRowView({ row, onOpen }: { row: PermitListItem; onOpen: () => void }): React.JSX.Element {
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
    <TableRow className="cursor-pointer" onClick={onOpen}>
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
        <ZoneBadge zone={row.zone} square />
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {fmtDate(row.start_date)} → {fmtDate(row.end_date)}
        {remaining && <span className="ms-2 not-italic">· {remaining}</span>}
      </TableCell>
      <TableCell className="text-end tabular-nums">{row.people_count}</TableCell>
      <TableCell>
        <Badge tone={statusTone(row.derived_status)}>{t(`permits.status.${row.derived_status}`)}</Badge>
      </TableCell>
    </TableRow>
  )
}
