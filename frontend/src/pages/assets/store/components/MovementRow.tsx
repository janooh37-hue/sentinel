import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight, FileText, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StoreItemArt } from '@/components/StoreItemArt'
import { DialogShell } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api, type StoreMovementRead } from '@/lib/api'
import { localized } from '@/lib/language'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { formatExpiry, invalidateStoreQueries, itemName, storeErrorMessage } from '../storeUtils'
import { ItemIdentity, SignedStoreQuantity } from './RecordParts'

type Line = StoreMovementRead['lines'][number]
function summedItems(movement: StoreMovementRead): Line[] {
  const items = new Map<number, Line>()
  for (const line of movement.lines) {
    const existing = items.get(line.item_id)
    if (existing) existing.quantity += line.quantity
    else items.set(line.item_id, { ...line })
  }
  return [...items.values()]
}
function dateText(value: string, language: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(language, options).format(new Date(value.length === 10 ? `${value}T12:00:00` : value))
}
function KindIcon({ kind }: { kind: StoreMovementRead['kind'] }) {
  const Icon = kind === 'in' ? ArrowDownToLine : kind === 'out' ? ArrowUpFromLine : Trash2
  return <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', kind === 'in' ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' : kind === 'out' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive')}><Icon aria-hidden className="size-4" /></span>
}
export function MovementRow({ movement, onSelect }: { movement: StoreMovementRead; onSelect: (m: StoreMovementRead) => void }) {
  const { t, i18n } = useTranslation()
  const items = summedItems(movement)
  const recorder = localized(movement.recorded_by_name_ar, movement.recorded_by_name, i18n.language) || t('assets.store.movements.unknownRecorder')
  const who = movement.kind === 'in' ? t('assets.store.movements.fromHQ') : movement.kind === 'out' ? t('assets.store.movements.toWho', { name: movement.taken_by }) : movement.reason ? t(`assets.store.movements.reason.${movement.reason}`) : t('assets.store.movements.kind.disposed')
  const total = movement.lines.reduce((sum, line) => sum + line.quantity, 0)
  return <button type="button" onClick={() => onSelect(movement)} className="flex min-h-20 w-full items-center gap-3 border-b border-border px-3 py-4 text-start last:border-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4">
    <KindIcon kind={movement.kind} /><span className="sr-only">{t(`assets.store.movements.kind.${movement.kind}`)}</span>
    <span className="hidden w-20 shrink-0 text-sm sm:block">{dateText(movement.on, i18n.language, { day: 'numeric', month: 'short' })}<span className="block text-xs text-muted-foreground">{dateText(movement.created_at, i18n.language, { hour: '2-digit', minute: '2-digit' })}</span></span>
    <span className="hidden shrink-0 items-center sm:flex">{items.slice(0, 3).map((line, index) => <StoreItemArt key={line.item_id} kind={line.art_kind} color={line.art_color} size={36} className={index ? '-ms-3' : ''} />)}</span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{items.map((line, index) => <span key={line.item_id}>{index > 0 && ' · '}{itemName(line, i18n.language)} <bdi dir="ltr" className="font-normal text-muted-foreground">×{line.quantity}</bdi></span>)}</span><span className="mt-1 block text-xs text-muted-foreground">{who} · {t('assets.store.movements.byWho', { name: recorder })}</span><span className="mt-1 block text-xs text-muted-foreground sm:hidden">{dateText(movement.on, i18n.language, { day: 'numeric', month: 'short' })} · {dateText(movement.created_at, i18n.language, { hour: '2-digit', minute: '2-digit' })}</span></span>
    <span className="shrink-0 text-end text-sm font-semibold">{items.length === 1 ? <SignedStoreQuantity value={movement.kind === 'in' ? total : -total} item={items[0]!} /> : <>{t('assets.store.movements.items', { count: items.length })}<span className="block text-xs font-normal text-muted-foreground">{t('assets.store.movements.units', { count: total })}</span></>}</span><ChevronRight aria-hidden className="hidden size-4 text-muted-foreground rtl:rotate-180 sm:block" />
  </button>
}
export function MovementDetailDialog({ movement, open, onOpenChange }: { movement: StoreMovementRead | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const client = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const deletion = useMutation({ mutationFn: (id: number) => api.deleteStoreHandover(id), onSuccess: () => { invalidateStoreQueries(client); setConfirm(false); onOpenChange(false); toast.success(t('assets.store.movements.deleted')) }, onError: error => toast.error(storeErrorMessage(error)) })
  if (!movement) return null
  const recorder = localized(movement.recorded_by_name_ar, movement.recorded_by_name, i18n.language) || t('assets.store.movements.unknownRecorder')
  const items = summedItems(movement)
  const total = movement.lines.reduce((sum, line) => sum + line.quantity, 0)
  return <><DialogShell open={open} onOpenChange={onOpenChange} title={t(`assets.store.movements.kind.${movement.kind}`)} description={`${t('assets.store.movements.items', { count: items.length })} · ${t('assets.store.movements.units', { count: total })}`}>
    <div className="space-y-5 overflow-y-auto p-5">
      <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs text-muted-foreground">{t(`assets.store.movements.${movement.kind === 'in' ? 'receivedOn' : 'when'}`)}</dt><dd className="mt-1">{dateText(movement.on, i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })} · {dateText(movement.created_at, i18n.language, { hour: '2-digit', minute: '2-digit' })}</dd></div>
      {movement.taken_by && <div><dt className="text-xs text-muted-foreground">{t('assets.store.movements.takenBy')}</dt><dd className="mt-1" dir="auto">{movement.taken_by}</dd></div>}
      {movement.reason && <div><dt className="text-xs text-muted-foreground">{t('assets.store.movements.reasonLabel')}</dt><dd>{t(`assets.store.movements.reason.${movement.reason}`)}</dd></div>}
      <div><dt className="text-xs text-muted-foreground">{t('assets.store.movements.recordedBy')}</dt><dd className="mt-1 flex items-center gap-2"><span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">{recorder.split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</span><span dir="auto">{recorder}</span></dd></div>
      {movement.note && <div className="col-span-2"><dt className="text-xs text-muted-foreground">{t('assets.store.movements.note')}</dt><dd className="mt-1 whitespace-pre-wrap" dir="auto">{movement.note}</dd></div>}</dl>
      {movement.note_file && <a className="flex min-h-11 items-center gap-2 text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={movement.note_file.url} download={movement.note_file.name}><FileText aria-hidden className="size-4" />{t('assets.store.movements.file')}: <bdi>{movement.note_file.name}</bdi></a>}
      <h3 className="text-sm font-semibold">{t('assets.store.movements.lines')}</h3>
      <ul className="divide-y divide-border">{movement.lines.map(line => <li key={line.id} className="flex items-start gap-3 py-3">
        <StoreItemArt kind={line.art_kind} color={line.art_color} size={44} />
        <div className="min-w-0 flex-1">
          <ItemIdentity row={line} stacked />
          <p className="text-xs text-muted-foreground">{line.expiry_date ? <span title={formatExpiry(line, t)}>{t('assets.store.movements.batchExpiring', { date: dateText(line.expiry_date, i18n.language, { ...(line.expiry_month_only ? {} : { day: 'numeric' as const }), month: 'short', year: 'numeric' }) })}</span> : t('assets.store.movements.undated')}</p>
          {movement.kind === 'in' && line.noted_quantity != null && <p className="mt-1 text-xs text-muted-foreground">{t('assets.store.movements.noted', { noted: line.noted_quantity, received: line.quantity })}{line.difference_reason && <> · <span dir="auto">{line.difference_reason}</span></>}</p>}
        </div>
        <span className="text-sm font-semibold"><SignedStoreQuantity value={movement.kind === 'in' ? line.quantity : -line.quantity} item={line} /></span>
      </li>)}</ul>
      {movement.kind === 'out' && has('store.edit') && <Button ref={trigger} type="button" variant="ghost" className="min-h-11 text-destructive" disabled={deletion.isPending} onClick={() => { deletion.reset(); setConfirm(true) }}><Trash2 aria-hidden className="me-2 size-4" />{t('assets.store.movements.delete')}</Button>}
    </div>
  </DialogShell><ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t('assets.store.movements.deleteTitle')} description={t('assets.store.movements.deleteDescription')} confirmLabel={t('assets.store.movements.delete')} destructive returnFocusRef={trigger} onConfirm={() => deletion.mutate(movement.id)} /></>
}
