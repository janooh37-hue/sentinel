import { ArrowLeft, ChevronRight, PackagePlus } from 'lucide-react'
import { type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import type { ArmoryBatchRead, ArmoryItemDetailRead, ArmoryPostingRef, ArmorySafeRead, ArmorySerialRead } from '@/lib/api'
import { Ltr } from '../ArmoryLtr'
import { displayDate, orgDateTime, serialStateKey, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, useArmoryAccess, useArmoryItem, useArmoryKits, useArmorySerial } from '../armoryQueries'
import { armoryLink, patchArmoryParams, readArmoryId } from '../armoryUrl'
import { ArmoryArt } from './ArmoryArt'
import type { ReceivePreset } from './intakeTypes'
import { RecordSerialsDialog } from './RecordSerialsDialog'
import { allowedSerialActions } from './serialActions'
import { SerialMovementDialog } from './SerialMovementDialog'

interface Props {
  itemId: number
  safeId: number | null
  safes: ArmorySafeRead[]
  onReceive(opener: HTMLElement, preset?: ReceivePreset): void
}

const STOCK_COLUMNS = [
  ['in_safe', 'inSafe', 'notCounted'], ['out_on_shift', 'onShift'], ['in_custody', 'inCustody'],
  ['in_repair', 'inRepair'], ['missing', 'serialState.missing'], ['lost', 'lost'], ['written_off', 'writtenOff'],
  ['received_qty', 'items.received'], ['opening_qty', 'openingStock', 'notCounted'], ['book_total', 'items.bookTotal', 'notCounted'],
] as const
const BATCH_LABEL = { expired: 'batchExpired', expiring: 'batchExpiring', valid: 'batchValid' } satisfies Record<ArmoryBatchRead['status'], string>
const STATE_TONE = {
  expired: 'bg-accent-soft text-destructive-text', expiring: 'bg-warning-soft text-warning', valid: 'bg-success-soft text-success',
} satisfies Record<ArmoryBatchRead['status'], string>

export function ItemDetail({ itemId, safeId, safes, onReceive }: Props) {
  const { canView, canEdit } = useArmoryAccess()
  const { t, isAr, name } = useArmoryLocale()
  const [params, setParams] = useSearchParams()
  const serialId = readArmoryId(params, 'serial')
  const item = useArmoryItem(itemId, safeId)
  const serial = useArmorySerial(serialId)
  const [pane, setPane] = useState('stock')
  const activePane = serialId !== null ? 'stock' : pane
  const heading = useRef<HTMLHeadingElement>(null)
  const register = useRef<HTMLTableElement>(null)
  const previousSerial = useRef<number | null>(null)
  const historyHeading = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const stock = item.data

  useLayoutEffect(() => {
    if (stock?.id) heading.current?.focus()
  }, [stock?.id])

  useLayoutEffect(() => {
    if (!stock) return
    if (serialId !== null && serialId !== previousSerial.current) historyHeading.current?.focus()
    if (serialId === null && previousSerial.current !== null) {
      const trigger = register.current?.querySelector<HTMLAnchorElement>(`[data-armory-serial="${previousSerial.current}"]`)
      const target = trigger ?? heading.current
      target?.focus()
    }
    previousSerial.current = serialId
  }, [serialId, stock])

  if (!canView) return null
  const hasSerials = stock?.kind === 'firearm' || stock?.kind === 'serial'
  const stockPaneLabel = hasSerials ? 'serialList' : stock?.kind === 'expiry' ? 'batches' : 'stockBySafe'
  const serialDetail = serial.data?.item.id === itemId ? serial.data : undefined

  function changePane(next: string) {
    setPane(next)
    if (serialId !== null && next !== 'stock') setParams(previous => patchArmoryParams(previous, { serial: null }), { replace: true })
  }

  return <div className="min-w-0 space-y-2">
    <Link to={{ search: patchArmoryParams(params, { item: null, serial: null }).toString() }} replace
      className="inline-flex min-h-11 items-center gap-2 rounded px-2 text-sm font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-ring">
      <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t('assets.armory.stockHome')}
    </Link>
    <section aria-labelledby={headingId} className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
      {item.isError ? <div className="space-y-2 p-4">
        <h2 id={headingId} className="font-semibold">{t('assets.armory.itemDetails')}</h2>
        <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(item.error)}</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void item.refetch()}>{t('assets.armory.retry')}</Button>
      </div> : !stock ? <div className="space-y-2 p-4">
        <h2 id={headingId} className="font-semibold">{t('assets.armory.itemDetails')}</h2>
        <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>
      </div> : <>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline p-3 sm:p-4">
          <div className="flex min-w-0 items-center gap-3">
            <ArmoryArt drawing={stock.drawing} className="h-12 w-[4.5rem] shrink-0" />
            <div className="min-w-0">
              <h2 id={headingId} ref={heading} tabIndex={-1} className="wrap-anywhere text-lg font-semibold outline-none"><bdi>{name(stock)}</bdi></h2>
              <bdi lang={isAr ? 'en' : 'ar'} className="block wrap-anywhere text-xs text-muted-foreground">{isAr ? stock.name_en : stock.name_ar}</bdi>
              <p className="text-xs text-muted-foreground">{t(`assets.armory.categoryName.${stock.category}`)} · {t(`assets.armory.kind_${stock.kind}`)}</p>
            </div>
          </div>
          {canEdit ? <div className="space-y-1">
            <Button type="button" className="min-h-11" disabled={!safes.length} aria-describedby={!safes.length ? `${headingId}-safe` : undefined}
              onClick={event => onReceive(event.currentTarget, { itemId, ...(safeId === null ? {} : { safeId }) })}>
              <PackagePlus aria-hidden />{t('assets.armory.receiveStock')}
            </Button>
            {!safes.length ? <p id={`${headingId}-safe`} className="text-xs text-muted-foreground">{t('assets.armory.noSafesEditor')}</p> : null}
          </div> : null}
          <div role="group" aria-label={t('assets.armory.itemDetails')} className="flex w-full flex-wrap gap-1">
            {([['stock', stockPaneLabel], ['kits', 'kitLinks'], ['history', 'stockHistory']] as const).map(([value, label]) => <Button key={value} type="button"
              aria-pressed={activePane === value} variant={activePane === value ? 'secondary' : 'ghost'} className="min-h-11 flex-1 whitespace-normal sm:flex-none"
              onClick={() => changePane(value)}>{t(`assets.armory.${label}`)}</Button>)}
          </div>
        </header>
        {activePane === 'kits' ? <KitLinks item={stock} /> : activePane === 'history' ? <MovementList title={t('assets.armory.stockHistory')} movements={stock.recent_movements} safes={safes} /> : <>
          <StockBySafe item={stock} fallbackFocusRef={heading} canEdit={canEdit} />
          {hasSerials ? <SerialRegister serials={stock.serials} selectedId={serialId} tableRef={register} onSelect={() => setPane('stock')} /> : null}
          {serialId !== null ? <section className="space-y-3 border-t border-hairline bg-surface-raised p-3 sm:p-4" aria-labelledby={`${headingId}-serial`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 ref={historyHeading} tabIndex={-1} id={`${headingId}-serial`} className="font-semibold outline-none">
                {t('assets.armory.items.serialHistory')}{serialDetail ? <>: <Ltr className="font-mono wrap-anywhere">{serialDetail.serial_code}</Ltr></> : null}
              </h3>
              <Link replace to={{ search: patchArmoryParams(params, { serial: null }).toString() }}
                className="inline-flex min-h-11 items-center rounded px-2 text-sm font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                {t('assets.armory.items.closeSerialHistory')}
              </Link>
            </div>
            {/* A failed background refetch keeps the cached serial (and an open movement draft) mounted. */}
            {serial.isError && !serialDetail ? <>
              <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(serial.error)}</p>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => void serial.refetch()}>{t('assets.armory.retry')}</Button>
            </> : serialDetail ? <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <div><dt className="text-xs text-muted-foreground">{t('assets.armory.status')}</dt><dd><SerialStatus serial={serialDetail} /></dd></div>
                  <div><dt className="text-xs text-muted-foreground">{t('assets.armory.safe')}</dt><dd>{serialDetail.safe ? <bdi>{name(serialDetail.safe)}</bdi> : t('assets.armory.notApplicable')}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{t('assets.armory.holder')}</dt><dd><Holder holder={serialDetail.holder} /></dd></div>
                  {serialDetail.state_at ? <div><dt className="text-xs text-muted-foreground">{t('assets.armory.since')}</dt><dd><Ltr>{orgDateTime(serialDetail.state_at)}</Ltr></dd></div> : null}
                </dl>
                {canEdit ? <SerialMovementAction key={serialId} serial={serialDetail} safes={safes} fallbackFocusRef={historyHeading} /> : null}
              </div>
              <MovementList title={t('assets.armory.recentMovements')} movements={serialDetail.recent_movements} safes={safes} inline />
            </> : serial.isPending ? <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>
              : <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.errors.notFound.serial')}</p>}
          </section> : null}
          {stock.kind === 'expiry' ? <BatchList batches={stock.batches} /> : null}
        </>}
      </>}
    </section>
  </div>
}

