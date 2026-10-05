import { useTranslation } from 'react-i18next'

import type { EmployeeActivityItemRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { formatDmy } from '@/lib/formatDmy'

export type StatusActivityValue = Pick<
  EmployeeActivityItemRead,
  | 'from_status'
  | 'to_status'
  | 'effective_date'
  | 'site'
  | 'return_date'
  | 'status_event_kind'
  | 'status_source'
  | 'actor_name'
>

/**
 * One employee status-history event (kind `status`).
 *
 *   Active → Transferred            Site X · Effective 15/08/2026 · By Ahmed
 *   Returned to Active              Returned 20/09/2026 · Applied automatically
 *
 * Status values go through `employees.status.*` so Arabic never shows the raw
 * English enum; site / dates / actor name are bidi-isolated.
 */
export function StatusActivity({ item }: { item: StatusActivityValue }): React.JSX.Element {
  const { t } = useTranslation()
  const statusLabel = (s: string | null | undefined): string =>
    s ? (t(`employees.status.${s}`, { defaultValue: s }) as string) : ''
  const from = statusLabel(item.from_status)
  const to = statusLabel(item.to_status)
  const eventKind = item.status_event_kind ?? 'changed'
  const returned = item.to_status === 'Active' && !!item.from_status && item.from_status !== 'Active'

  let title: string
  if (eventKind === 'scheduled_cancelled') {
    title = t('employees.activity.statusEvent.scheduledCancelled', { to })
  } else if (eventKind === 'scheduled') {
    title = t('employees.activity.statusEvent.scheduled', { from, to })
  } else if (returned) {
    title = t('employees.activity.statusEvent.returned')
  } else if (!from) {
    title = t('employees.activity.statusEvent.initial', { to })
  } else {
    title = t('employees.activity.statusEvent.change', { from, to })
  }

  const parts: string[] = []
  if (item.site) parts.push(bidi(item.site))
  if (item.effective_date && eventKind !== 'scheduled_cancelled') {
    const date = bidi(formatDmy(item.effective_date))
    parts.push(
      t(returned ? 'employees.activity.statusEvent.returnedOn' : 'employees.activity.statusEvent.effective', {
        date,
      }),
    )
  }
  if (item.return_date) {
    parts.push(t('employees.activity.statusEvent.expectedReturn', { date: bidi(formatDmy(item.return_date)) }))
  }
  if (eventKind === 'imported') parts.push(t('employees.activity.statusEvent.imported'))
  if (item.status_source === 'scheduler') parts.push(t('employees.activity.statusEvent.bySchedulerAuto'))
  else if (item.status_source === 'resignation_letter')
    parts.push(t('employees.activity.statusEvent.fromResignationLetter'))
  if (item.actor_name) parts.push(t('employees.activity.statusEvent.by', { name: bidi(item.actor_name) }))

  return (
    <span className="block min-w-0">
      <span data-testid="status-activity-title" className="block truncate text-sm font-semibold text-foreground">
        {title}
      </span>
      {parts.length > 0 && (
        <span data-testid="status-activity-detail" className="mt-0.5 block truncate text-xs text-muted-foreground">
          {parts.join(' · ')}
        </span>
      )}
    </span>
  )
}
