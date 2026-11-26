import { useId, useState, type RefObject } from 'react'
import { AlertTriangle, ChevronRight, ClipboardCheck, Clock3, LockKeyhole, Wrench, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import type { ArmorySerialRead, ArmoryShiftSafeRead, ArmoryShiftWindowRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Ltr } from '../ArmoryLtr'
import { displayDate, orgDateTime, orgTime, serialStateKey, useArmoryLocale, type ArmorySerialState } from '../armoryFormat'
import { useArmorySerial } from '../armoryQueries'
import { armoryLink } from '../armoryUrl'
import { ArmoryArt } from '../items/ArmoryArt'
import { ShiftCopy, ShiftHolder, ShiftReadError } from './shiftPresentation'
import { groupByItem } from './shiftValues'

const activeStates = ['in_safe', 'signed_out', 'in_custody', 'in_repair', 'missing', 'lost'] as const
const statusStyles = {
  in_safe: { icon: LockKeyhole, tone: 'bg-success-soft text-success' },
  signed_out: { icon: Clock3, tone: 'bg-primary-soft text-primary-text' },
  in_custody: { icon: ClipboardCheck, tone: 'bg-info-soft text-info' },
  in_repair: { icon: Wrench, tone: 'bg-warning-soft text-warning' },
  missing: { icon: AlertTriangle, tone: 'bg-accent-soft text-destructive-text' },
  lost: { icon: AlertTriangle, tone: 'bg-surface-tinted text-muted-foreground' },
  written_off: { icon: X, tone: 'bg-surface-tinted text-muted-foreground' },
  overdue: { icon: Clock3, tone: 'bg-accent-soft text-destructive-text' },
}

function SerialStatus({ state, isOverdue }: { state: ArmorySerialRead['state']; isOverdue: boolean }) {
  const { t } = useArmoryLocale()
  if (!state) return <span className="text-muted-foreground">{t('assets.armory.notApplicable')}</span>
  const { icon: Icon, tone } = statusStyles[isOverdue ? 'overdue' : state]
  return <span className={cn('inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium', tone)}>
    <Icon className="size-3.5 shrink-0" aria-hidden />
    {t(isOverdue ? 'assets.armory.overdue' : serialStateKey(state))}
  </span>
}

interface RackProps {
  safes: readonly ArmoryShiftSafeRead[]
  window: ArmoryShiftWindowRead
  onSerial: (serialId: number, opener: HTMLElement) => void
}

export function FirearmRack({ safes, window, onSerial }: RackProps) {
  const { t, name } = useArmoryLocale()
  const title = useId()
  const [filter, setFilter] = useState<ArmorySerialState | null>(null)
  return <section aria-labelledby={title} className="min-w-0 rounded-lg border border-border bg-surface">
    <header className="border-b border-hairline px-4 py-3">
      <h2 id={title} className="flex items-center gap-2 font-semibold"><LockKeyhole aria-hidden className="size-4" />{t('assets.armory.firearmsAtSafe')}</h2>
      <p className="text-sm text-muted-foreground">{t('assets.armory.rackHint')}</p>
    </header>
    {safes.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">{t('assets.armory.noFirearmsHere')}</p>}
    {safes.map(({ safe, firearms, out, check_history }) => {
      const active = firearms.filter(row => row.state && row.state !== 'written_off')
      const issueById = new Map(out.map(issue => [issue.id, issue]))
      const groups = groupByItem(active)
      const filterMatches = !filter || active.some(serial => serial.state === filter)
      return <div key={safe.id} className="space-y-2.5 border-b border-hairline p-4 last:border-0">
        <h3 className="text-sm font-semibold"><bdi>{name(safe)}</bdi></h3>
        {groups.map(group => {
          const item = group[0].item
          const visible = filter ? group.filter(row => row.state === filter) : group
          if (!visible.length) return null
          return <div key={item.id} className="grid min-w-0 gap-2 md:grid-cols-[minmax(9rem,1fr)_4fr] md:items-center">
            <div className="flex min-w-0 items-center gap-2">
              <ArmoryArt drawing={item.drawing} className="h-9 w-12 shrink-0" />
              <div className="min-w-0 text-sm [overflow-wrap:anywhere]">
                <h4 className="font-medium"><bdi>{name(item)}</bdi></h4>
                <p className="text-xs text-muted-foreground">
                  <ShiftCopy id="rackSafeN" count={group.filter(row => row.state === 'in_safe').length} values={{ total: <Ltr>{group.length}</Ltr> }} />
                </p>
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))]">
              {visible.map(serial => {
                const issue = serial.assignment_id === null ? undefined : issueById.get(serial.assignment_id)
                const isOverdue = serial.overdue_minutes !== null || (issue !== undefined && issue.overdue_minutes !== null)
                const status = t(isOverdue ? 'assets.armory.overdue' : serial.state ? serialStateKey(serial.state) : 'assets.armory.notApplicable')
                const due = issue?.due_at ? orgTime(issue.due_at, window.time_zone) : null
                const holder = serial.holder?.employee ?? serial.holder?.site_safe
                const accessibleName = [name(item), `\u2066${serial.serial_code}\u2069`, status, name(safe), holder && name(holder), due && t('assets.armory.dueAt', { time: `\u2066${due}\u2069` })].filter(Boolean).join(', ')
                return <li key={serial.id} className="min-w-0">
                  <button type="button" aria-label={accessibleName} title={serial.serial_code}
                    className={cn('flex h-full min-h-11 w-full flex-col items-start gap-1 rounded-md border border-border bg-surface-raised px-2 py-1.5 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', (isOverdue || serial.state === 'missing') && 'bg-accent-soft')}
                    onClick={event => onSerial(serial.id, event.currentTarget)}>
                    <Ltr className="max-w-full font-mono text-sm font-semibold [overflow-wrap:anywhere]">
                      <span className="hidden sm:inline">{serial.serial_code.slice(0, -4)}</span>{serial.serial_code.slice(-4)}
                    </Ltr>
                    <SerialStatus state={serial.state} isOverdue={isOverdue} />
                    {holder && <bdi className="max-w-full text-xs [overflow-wrap:anywhere]">{name(holder)}</bdi>}
                    {due && <span className="text-xs"><ShiftCopy id="dueAt" values={{ time: <Ltr>{due}</Ltr> }} /></span>}
                  </button>
                </li>
              })}
            </ul>
          </div>
        })}
        {!active.length && <p className="text-sm text-muted-foreground">{t('assets.armory.noFirearmsHere')}</p>}
        {active.length > 0 && !filterMatches && <p className="text-sm text-muted-foreground">{t('assets.armory.noMatchingSerials')}</p>}
        {active.length > 0 && <div role="group" aria-label={t('assets.armory.rackBalance')} className="flex flex-wrap items-center gap-1 border-t border-hairline pt-1">
          {activeStates.map(state => {
            const count = active.filter(row => row.state === state).length
            if (!count && filter !== state) return null
            return <Button key={state} type="button" variant="ghost" className={cn('min-h-11 gap-1 px-2 text-xs', state === filter && 'bg-primary-soft text-primary-text')} aria-pressed={state === filter} onClick={() => setFilter(state === filter ? null : state)}>
              {t(serialStateKey(state))} <Ltr>{count}</Ltr>
            </Button>
          })}
          <span className="px-2 text-xs text-muted-foreground"><ShiftCopy id="assignedN" count={active.length} /></span>
        </div>}
        <CheckHistory slots={check_history} />
      </div>
    })}
  </section>
}

