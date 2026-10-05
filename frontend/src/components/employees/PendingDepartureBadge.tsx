/**
 * Scheduled-departure chip — "Resigned — effective 15/08/2026" (a pending transfer
 * also names the site: "Transferred · Site X — effective 15/08/2026").
 *
 * Shown beside the employee's status pill while they are still Active but have
 * a departure booked for `endDate`. Composes the canonical
 * `employees.status.*` translation with a date wrapper so the Arabic wording
 * stays in one place (مستقيل / مفصول), never duplicated here.
 *
 * `status` is gated to `'Active'` defensively: a stale `pending_status`
 * should never surface on a non-Active row (e.g. an immediate departure
 * that superseded a scheduled one) even though the write path is expected
 * to clear it.
 */

import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import type { EmployeeStatus } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { formatDmy } from '@/lib/formatDmy'

interface Props {
  status: EmployeeStatus
  pendingStatus: EmployeeStatus | null | undefined
  endDate: string | null | undefined
  /** Destination site — shown for a pending Transferred. */
  transferSite?: string | null | undefined
}


export function PendingDepartureBadge({
  status,
  pendingStatus,
  endDate,
  transferSite,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  if (status !== 'Active' || !pendingStatus || !endDate) return null
  const date = formatDmy(endDate)
  const label = t(`employees.status.${pendingStatus}`)
  const statusText =
    pendingStatus === 'Transferred' && transferSite ? `${label} · ${bidi(transferSite)}` : label
  return (
    <Badge tone="warning" className="ms-2" title={t('employees.pendingDepartureTitle', { date })}>
      {t('employees.pendingDeparture', {
        status: statusText,
        date,
      })}
    </Badge>
  )
}
