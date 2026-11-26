import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { ArmoryMovementFilters, ArmoryPostingRead } from '@/lib/api'
import { cn, normalizeDigits } from '@/lib/utils'
import { displayDate, Ltr, orgTime, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, useArmoryAccess, useArmoryMovements } from '../armoryQueries'
import { patchArmoryParams, readArmoryId } from '../armoryUrl'
import { ArmoryMovementDetail } from './ArmoryMovementDetail'

const POSTING_KINDS = [
  'opening', 'receipt', 'serial_registration', 'shift_issue', 'custody', 'return',
  'shift_check', 'monthly_count', 'serial_state', 'decision',
] as const satisfies readonly ArmoryPostingRead['kind'][]

const FILTER_KEYS = ['kind', 'from', 'to', 'serial', 'q', 'employee_id', 'item'] as const

type FilterKey = (typeof FILTER_KEYS)[number]

export function AuditMovements({ safeId }: { safeId: number | null }): React.JSX.Element {
  const { canView, principal } = useArmoryAccess()
  return canView && principal !== null ? <MovementBrowser key={principal} safeId={safeId} /> : <></>
}

function MovementBrowser({ safeId }: { safeId: number | null }) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const movementId = readArmoryId(params, 'movement')
  const listHeading = useRef<HTMLHeadingElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLAnchorElement | null>(null)
  const listBeforeOpen = useRef<string | null>(null)
  const previousMovement = useRef<number | null>(null)
  const rangeErrorId = useId()
  const [filtersInitiallyOpen] = useState(() => FILTER_KEYS.some((name) => Boolean(params.get(name))))

  useLayoutEffect(() => {
    if (previousMovement.current === movementId) return
    previousMovement.current = movementId
    if (movementId !== null) {
      detailHeading.current?.focus()
    } else {
      (opener.current?.isConnected ? opener.current : listHeading.current)?.focus()
      opener.current = null
      listBeforeOpen.current = null
    }
  }, [movementId])

  const kind = POSTING_KINDS.find((kind) => kind === params.get('kind'))
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const serial = params.get('serial') ?? ''
  const q = params.get('q') ?? ''
  const employeeId = params.get('employee_id') ?? ''
  const item = params.get('item') ?? ''
  const invalidRange = Boolean(from && to && from > to)
  const filters: ArmoryMovementFilters = {
    safe_id: safeId ?? undefined,
    kind,
    from: from || undefined,
    to: to || undefined,
    serial: serial.trim() || undefined,
    q: q.trim() || undefined,
    employee_id: employeeId.trim() || undefined,
    item_id: readArmoryId(params, 'item') ?? undefined,
    page: readArmoryId(params, 'page') ?? 1,
  }

  function setFilter(name: FilterKey, value: string) {
    setParams((current) => patchArmoryParams(current, { [name]: value || null, page: null }), { replace: true })
  }

  function setPage(page: number) {
    setParams((current) => patchArmoryParams(current, { page: page > 1 ? page : null }))
  }

  function closeDetail() {
    const next = patchArmoryParams(params, { movement: null })
    if (next.toString() === listBeforeOpen.current) void navigate(-1)
    else setParams(next, { replace: true })
  }

  return (
    <div className={cn('grid min-w-0 items-start gap-4', movementId !== null && 'md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]')}>
      <section className={cn('min-w-0 rounded-xl border border-border bg-surface', movementId !== null && 'hidden md:block')} aria-label={t('assets.armory.log')}>
        <header className="space-y-1 px-4 pb-3 pt-4">
          <h3 ref={listHeading} tabIndex={-1} className="font-semibold">{t('assets.armory.log')}</h3>
          <p className="text-sm text-muted-foreground">{t('assets.armory.logHint')}</p>
        </header>
        <details className="group border-y border-border px-4" open={filtersInitiallyOpen}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal aria-hidden className="size-4 text-muted-foreground" />
            {t('assets.armory.eventFilters')}
            <ChevronDown aria-hidden className="ms-auto size-4 text-muted-foreground group-open:rotate-180" />
          </summary>
          <div className={cn('grid grid-cols-2 gap-3 pb-4', movementId === null && 'lg:grid-cols-3')}>
            <label className="min-w-0 space-y-1 text-sm">
              <span>{t('assets.armory.dateFrom')}</span>
              <Input type="date" dir="ltr" className="min-h-11" value={from} onChange={(event) => setFilter('from', event.target.value)} aria-invalid={invalidRange || undefined} aria-describedby={invalidRange ? rangeErrorId : undefined} />
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              <span>{t('assets.armory.dateTo')}</span>
              <Input type="date" dir="ltr" className="min-h-11" value={to} onChange={(event) => setFilter('to', event.target.value)} aria-invalid={invalidRange || undefined} aria-describedby={invalidRange ? rangeErrorId : undefined} />
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              <span>{t('assets.armory.eventType')}</span>
              <select className="block min-h-11 w-full rounded-md border border-input bg-surface px-3 text-foreground" value={kind ?? ''} onChange={(event) => setFilter('kind', event.target.value)}>
                <option value="">{t('assets.armory.allEvents')}</option>
                {POSTING_KINDS.map((value) => <option key={value} value={value}>{t(`assets.armory.postingKind.${value}`)}</option>)}
              </select>
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              <span>{t('assets.armory.serialNumber')}</span>
              <Input type="search" dir="ltr" className="min-h-11" maxLength={80} value={serial} onChange={(event) => setFilter('serial', event.target.value)} />
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              <span>{t('assets.armory.searchGuard')}</span>
              <Input type="search" dir="auto" className="min-h-11" maxLength={120} value={q} onChange={(event) => setFilter('q', event.target.value)} />
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              <span>{t('assets.armory.movementsPane.itemId')}</span>
              <Input dir="ltr" inputMode="numeric" className="min-h-11" value={item} onChange={(event) => setFilter('item', normalizeDigits(event.target.value).replace(/\D/g, ''))} />
            </label>
            {employeeId && (
              <div className="col-span-full flex flex-wrap items-center gap-x-2 text-sm">
                <span>{t('assets.armory.movementsPane.employeeId')}</span>
                <Ltr className="font-medium">{employeeId}</Ltr>
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => setFilter('employee_id', '')}>{t('assets.armory.clearSearch')}</Button>
              </div>
            )}
          </div>
        </details>
        {invalidRange ? (
          <p id={rangeErrorId} role="alert" className="px-4 py-3 text-sm text-destructive-text">{t('assets.armory.dateRangeInvalid')}</p>
        ) : (
          <MovementResults filters={filters} params={params} movementId={movementId} onPageChange={setPage}
            onOpen={(element) => {
              opener.current = element
              if (movementId === null) listBeforeOpen.current = params.toString()
            }} />
        )}
      </section>
      {movementId !== null && (
        <section className="min-w-0 rounded-xl border border-border bg-surface" aria-label={t('assets.armory.movementsPane.detail')}>
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
            <h3 ref={detailHeading} tabIndex={-1} className="font-semibold">{t('assets.armory.movementsPane.detail')}</h3>
            <Button type="button" variant="ghost" className="min-h-11" onClick={closeDetail}>
              <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
              {t('assets.armory.back')}
            </Button>
          </header>
          <ArmoryMovementDetail key={movementId} postingId={movementId} safeId={safeId} focusFallback={detailHeading} />
        </section>
      )}
    </div>
  )
}

