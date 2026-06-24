/**
 * Status pill for the canonical Active/Resigned/Terminated values.
 *
 * Centralised so the colour mapping is consistent between the list pane,
 * detail header, and any future surfaces (audit log, reports).
 */

import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import type { EmployeeStatus } from '@/lib/api'

const TONE_BY_STATUS: Record<EmployeeStatus, 'active' | 'warning' | 'danger'> = {
  Active: 'active',
  Resigned: 'warning',
  Terminated: 'danger',
}

export function StatusPill({ status }: { status: EmployeeStatus }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Badge tone={TONE_BY_STATUS[status]} withDot>
      {t(`employees.status.${status}`)}
    </Badge>
  )
}
