import { useState, type RefObject } from 'react'
import { Plus } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { StoreItemArt } from '@/components/StoreItemArt'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import type { StoreBatchRead, StoreDashboard, StoreItemRead, StoreMovementRead } from '@/lib/api'
import { categoryName, formatExpiry, itemName, splitBase, type StoreUnits } from '../storeUtils'
import { HandoverForm, ItemQuantityStepper, type HandoverDraft } from './HandoverTray'
import { MovementRow } from './MovementRow'
import { StoreQuantity } from './RecordParts'
import { ItemStatus } from './StoreShelves'
import { availableStock } from './storeShelfModel'

/** Pins read in whole Counting units ("5", or "1+" with loose pieces left) like the count sheet. */
function ExpiryTimeline({ batches, item, windowDays }: { batches: StoreBatchRead[]; item: StoreUnits; windowDays: number }) {
  const { t } = useTranslation()
  const pinLabel = (quantity: number) => {
    const { units, loose } = splitBase(quantity, item)
    return units === 0 && loose > 0 ? '<1' : `${units}${loose > 0 ? '+' : ''}`
  }
  const pins: { position: number; quantity: number; soon: boolean }[] = []
  for (const batch of [...batches].filter(batch => batch.days_to_expiry != null && batch.days_to_expiry >= 0).sort((a, b) => a.days_to_expiry! - b.days_to_expiry!)) {
    const position = Math.min(100, batch.days_to_expiry! / 180 * 100)
    const last = pins[pins.length - 1]
    if (last && position - last.position < 7) { last.quantity += batch.on_hand; last.soon ||= batch.days_to_expiry! <= windowDays }
    else pins.push({ position, quantity: batch.on_hand, soon: batch.days_to_expiry! <= windowDays })
  }
  if (!pins.length) return null
  return <div aria-hidden className="relative mb-8 mt-10 h-5 rounded bg-surface-tinted"><div className="absolute inset-y-0 start-0 rounded bg-warning-soft" style={{ width: `${Math.min(100, windowDays / 180 * 100)}%` }} />{[0, windowDays, 120, 180].map(day => <span key={day} className="absolute top-6 text-[10px] text-muted-foreground" style={{ insetInlineStart: `${Math.min(93, day / 180 * 100)}%` }}>{day === 0 ? t('assets.store.dashboard.today') : <bdi dir="ltr">{day === 180 ? '180+' : day}</bdi>}</span>)}{pins.map(pin => <span key={pin.position} className={`absolute bottom-1 flex flex-col items-center text-xs ${pin.soon ? 'text-warning' : 'text-primary-text'}`} style={{ insetInlineStart: `${Math.min(95, pin.position)}%` }}><bdi dir="ltr">{pinLabel(pin.quantity)}</bdi><span className="h-3 w-3 rounded-full bg-current" /></span>)}</div>
}

