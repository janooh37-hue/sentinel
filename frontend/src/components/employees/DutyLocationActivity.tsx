import { useTranslation } from 'react-i18next'

export interface DutyLocationActivityValue {
  event_type?: 'initial_placement' | 'transfer' | null
  from_department?: string | null
  from_unit?: string | null
  from_post?: string | null
  to_department?: string | null
  to_unit?: string | null
  to_post?: string | null
  reason?: string | null
}
export function DutyLocationActivity({ item }: { item: DutyLocationActivityValue }): React.JSX.Element {
  const { t } = useTranslation()
  const from = [item.from_unit, item.from_post].filter(Boolean).join(' / ')
  const to = [item.to_unit, item.to_post].filter(Boolean).join(' / ') || t('employees.activity.dutyLocation.unassigned')

  return (
    <span className="block min-w-0">
      <span className="block font-semibold text-foreground">
        {t(`employees.activity.dutyLocation.${item.event_type ?? 'transfer'}`)}
      </span>
      <span data-testid="duty-location-movement" className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
        {from ? (
          <>
            <bdi dir="auto">{from}</bdi>
            <svg aria-hidden className="h-3.5 w-3.5 shrink-0 rtl:rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 8h11m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        ) : (
          <span className="text-faint">{t('employees.activity.dutyLocation.historyBegins')}</span>
        )}
        <bdi dir="auto">{to}</bdi>
      </span>
      {item.reason ? <span dir="auto" className="mt-0.5 block text-faint">{item.reason}</span> : null}
    </span>
  )
}