function MovementResults({ filters, params, movementId, onPageChange, onOpen }: {
  filters: ArmoryMovementFilters
  params: URLSearchParams
  movementId: number | null
  onPageChange(page: number): void
  onOpen(element: HTMLAnchorElement): void
}) {
  const { t, name } = useArmoryLocale()
  const query = useArmoryMovements(filters)
  if (query.error) return (
    <div className="space-y-2 p-4 text-sm">
      <p role="alert" className="text-destructive-text">{armoryErrorMessage(query.error)}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => void query.refetch()}>{t('assets.armory.retry')}</Button>
    </div>
  )
  if (!query.data) return (
    <div role="status" className="space-y-3 p-4">
      <span className="sr-only">{t('assets.armory.loadingText')}</span>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  )
  const { items, total, page, page_size } = query.data
  const pages = Math.max(1, Math.ceil(total / page_size))
  return (
    <>
      <p role="status" className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
        <Trans i18nKey="assets.armory.movementsPane.logCount" count={total} components={{ count: <bdi dir="ltr" className="tabular-nums" /> }} />
      </p>
      {items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t('assets.armory.noLog')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((posting) => {
            const next = patchArmoryParams(params, { movement: posting.id })
            const selected = posting.id === movementId
            return (
              <li key={posting.id}>
                <Link to={{ search: next.toString() }} replace={movementId !== null} aria-current={selected ? 'true' : undefined}
                  className={cn('grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected && 'bg-surface-tinted')}
                  onClick={(event) => {
                    if (!event.defaultPrevented && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) onOpen(event.currentTarget)
                  }}>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Ltr className="font-semibold [overflow-wrap:anywhere]">{posting.record_ref}</Ltr>
                    <span>{t(`assets.armory.postingKind.${posting.kind}`)}</span>
                    {posting.voided_at && <Badge tone="danger" className="normal-case tracking-normal">{t('assets.armory.movementsPane.voided')}</Badge>}
                  </span>
                  <ChevronRight aria-hidden className="size-4 justify-self-end text-muted-foreground rtl:-scale-x-100" />
                  <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    <bdi>{name(posting.safe)}</bdi>
                    {posting.destination_safe && (
                      <span className="ms-1 inline-flex max-w-full items-center gap-1">
                        <ChevronRight aria-hidden className="size-3 shrink-0 rtl:-scale-x-100" />
                        <span className="sr-only">{t('assets.armory.destination')}</span>
                        <bdi>{name(posting.destination_safe)}</bdi>
                      </span>
                    )}
                  </span>
                  <Ltr className="text-end text-xs tabular-nums text-muted-foreground">
                    {displayDate(posting.occurred_on)}{posting.occurred_at && ` ${orgTime(posting.occurred_at)}`}
                  </Ltr>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {(pages > 1 || page > 1) && (
        <nav aria-label={t('assets.armory.movementsPane.pagination')} className="flex flex-wrap items-center justify-between gap-1 border-t border-border px-2 py-1 text-sm">
          <Button type="button" variant="ghost" className="min-h-11" disabled={page <= 1} onClick={() => onPageChange(Math.min(page - 1, pages))}>
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />{t('assets.armory.movementsPane.previousPage')}
          </Button>
          <span className="text-muted-foreground">
            <Trans i18nKey="assets.armory.movementsPane.pageOf" values={{ page, pages }} components={{ page: <bdi dir="ltr" />, pages: <bdi dir="ltr" /> }} />
          </span>
          <Button type="button" variant="ghost" className="min-h-11" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
            {t('assets.armory.movementsPane.nextPage')}<ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
          </Button>
        </nav>
      )}
    </>
  )
}