export function ItemDrawer({ item, batches, dashboard, movements, editable, open = true, returnFocusRef, draft, onDraftChange, onClose, onAddMulti, onMovement, onDisposal }: {
  item: StoreItemRead
  batches: StoreBatchRead[]
  dashboard: StoreDashboard
  movements: StoreMovementRead[]
  editable: boolean
  open?: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  draft?: HandoverDraft
  onDraftChange?: (draft: HandoverDraft) => void
  onClose: () => void
  onAddMulti: (item: StoreItemRead, quantity: number) => void
  onMovement: (movement: StoreMovementRead) => void
  onDisposal: () => void
}) {
  const { t, i18n } = useTranslation()
  const [requested, setRequested] = useState(1)
  const [busy, setBusy] = useState(false)
  const stock = batches.filter(batch => batch.item_id === item.id && batch.on_hand > 0).sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999'))
  const maximum = availableStock(item.id, stock)
  const quantity = Math.min(requested, maximum)
  const first = stock.find(batch => batch.days_to_expiry == null || batch.days_to_expiry >= 0)
  const capacity = Math.max((item.minimum_level ?? 1) * 2.5, item.on_hand, 1)
  const suggestion = dashboard.suggestions.find(row => row.item_id === item.id)
  const usage = dashboard.usage.rows.find(row => row.item_id === item.id)?.values.filter((value): value is number => value != null)
  const average = usage?.length ? usage.reduce((sum, value) => sum + value, 0) / usage.length : null
  return <Sheet open={open} onOpenChange={nextOpen => { if (!nextOpen && !busy) onClose() }}><SheetContent returnFocusRef={returnFocusRef} onCloseAutoFocus={event => { if (!open) event.preventDefault() }} aria-describedby={undefined} className="start-auto end-0 w-full max-w-[460px] overflow-hidden p-0 data-[state=open]:animate-none data-[state=closed]:animate-none">
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-surface p-4"><SheetTitle dir="auto" className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{itemName(item, i18n.language)}</SheetTitle><SheetClose asChild><Button variant="secondary" className="min-h-11 shrink-0" disabled={busy}>{t('common.close')}</Button></SheetClose></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
    <article className="space-y-5 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3"><StoreItemArt kind={item.art_kind} color={item.art_color} categoryId={item.category_id} size={100} /><div className="min-w-0 flex-1"><p className="mt-1 text-xs text-muted-foreground"><bdi dir="ltr">{item.code}</bdi> · {categoryName(item.category, i18n.language)}</p><p className="my-3 text-xl font-semibold"><StoreQuantity value={item.on_hand} item={item} /></p>
        <div aria-hidden className="relative h-2 rounded bg-surface-tinted"><div className="h-full rounded bg-primary" style={{ width: `${Math.max(0, item.on_hand) / capacity * 100}%` }} />{item.minimum_level != null && <span className="absolute -top-1 h-4 w-0.5 bg-foreground" style={{ insetInlineStart: `${item.minimum_level / capacity * 100}%` }} />}</div>
        <p className="my-2 text-xs text-muted-foreground">{t('assets.store.dashboard.minimum')}: {item.minimum_level == null ? '—' : <StoreQuantity value={item.minimum_level} item={item} />}</p><div className="flex flex-wrap gap-1"><ItemStatus all itemId={item.id} dashboard={dashboard} /></div>
      </div></div>
      {editable && <section className="space-y-3 border-t border-border pt-4"><h3 className="font-semibold">{t('assets.store.handovers.give')}</h3>{maximum > 0 ? <>
        <HandoverForm lines={[{ item_id: item.id, quantity }]} draft={draft} onDraftChange={onDraftChange} onSuccess={onClose} busyChanged={setBusy}><ItemQuantityStepper item={item} label={t('assets.store.handovers.quantity')} value={quantity} max={maximum} disabled={busy} onChange={setRequested} /><p className="text-xs text-muted-foreground"><StoreQuantity value={quantity} item={item} /></p>{first?.expiry_date && <p className="text-xs text-muted-foreground">{t('assets.store.handovers.fromBatch', { date: `\u2066${formatExpiry(first, t)}\u2069` })}</p>}</HandoverForm>
        <Button variant="secondary" className="min-h-11 w-full whitespace-normal" disabled={busy} onClick={() => onAddMulti(item, quantity)}><Plus aria-hidden className="me-2 size-4 shrink-0" />{t('assets.store.handovers.addMulti')}</Button>
      </> : <p className="text-sm text-muted-foreground">{t('assets.store.handovers.noStock')}</p>}</section>}
      <section className="border-t border-border pt-4"><h3 className="font-semibold">{t('assets.store.dashboard.batches')}</h3><ExpiryTimeline batches={stock} item={item} windowDays={dashboard.expiring_soon_days} /><ul className="divide-y divide-border">{stock.map(batch => <li key={batch.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs"><StoreQuantity value={batch.on_hand} item={item} /><bdi dir="auto">{formatExpiry(batch, t)}</bdi>{batch.days_to_expiry != null && <span className={batch.days_to_expiry < 0 ? 'text-accent' : batch.days_to_expiry <= dashboard.expiring_soon_days ? 'text-warning' : 'text-muted-foreground'}>{t(`assets.store.dashboard.${batch.days_to_expiry < 0 ? 'daysOverdue' : 'daysLeft'}`, { count: Math.abs(batch.days_to_expiry) })}</span>}</li>)}</ul>{!stock.length && <p className="mt-2 text-sm text-muted-foreground">{t('assets.store.handovers.noStock')}</p>}</section>
      <dl className="space-y-3 border-t border-border pt-4 text-sm"><div><dt className="text-muted-foreground">{t('assets.store.dashboard.itemUsage')}</dt><dd>{average == null ? t('assets.store.dashboard.usageNone') : <StoreQuantity value={Math.round(average)} item={item} />}</dd></div><div><dt className="text-muted-foreground">{t('assets.store.dashboard.itemSuggestion')}</dt><dd>{!dashboard.usage_ready ? t('assets.store.dashboard.usageNone') : suggestion?.suggested_units ? <StoreQuantity value={suggestion.suggested_units} item={{ ...item, contains_qty: null }} /> : t('assets.store.dashboard.nothing')}</dd></div></dl>
      <section className="min-w-0 border-t border-border pt-4"><h3 className="mb-2 font-semibold">{t('assets.store.handovers.recentForItem')}</h3>{movements.filter(movement => movement.lines.some(line => line.item_id === item.id)).slice(0, 3).map(movement => {
        const lines = movement.lines.filter(line => line.item_id === item.id)
        const otherItems = new Set(movement.lines.filter(line => line.item_id !== item.id).map(line => line.item_id)).size
        return <div key={movement.id} className="min-w-0 [overflow-wrap:anywhere]"><MovementRow stacked showLineUnits movement={{ ...movement, lines }} onSelect={() => onMovement(movement)} />{otherItems > 0 && <p className="px-3 pb-3 text-xs text-muted-foreground"><Trans i18nKey="assets.store.handovers.otherItems" count={otherItems} components={{ number: <bdi dir="ltr" /> }} /></p>}</div>
      })}{!movements.some(movement => movement.lines.some(line => line.item_id === item.id)) && <p className="text-sm text-muted-foreground">{t('assets.store.handovers.noneForItem')}</p>}</section>
      {editable && <div className="flex flex-wrap gap-2 border-t border-border pt-4"><Link className={buttonVariants({ variant: 'secondary', className: 'min-h-11' })} to="/holdings/store/counts/new">{t('assets.store.handovers.count')}</Link><Button variant="secondary" className="min-h-11" onClick={onDisposal}>{t('assets.store.handovers.disposal')}</Button></div>}
    </article>
    </div>
  </SheetContent></Sheet>
}
