import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ArmoryCountFilters } from '@/lib/api'
import { Ltr } from '../ArmoryLtr'
import { useArmoryLocale } from '../armoryFormat'
import { useArmoryCount, useArmoryCounts, useArmorySafes, useArmoryShift } from '../armoryQueries'
import { patchArmoryParams, readArmoryId } from '../armoryUrl'
import { MonthlyCountDialog } from './MonthlyCountDialog'
import { CountResult, CountWindow } from './auditCountResult'
import { AuditLoadError, AuditLoading, AuditMonth, AuditPageControls, AuditPostingTime } from './auditDisplay'

type CountKind = NonNullable<ArmoryCountFilters['kind']>
const selectClass = 'min-h-11 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground'
const recordLink = 'inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline underline-offset-4'

export function AuditCounts({ safeId, canEdit }: { safeId: number | null; canEdit: boolean }) {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const id = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const newCountRef = useRef<HTMLButtonElement>(null)
  const countId = readArmoryId(params, 'count')
  const previousDetail = useRef(countId)
  const [kind, setKind] = useState<CountKind | ''>('')
  const [month, setMonth] = useState('')
  const [page, setPage] = useState(1)
  const [createForSafe, setCreateForSafe] = useState<number | 'choose' | null>(null)
  if (countId !== null && createForSafe !== null) setCreateForSafe(null)

  useEffect(() => {
    if (previousDetail.current === countId) return
    const previous = previousDetail.current
    previousDetail.current = countId
    const rowLink = countId === null && previous !== null ? document.getElementById(`${id}-count-${previous}`) : null
    const destination = rowLink ?? headingRef.current
    destination?.focus()
  }, [countId, id])

  function closeCreate() {
    setCreateForSafe(null)
    requestAnimationFrame(() => newCountRef.current?.focus())
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 ref={headingRef} id={`${id}-heading`} tabIndex={-1} className="font-semibold tracking-tight">{t('assets.armory.checkRecords')}</h2>
        {countId !== null ? (
          <Link to={`?${patchArmoryParams(params, { count: null })}`} className={recordLink}>{t('assets.armory.back')}</Link>
        ) : canEdit && (
          <Button ref={newCountRef} type="button" className="min-h-11" aria-expanded={safeId === null ? createForSafe === 'choose' : undefined} onClick={() => setCreateForSafe(safeId ?? 'choose')}>
            {t('assets.armory.newCount')}
          </Button>
        )}
      </header>
      {countId !== null ? <CountDetail countId={countId} /> : (
        <>
          {canEdit && createForSafe === 'choose' && <CountSafeChooser onChoose={setCreateForSafe} onCancel={closeCreate} />}
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface px-3 py-2">
            <label className="grid min-w-0 gap-1 text-sm font-medium">
              {t('assets.armory.auditPane.countKind')}
              <select value={kind} className={selectClass} onChange={(event) => {
                const value = event.target.value
                setKind(value === 'shift_check' || value === 'monthly_count' ? value : '')
                setPage(1)
              }}>
                <option value="">{t('assets.armory.all')}</option>
                <option value="shift_check">{t('assets.armory.shiftChecks')}</option>
                <option value="monthly_count">{t('assets.armory.monthlyCounts')}</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-medium">
              {t('assets.armory.auditPane.month')}
              <Input type="month" dir="ltr" className="min-h-11 tabular-nums" value={month} onChange={(event) => { setMonth(event.target.value); setPage(1) }} />
            </label>
            {month && <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setMonth(''); setPage(1) }}>{t('assets.armory.auditPane.clearMonth')}</Button>}
          </div>
          {!month && kind !== 'monthly_count' && <ShiftHistory safeId={safeId} params={params} />}
          <CountList
            filters={{ ...(safeId === null ? {} : { safe_id: safeId }), ...(kind ? { kind } : {}), ...(month ? { month } : {}), page }}
            params={params}
            linkPrefix={id}
            onPage={setPage}
          />
        </>
      )}
      {canEdit && countId === null && typeof createForSafe === 'number' && (
        <MonthlyCountDialog safeId={createForSafe} open onClose={closeCreate} />
      )}
    </section>
  )
}

