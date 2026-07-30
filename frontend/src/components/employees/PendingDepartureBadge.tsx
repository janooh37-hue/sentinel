/**
 * Scheduled-departure chip — "Resigned — effective 15/08/2026".
 *
 * Shown beside StatusPill while the employee is still Active but has a
 * departure booked for `endDate`. Composes the canonical
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

interface Props {
  status: EmployeeStatus
  pendingStatus: EmployeeStatus | null | undefined
  endDate: string | null | undefined
}

/** ISO (`YYYY-MM-DD`) → `DD/MM/YYYY`, the format every GSSG paper uses. */
function formatDmy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

export function PendingDepartureBadge({
  status,
  pendingStatus,
  endDate,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  if (status !== 'Active' || !pendingStatus || !endDate) return null
  const date = formatDmy(endDate)
  return (
    <Badge tone="warning" className="ms-2" title={t('employees.pendingDepartureTitle', { date })}>
      {t('employees.pendingDeparture', {
        status: t(`employees.status.${pendingStatus}`),
        date,
      })}
    </Badge>
  )
}