const checkStatusKeys = { due: 'checkDue', missed: 'checkMissed', completed: 'done' } as const

function CheckHistory({ slots }: { slots: ArmoryShiftSafeRead['check_history'] }) {
  const { t } = useArmoryLocale()
  const current = slots[0]
  return <details className="border-t border-hairline pt-1">
    <summary className="min-h-11 content-center cursor-pointer rounded-sm py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {t('assets.armory.shiftChecks')} · {t('assets.armory.checkHistory')}
      {current?.status === 'due' && <span className="ms-2 text-warning">{t('assets.armory.missingCheck')}</span>}
      {current?.status === 'completed' && <span className="ms-2 text-muted-foreground">{t('assets.armory.done')}{current.missing_count ? <> · <span className="text-destructive-text"><ShiftCopy id="firearmsMissing" count={current.missing_count} /></span></> : null}</span>}
    </summary>
    {slots.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{t('assets.armory.shiftPane.noCheckHistory')}</p> :
      <ul className="grid gap-1 pb-2 sm:grid-cols-2 xl:grid-cols-3">
        {slots.map(slot => {
          const status = t(`assets.armory.${checkStatusKeys[slot.status]}`)
          return <li key={`${slot.window.shift_date}:${slot.window.shift_kind}`} className="flex flex-wrap items-center gap-x-2 rounded-md bg-surface-raised px-2 text-sm">
            <Ltr className="tabular-nums">{displayDate(slot.window.shift_date)}</Ltr>
            <span>{t(`assets.armory.shiftKind.${slot.window.shift_kind}`)}</span>
            {slot.count_id === null ? <span className="py-2 font-medium text-warning">{status}</span> :
              <Link className="inline-flex min-h-11 flex-wrap items-center gap-1 rounded-sm text-primary-text underline underline-offset-2" to={armoryLink('audit', { pane: 'counts', count: slot.count_id })}>{status}</Link>}
            {slot.missing_count !== null && <span className={cn('text-xs', slot.missing_count > 0 ? 'text-destructive-text' : 'text-muted-foreground')}><ShiftCopy id="firearmsMissing" count={slot.missing_count} /></span>}
          </li>
        })}
      </ul>}
  </details>
}