function CountList({ filters, params, linkPrefix, onPage }: {
  filters: ArmoryCountFilters
  params: URLSearchParams
  linkPrefix: string
  onPage(page: number): void
}) {
  const { t, name } = useArmoryLocale()
  const query = useArmoryCounts(filters)
  if (query.isError) return <AuditLoadError error={query.error} onRetry={() => void query.refetch()} />
  if (!query.data) return <AuditLoading />

  return (
    <>
      {query.data.items.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-4 text-sm text-muted-foreground">
          {t(filters.kind === 'monthly_count' && !filters.month ? 'assets.armory.noCounts' : 'assets.armory.auditPane.noMatchingCounts')}
        </p>
      ) : (
        <ul className="divide-y divide-hairline rounded-lg border border-border bg-surface">
          {query.data.items.map(({ posting, safe, window, month }) => (
            <li key={posting.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
              <div className="min-w-0 wrap-anywhere">
                <p className="font-medium">{t(`assets.armory.postingKind.${posting.kind}`)}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <bdi>{name(safe)}</bdi>
                  {window && <span>{t(`assets.armory.shiftKind.${window.shift_kind}`)}</span>}
                  {month ? <AuditMonth value={month} /> : <AuditPostingTime posting={posting} />}
                  {posting.voided_at && <span className="font-medium">{t('assets.armory.discrepancyStatus.voided')}</span>}
                </div>
              </div>
              <Link id={`${linkPrefix}-count-${posting.id}`} to={`?${patchArmoryParams(params, { pane: 'counts', count: posting.id })}`} className={recordLink}>
                <Ltr className="font-mono">{posting.record_ref}</Ltr>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <AuditPageControls page={query.data.page} pageSize={query.data.page_size} total={query.data.total} onPage={onPage} />
    </>
  )
}

function CountDetail({ countId }: { countId: number }) {
  const query = useArmoryCount(countId)
  if (query.isError) return <AuditLoadError error={query.error} onRetry={() => void query.refetch()} />
  if (!query.data) return <AuditLoading />
  return <article className="rounded-lg border border-border bg-surface p-4"><CountResult count={query.data} /></article>
}

function ShiftHistory({ safeId, params }: { safeId: number | null; params: URLSearchParams }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <details className="rounded-md border border-border bg-surface" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer px-3 py-2 text-sm font-semibold">{t('assets.armory.checkHistory')}</summary>
      {open && <CheckSlots safeId={safeId} params={params} />}
    </details>
  )
}

function CheckSlots({ safeId, params }: { safeId: number | null; params: URLSearchParams }) {
  const { t, name } = useArmoryLocale()
  const query = useArmoryShift(safeId)
  if (query.isError) return <div className="p-3"><AuditLoadError error={query.error} onRetry={() => void query.refetch()} /></div>
  if (!query.data) return <AuditLoading />
  const safes = query.data.safes.filter(({ check_history }) => check_history.length > 0)
  if (safes.length === 0) return <p className="px-3 pb-3 text-sm text-muted-foreground">{t('assets.armory.auditPane.noCheckSlots')}</p>
  return (
    <div className="space-y-3 border-t border-hairline p-3">
      {safes.map(({ safe, check_history }) => (
        <section key={safe.id}>
          <h3 className="mb-1 text-sm font-semibold"><bdi>{name(safe)}</bdi></h3>
          <ul className="divide-y divide-hairline">
            {check_history.map(({ window, status, count_id, missing_count }) => (
              <li key={window.starts_at} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <CountWindow window={window} />
                <span className="font-medium">
                  {t(status === 'due' ? 'assets.armory.checkDue' : status === 'missed' ? 'assets.armory.checkMissed' : 'assets.armory.done')}
                </span>
                {missing_count !== null && missing_count > 0 && (
                  <span className="text-destructive-text">{t('assets.armory.auditPane.missingInCheck')} <Ltr className="tabular-nums">{missing_count}</Ltr></span>
                )}
                {count_id !== null && (
                  <Link to={`?${patchArmoryParams(params, { pane: 'counts', count: count_id })}`} className={recordLink}>
                    {t('assets.armory.viewRecord')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function CountSafeChooser({ onChoose, onCancel }: { onChoose(safeId: number): void; onCancel(): void }) {
  const { t, name } = useArmoryLocale()
  const query = useArmorySafes()
  const selectRef = useRef<HTMLSelectElement>(null)
  const [selected, setSelected] = useState('')
  const selectedSafe = query.isError ? undefined : query.data?.find((safe) => String(safe.id) === selected)
  const canSelect = !query.isError && Boolean(query.data?.length)
  useEffect(() => { if (canSelect) selectRef.current?.focus() }, [canSelect])

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-raised p-3"
      onSubmit={(event) => { event.preventDefault(); if (selectedSafe) onChoose(selectedSafe.id) }}
    >
      {query.isError ? <AuditLoadError error={query.error} onRetry={() => void query.refetch()} /> : !query.data ? <AuditLoading /> : !query.data.length ? (
        <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.noSafesTitle')}</p>
      ) : (
        <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium">
          {t('assets.armory.safe')}
          <select ref={selectRef} value={selected} className={selectClass} onChange={(event) => setSelected(event.target.value)}>
            <option value="">{t('assets.armory.chooseSafe')}</option>
            {query.data.map((safe) => <option key={safe.id} value={safe.id}>{name(safe)}</option>)}
          </select>
        </label>
      )}
      <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>{t('assets.armory.cancel')}</Button>
      {canSelect && <Button type="submit" className="min-h-11" disabled={!selectedSafe}>{t('assets.armory.next')}</Button>}
    </form>
  )
}