function StockBySafe({ item, fallbackFocusRef, canEdit }: { item: ArmoryItemDetailRead; fallbackFocusRef: RefObject<HTMLElement | null>; canEdit: boolean }) {
  const { t, name } = useArmoryLocale()
  const heading = useId()
  const hasUnrecorded = item.stock.some(row => (row.unrecorded_qty ?? 0) > 0)
  return <section aria-labelledby={heading} className="border-b border-hairline">
    <h3 id={heading} className="px-3 pt-3 pb-2 font-semibold sm:px-4">{t('assets.armory.stockBySafe')}</h3>
    {!item.stock.length ? <p className="px-3 pb-3 text-sm text-muted-foreground sm:px-4">{t('assets.armory.noSafesTitle')}</p> : <>
      <table role="table" aria-labelledby={heading} className="w-full table-fixed border-collapse text-sm">
        <colgroup className="hidden xl:table-column-group"><col className="w-[14%]" />{STOCK_COLUMNS.map(([field]) => <col key={field} />)}</colgroup>
        <thead className="sr-only xl:not-sr-only"><tr className="border-b border-hairline text-xs text-muted-foreground">
          <th scope="col" className="px-3 py-2 text-start font-medium sm:px-4">{t('assets.armory.safe')}</th>
          {STOCK_COLUMNS.map(([field, label]) => <th scope="col" key={field} className="wrap-anywhere px-2 py-2 text-end font-medium">{t(`assets.armory.${label}`)}</th>)}
        </tr></thead>
        <tbody role="rowgroup">
          {item.stock.map(row => <tr role="row" key={row.safe.id} className="grid grid-cols-2 gap-2 border-b border-hairline px-3 py-2 sm:grid-cols-3 sm:px-4 lg:grid-cols-5 xl:table-row xl:p-0">
            <th role="rowheader" scope="row" className="col-span-full wrap-anywhere text-start font-semibold xl:px-4 xl:py-2"><bdi>{name(row.safe)}</bdi></th>
            {STOCK_COLUMNS.map(([field, label, nullLabel]) => <td role="cell" key={field} className="wrap-anywhere text-start tabular-nums xl:px-2 xl:py-2 xl:text-end">
              <span className="block text-xs text-muted-foreground xl:hidden">{t(`assets.armory.${label}`)}</span>
              {row[field] === null ? <span className="text-xs text-muted-foreground">{t(`assets.armory.${nullLabel ?? 'notApplicable'}`)}</span> : <Ltr>{row[field]}</Ltr>}
              {field === 'in_safe' && row.in_safe === null && row.known_in_safe > 0 ? <span className="block text-xs text-muted-foreground">{t('assets.armory.items.knownInSafeN', { count: row.known_in_safe })}</span> : null}
            </td>)}
          </tr>)}
        </tbody>
      </table>
      {canEdit ? <RegistrationActions item={item} fallbackFocusRef={fallbackFocusRef} /> : hasUnrecorded ? <UnrecordedRows item={item} /> : null}
    </>}
  </section>
}