interface SerialSheetProps {
  serialId: number
  windowZone: string | undefined
  dueAt: string | null
  scope: string | null
  onClose: () => void
  onIssueLink: () => void
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}

export function FirearmSerialSheet({ serialId, windowZone, dueAt, scope, onClose, onIssueLink, returnFocusRef, fallbackFocusRef }: SerialSheetProps) {
  const { t, name } = useArmoryLocale()
  const query = useArmorySerial(serialId)
  const [copy, setCopy] = useState<'done' | 'failed' | null>(null)
  const serial = query.isError ? undefined : query.data
  async function copySerial(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopy('done')
    } catch {
      setCopy('failed')
    }
  }
  return <Sheet open onOpenChange={open => { if (!open) onClose() }}>
    <SheetContent aria-describedby={undefined} className="w-full max-w-md" onCloseAutoFocus={event => {
      event.preventDefault()
      const opener = returnFocusRef.current
      ;(opener?.isConnected ? opener : fallbackFocusRef.current)?.focus()
    }}>
      <header className="flex items-start justify-between gap-2 border-b border-hairline p-4">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <SheetTitle className="text-lg font-semibold">{serial ? <Ltr className="font-mono">{serial.serial_code}</Ltr> : t('assets.armory.serialNumber')}</SheetTitle>
          {serial && <p className="text-sm text-muted-foreground"><bdi>{name(serial.item)}</bdi></p>}
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={t('assets.armory.close')} onClick={onClose}><X aria-hidden /></Button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {query.isPending && <p role="status" className="text-muted-foreground">{t('assets.armory.loadingText')}</p>}
        {query.isError && <ShiftReadError error={query.error} retry={() => void query.refetch()} />}
        {serial && <>
          <div className="flex flex-wrap items-center gap-2">
            <SerialStatus state={serial.state} isOverdue={serial.overdue_minutes !== null} />
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => void copySerial(serial.serial_code)}>{t('assets.armory.copySerial')}</Button>
            {copy && <span role={copy === 'done' ? 'status' : 'alert'} className={copy === 'failed' ? 'text-destructive-text' : 'text-muted-foreground'}>{t(`assets.armory.${copy === 'done' ? 'copiedSerial' : 'copyFailed'}`)}</span>}
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-muted-foreground">{t('assets.armory.safe')}</dt><dd>{serial.safe ? <bdi>{name(serial.safe)}</bdi> : t('assets.armory.notApplicable')}</dd></div>
            <div><dt className="text-muted-foreground">{t('assets.armory.holder')}</dt><dd>{serial.holder ? <ShiftHolder holder={serial.holder} /> : t('assets.armory.none')}</dd></div>
            {serial.state_at && <div><dt className="text-muted-foreground">{t('assets.armory.since')}</dt><dd><Ltr>{orgDateTime(serial.state_at, windowZone)}</Ltr></dd></div>}
            {serial.state === 'signed_out' && dueAt && <div><dt className="text-muted-foreground">{t('assets.armory.dueBack')}</dt><dd><Ltr>{orgDateTime(dueAt, windowZone)}</Ltr></dd></div>}
          </dl>
          <div className="flex flex-wrap gap-2">
            {serial.state === 'signed_out' && serial.assignment_id !== null && <Link className="inline-flex min-h-11 items-center gap-1 rounded-sm text-primary-text underline underline-offset-2" to={armoryLink('shift', { issue: serial.assignment_id, ...(scope ? { safe: scope } : {}) })}
              onClick={event => { if (event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey) onIssueLink() }}>
              {t('assets.armory.issueDetail')}<ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
            </Link>}
            <Link className="inline-flex min-h-11 items-center gap-1 rounded-sm text-primary-text underline underline-offset-2" to={armoryLink('items', { item: serial.item.id, serial: serial.id })}>
              {t('assets.armory.openItem')}<ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
            </Link>
          </div>
          <section>
            <h3 className="mb-1 font-semibold">{t('assets.armory.recentMovements')}</h3>
            {serial.recent_movements.length === 0 ? <p className="text-muted-foreground">{t('assets.armory.noHistory')}</p> :
              <ul className="divide-y divide-hairline">
                {serial.recent_movements.map(posting => <li key={posting.id}>
                  <Link className="flex min-h-11 flex-wrap items-center gap-x-2 py-2 text-primary-text hover:underline" to={armoryLink('audit', { pane: 'movements', movement: posting.id })}>
                    <Ltr>{posting.occurred_at ? orgDateTime(posting.occurred_at, windowZone) : displayDate(posting.occurred_on)}</Ltr>
                    <span>{t(`assets.armory.postingKind.${posting.kind}`)}</span><Ltr className="font-mono">{posting.record_ref}</Ltr>
                  </Link>
                </li>)}
              </ul>}
          </section>
        </>}
      </div>
    </SheetContent>
  </Sheet>
}
