import { Fragment, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import type { ArmoryActorRead, ArmoryHolderRead, ArmoryPersonRead, ArmoryShiftWindowRead, ArmoryMovementLineRead } from '@/lib/api'
import { Ltr } from '../ArmoryLtr'
import { displayDate, orgTime, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, isArmoryAccessError } from '../armoryQueries'

/** Interpolate isolated nodes into the approved plain-text dictionary, not HTML. */
export function ShiftCopy({ id, count, values }: { id: string; count?: number; values?: Record<string, ReactNode> }) {
  const { t } = useArmoryLocale()
  return t(`assets.armory.${id}`, { count, skipInterpolation: true }).split(/\{\{(\w+)\}\}/g).map((part, index) =>
    index % 2 === 0 ? part : <Fragment key={index}>{part === 'count' ? <Ltr>{count}</Ltr> : values?.[part]}</Fragment>,
  )
}

export function ShiftWindowMeta({ window }: { window: ArmoryShiftWindowRead }) {
  const { t } = useArmoryLocale()
  return <ShiftCopy id="shiftMeta" values={{
    shift: t(`assets.armory.shiftKind.${window.shift_kind}`),
    period: <ShiftCopy id="period" values={{
      from: <Ltr>{orgTime(window.starts_at, window.time_zone)}</Ltr>,
      to: <Ltr>{orgTime(window.ends_at, window.time_zone)}</Ltr>,
    }} />,
    date: <Ltr>{displayDate(window.shift_date)}</Ltr>,
  }} />
}

export function ShiftPerson({ person }: { person: ArmoryPersonRead }) {
  const { name } = useArmoryLocale()
  return <><bdi>{name(person)}</bdi>{' '}<Ltr className="font-mono text-xs text-muted-foreground">{person.employee_id}</Ltr></>
}

export function ShiftHolder({ holder }: { holder: ArmoryHolderRead }) {
  const { t, name } = useArmoryLocale()
  if (holder.employee) return <ShiftPerson person={holder.employee} />
  if (holder.site_safe) return <bdi>{name(holder.site_safe)}</bdi>
  return t('assets.armory.notApplicable')
}

export function ShiftActor({ actor }: { actor: ArmoryActorRead }) {
  const { t } = useArmoryLocale()
  return actor.employee ? <ShiftPerson person={actor.employee} /> : <bdi>{actor.display_name ?? t('assets.armory.armorerFull')}</bdi>
}

export function PostedReturnLines({ lines }: { lines: readonly ArmoryMovementLineRead[] }) {
  const { t, name } = useArmoryLocale()
  return <ul className="space-y-1">
    {lines.map(line => <li key={line.id} className="[overflow-wrap:anywhere]">
      {line.item.kind === 'ammunition' ? <><ShiftCopy id="roundUnits" count={line.qty} />{' '}<bdi>({name(line.item)})</bdi></>
        : <ShiftCopy id="lineQty" count={line.qty} values={{ item: <bdi>{name(line.item)}</bdi> }} />}
      {line.serial_code && <> · <Ltr className="font-mono">{line.serial_code}</Ltr></>}
      {line.batch && <> · <Ltr>{line.batch.batch_ref}</Ltr></>}
      {line.condition === 'repair' && <span className="ms-2 text-warning">{t('assets.armory.includeRepair')}</span>}
      {line.fault_note && <p className="text-muted-foreground"><bdi>{line.fault_note}</bdi></p>}
    </li>)}
  </ul>
}

export function ShiftReadError({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useArmoryLocale()
  return <div className="flex flex-wrap items-center gap-x-3">
    <p role="alert" className="text-sm text-destructive-text">{error ? armoryErrorMessage(error) : t('assets.armory.loadFailed')}</p>
    {!isArmoryAccessError(error) && <Button type="button" variant="secondary" className="min-h-11" onClick={retry}>{t('assets.armory.retry')}</Button>}
  </div>
}
