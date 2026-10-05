/**
 * Status + date wording for the profile pill and search rows.
 *
 *   Resigned    · 15/08/2026
 *   Transferred · <site> · 15/08/2026
 *   Transferred · <site> · 15/08/2026 → 15/11/2026   (expected return known)
 *
 * Wording lives in `employees.statusDetail.*` (both locales). Dates and the
 * free-text site are bidi-isolated so they cannot scramble inside Arabic.
 */
import type { TFunction } from 'i18next'

import type { EmployeeStatus } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { formatDmy } from '@/lib/formatDmy'

export interface StatusDetailSource {
  status: EmployeeStatus
  end_date?: string | null
  transfer_site?: string | null
  transfer_return_date?: string | null
}

export function statusDetailText(t: TFunction, emp: StatusDetailSource): string {
  const label = t(`employees.status.${emp.status}`, emp.status) as string
  if (emp.status === 'Active' || !emp.end_date) return label
  const date = bidi(formatDmy(emp.end_date))
  if (emp.status !== 'Transferred') {
    return t('employees.statusDetail.dated', { status: label, date }) as string
  }
  const site = emp.transfer_site ? bidi(emp.transfer_site) : null
  const returnDate = emp.transfer_return_date ? bidi(formatDmy(emp.transfer_return_date)) : null
  if (site && returnDate)
    return t('employees.statusDetail.transferredSiteReturn', { status: label, site, date, returnDate }) as string
  if (site) return t('employees.statusDetail.transferredSite', { status: label, site, date }) as string
  if (returnDate)
    return t('employees.statusDetail.transferredReturn', { status: label, date, returnDate }) as string
  return t('employees.statusDetail.dated', { status: label, date }) as string
}
