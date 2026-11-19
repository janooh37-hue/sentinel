import { useTranslation } from 'react-i18next'

import type { components } from '@/lib/api.types'

type DutyLocationEventType = NonNullable<components['schemas']['ActivityItemRead']['event_type']>

export interface DutyLocationActivityValue {
  event_type?: DutyLocationEventType | null
  from_department?: string | null
  from_unit?: string | null
  from_post?: string | null
  to_department?: string | null
  to_unit?: string | null
  to_post?: string | null
  reason?: string | null
}

/** Where a departure leaves the employee: the roster group they now appear in. */
const DEPARTURE_TARGET: Partial<Record<DutyLocationEventType, string>> = {
  service_end: 'employees.activity.dutyLocation.toEndedService',
  transfer_out: 'employees.activity.dutyLocation.toTransferred',
}

function Arrow(): React.JSX.Element {
  return (
    <svg aria-hidden className="h-3.5 w-3.5 shrink-0 rtl:rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 8h11m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function DutyLocationActivity({ item }: { item: DutyLocationActivityValue }): React.JSX.Element {
  const { t } = useTranslation()
  const eventType = item.event_type ?? 'transfer'
  const from = [item.from_unit, item.from_post].filter(Boolean).join(' / ')
  const to = [item.to_unit, item.to_post].filter(Boolean).join(' / ') || t('employees.activity.dutyLocation.unassigned')
  const departureTarget = DEPARTURE_TARGET[eventType]

  let movement: React.JSX.Element
  if (eventType === 'reinstatement') {
    movement = (
      <>
        <span>{t('employees.activity.dutyLocation.returnedTo')}</span>
        <bdi dir="auto">{to}</bdi>
      </>
    )
  } else if (departureTarget) {
    // A departure always has an origin, even if it was Unassigned.
    movement = (
      <>
        <bdi dir="auto">{from || t('employees.activity.dutyLocation.unassigned')}</bdi>
        <Arrow />
        <span>{t(departureTarget)}</span>
      </>
    )
  } else {
    movement = (
      <>
        {from ? (
          <>
            <bdi dir="auto">{from}</bdi>
            <Arrow />
          </>
        ) : (
          <span className="text-faint">{t('employees.activity.dutyLocation.historyBegins')}</span>
        )}
        <bdi dir="auto">{to}</bdi>
      </>
    )
  }

  return (
    <span className="block min-w-0">
      <span className="block font-semibold text-foreground">
        {t(`employees.activity.dutyLocation.${eventType}`)}
      </span>
      <span data-testid="duty-location-movement" className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
        {movement}
      </span>
      {item.reason ? <span dir="auto" className="mt-0.5 block text-faint">{item.reason}</span> : null}
    </span>
  )
}