function UnrecordedRows({ item, renderAction }: { item: ArmoryItemDetailRead; renderAction?(safeId: number): React.ReactNode }) {
  const { t, name } = useArmoryLocale()
  return <ul className="divide-y divide-hairline bg-surface-raised">
    {item.stock.map(({ safe, unrecorded_qty: count }) => count !== null && count > 0 ? <li key={safe.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm sm:px-4">
      <div className="flex flex-wrap items-center gap-2"><bdi>{name(safe)}</bdi><span className="rounded bg-warning-soft px-2 py-1 text-xs text-warning">{t('assets.armory.unrecordedN', { count })}</span></div>
      {renderAction?.(safe.id)}
    </li> : null)}
  </ul>
}

function RegistrationActions({ item, fallbackFocusRef }: { item: ArmoryItemDetailRead; fallbackFocusRef: RefObject<HTMLElement | null> }) {
  const { t } = useArmoryLocale()
  const [safeId, setSafeId] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const opener = useRef<HTMLElement>(null)
  return <>
    {item.stock.some(row => (row.unrecorded_qty ?? 0) > 0) ? <UnrecordedRows item={item} renderAction={id => <Button type="button" variant="outline" className="min-h-11"
      onClick={event => { opener.current = event.currentTarget; setSaved(false); setSafeId(id) }}>{t('assets.armory.recordSerials')}</Button>} /> : null}
    {safeId !== null ? <RecordSerialsDialog open item={item} initialSafeId={safeId} onOpenChange={open => { if (!open) setSafeId(null) }}
      onSaved={() => setSaved(true)} returnFocusRef={opener} fallbackFocusRef={fallbackFocusRef} /> : null}
    {saved ? <p role="status" className="px-3 py-2 text-sm text-success sm:px-4">{t('assets.armory.savedSerials')}</p> : null}
  </>
}

function SerialRegister({ serials, selectedId, tableRef, onSelect }: { serials: ArmorySerialRead[]; selectedId: number | null; tableRef: RefObject<HTMLTableElement | null>; onSelect(): void }) {
  const { t, name } = useArmoryLocale()
  const [params] = useSearchParams()
  const heading = useId()
  return <section aria-labelledby={heading} className="min-w-0">
    <h3 id={heading} className="px-3 pt-3 pb-2 font-semibold sm:px-4">{t('assets.armory.serialList')}</h3>
    {!serials.length ? <p className="px-3 pb-3 text-sm text-muted-foreground sm:px-4">{t('assets.armory.noSerials')}</p> : <table role="table" ref={tableRef} aria-labelledby={heading} className="w-full table-fixed border-collapse text-sm">
      <thead className="sr-only md:not-sr-only"><tr className="border-b border-hairline text-xs text-muted-foreground">
        {['serialNumber', 'status', 'safe', 'holder', 'since'].map(label => <th key={label} scope="col" className="px-3 py-2 text-start font-medium">{t(`assets.armory.${label}`)}</th>)}
      </tr></thead>
      <tbody role="rowgroup">
        {serials.map(serial => <tr key={serial.id} role="row" className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 border-b border-hairline px-3 py-1 md:table-row md:p-0 ${selectedId === serial.id ? 'bg-primary-soft' : 'hover:bg-surface-raised'}`}>
          <th role="rowheader" scope="row" className="min-w-0 text-start md:px-3"><Link aria-current={serial.id === selectedId ? 'true' : undefined} data-armory-serial={serial.id}
            to={{ search: patchArmoryParams(params, { serial: serial.id }).toString() }} onClick={onSelect}
            className="flex min-h-11 items-center gap-1 rounded font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            <Ltr className="font-mono wrap-anywhere">{serial.serial_code}</Ltr><ChevronRight aria-hidden className="size-4 shrink-0 rtl:-scale-x-100" />
          </Link></th>
          <td role="cell" className="min-w-0 text-start md:px-3"><SerialStatus serial={serial} /></td>
          <td role="cell" className="wrap-anywhere text-muted-foreground md:px-3">{serial.safe ? <bdi>{name(serial.safe)}</bdi> : t('assets.armory.notApplicable')}</td>
          <td role="cell" className="wrap-anywhere text-muted-foreground md:px-3"><Holder holder={serial.holder} /></td>
          <td role="cell" className="col-span-2 wrap-anywhere text-xs text-muted-foreground md:px-3">{serial.state_at ? <Ltr>{orgDateTime(serial.state_at)}</Ltr> : t('assets.armory.notApplicable')}</td>
        </tr>)}
      </tbody>
    </table>}
  </section>
}

function SerialStatus({ serial }: { serial: ArmorySerialRead }) {
  const { t, overdue } = useArmoryLocale()
  const tone = serial.state === 'missing' || serial.state === 'lost' ? 'bg-accent-soft text-destructive-text'
    : serial.state === 'in_repair' ? 'bg-warning-soft text-warning' : 'bg-surface-tinted text-muted-foreground'
  return <div className="flex flex-wrap gap-1 py-1 text-xs">
    <span className={`rounded px-1.5 py-0.5 ${tone}`}>{serial.state ? t(serialStateKey(serial.state)) : t('assets.armory.items.serialVoided')}</span>
    {serial.overdue_minutes !== null ? <span className="rounded bg-accent-soft px-1.5 py-0.5 text-destructive-text">{overdue(serial.overdue_minutes)}</span> : null}
  </div>
}

function Holder({ holder }: { holder: ArmorySerialRead['holder'] }) {
  const { t, name } = useArmoryLocale()
  const record = holder?.employee ?? holder?.site_safe
  const employee = holder?.employee ?? holder?.supervisor
  if (!record) return t('assets.armory.notApplicable')
  return <><bdi>{name(record)}</bdi>{employee ? <> · {holder?.supervisor ? <bdi>{name(employee)} </bdi> : null}<Ltr>{employee.employee_id}</Ltr></> : null}</>
}

function SerialMovementAction({ serial, safes, fallbackFocusRef }: { serial: ArmorySerialRead; safes: ArmorySafeRead[]; fallbackFocusRef: RefObject<HTMLElement | null> }) {
  const { t } = useArmoryLocale()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  return <div className="space-y-1">
    {allowedSerialActions(serial).length ? <Button ref={opener} type="button" variant="outline" className="min-h-11"
      onClick={() => { setSaved(false); setOpen(true) }}>{t('assets.armory.changeState')}</Button> : null}
    {open ? <SerialMovementDialog open serial={serial} safes={safes} onOpenChange={setOpen} onSaved={() => setSaved(true)}
      returnFocusRef={opener} fallbackFocusRef={fallbackFocusRef} /> : null}
    {saved ? <p role="status" className="text-sm text-success">{t('assets.armory.savedState')}</p> : null}
  </div>
}

function KitLinks({ item }: { item: ArmoryItemDetailRead }) {
  const { t } = useArmoryLocale()
  const kits = useArmoryKits()
  const matches = kits.data?.filter(kit => kit.firearm_item?.id === item.id || item.optional_kit_ids.includes(kit.id) || kit.lines.some(line => line.item.id === item.id))
  return <div className="space-y-2 p-3 text-sm sm:p-4">
    {kits.isError ? <>
      <p role="alert" className="text-destructive-text">{armoryErrorMessage(kits.error)}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => void kits.refetch()}>{t('assets.armory.retry')}</Button>
    </> : !matches ? <p role="status" className="text-muted-foreground">{t('assets.armory.loadingText')}</p> : matches.length
      ? <ul className="divide-y divide-hairline">{matches.map(kit => <li key={kit.id} className="py-2">{t(`assets.armory.kitName.${kit.code}`)}</li>)}</ul>
      : <p className="text-muted-foreground">{t('assets.armory.noKits')}</p>}
  </div>
}

function BatchList({ batches }: { batches: ArmoryBatchRead[] }) {
  const { t, name } = useArmoryLocale()
  const heading = useId()
  return <section aria-labelledby={heading} className="space-y-2 p-3 sm:p-4">
    <h3 id={heading} className="font-semibold">{t('assets.armory.batches')}</h3>
    {batches.length ? <ul className="divide-y divide-hairline">
      {batches.map(({ batch, safe, on_hand, status }) => <li key={`${batch.id}:${safe.id}`} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
        <div className="min-w-0 space-y-1">
          <Ltr className="block font-mono font-medium wrap-anywhere">{batch.batch_ref}</Ltr>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <bdi>{name(safe)}</bdi><span>{t('assets.armory.batchExpiry')}: <Ltr>{displayDate(batch.expires_on)}</Ltr></span><span>{t('assets.armory.inSafe')}: <Ltr>{on_hand}</Ltr></span>
          </div>
        </div>
        <span className={`rounded px-2 py-1 text-xs ${STATE_TONE[status]}`}>{t(`assets.armory.${BATCH_LABEL[status]}`)}</span>
      </li>)}
    </ul> : <p className="text-sm text-muted-foreground">{t('assets.armory.noBatches')}</p>}
  </section>
}

function MovementList({ title, movements, safes, inline = false }: { title: string; movements: ArmoryPostingRef[]; safes: ArmorySafeRead[]; inline?: boolean }) {
  const { t, name } = useArmoryLocale()
  const heading = useId()
  const safeById = new Map(safes.map(safe => [safe.id, safe]))
  return <section aria-labelledby={heading} className={inline ? 'border-t border-hairline pt-3' : 'p-3 sm:p-4'}>
    <h3 id={heading} className="mb-2 font-semibold">{title}</h3>
    {movements.length ? <ul className="divide-y divide-hairline">
      {movements.map(movement => {
        const safe = safeById.get(movement.safe_id)
        return <li key={movement.id}>
          <Link to={armoryLink('audit', { pane: 'movements', movement: movement.id })}
            className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded py-2 text-sm hover:bg-surface-tinted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_auto_auto]">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-medium text-primary-text">
              {t(`assets.armory.postingKind.${movement.kind}`)} <Ltr className="font-mono">{movement.record_ref}</Ltr>
              {movement.voided_at ? <span className="rounded bg-surface-tinted px-1.5 py-0.5 text-xs text-muted-foreground">{t('assets.armory.assignmentState.voided')}</span> : null}
            </span>
            <span className="col-start-1 row-start-2 min-w-0 wrap-anywhere text-xs text-muted-foreground sm:col-start-auto sm:row-start-auto">{safe ? <bdi>{name(safe)}</bdi> : null}</span>
            <Ltr className="col-start-2 row-start-2 text-end text-xs text-muted-foreground sm:col-start-auto sm:row-start-auto">{movement.occurred_at ? orgDateTime(movement.occurred_at) : displayDate(movement.occurred_on)}</Ltr>
            <ChevronRight aria-hidden className="col-start-2 row-start-1 size-4 justify-self-end text-muted-foreground sm:col-start-auto sm:row-start-auto rtl:-scale-x-100" />
          </Link>
        </li>
      })}
    </ul> : <p className="text-sm text-muted-foreground">{t('assets.armory.noHistory')}</p>}
  </section>
}
