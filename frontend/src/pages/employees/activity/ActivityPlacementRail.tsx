import { Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { EmployeeRead } from '@/lib/api'

import { formatStatementDate } from '../statement/statementModel'

interface Props {
  employee: Pick<EmployeeRead, 'status' | 'department' | 'duty_unit' | 'duty_post' | 'doj_company' | 'doj'>
  /** ISO date of the latest placement event in the statement, when one is present. */
  placedSince: string | null
  language: string
  onPrint: () => void
}

export function ActivityPlacementRail({ employee, placedSince, language, onPrint }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const joined = employee.doj_company ?? employee.doj
  const rows: { label: string; value: string | null }[] = [
    { label: t('activityStatement.rail.status'), value: t(`employees.status.${employee.status}`, { defaultValue: employee.status }) },
    { label: t('activityStatement.rail.department'), value: employee.department },
    { label: t('activityStatement.rail.unit'), value: employee.duty_unit },
    { label: t('activityStatement.rail.post'), value: employee.duty_post },
    { label: t('activityStatement.rail.joined'), value: joined ? formatStatementDate(joined, language) : null },
    { label: t('activityStatement.rail.since'), value: placedSince ? formatStatementDate(placedSince, language) : null },
  ]
  return (
    <aside aria-labelledby="activity-rail-heading" className="space-y-4 rounded-2xl border border-hairline bg-surface p-4">
      <h3 id="activity-rail-heading" className="text-sm font-semibold text-foreground">
        {t('activityStatement.rail.heading')}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows
          .filter((row) => row.value)
          .map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words text-foreground">
                <bdi dir="auto">{row.value}</bdi>
              </dd>
            </div>
          ))}
      </dl>
      <Button type="button" variant="secondary" className="w-full" onClick={onPrint}>
        <Printer className="h-4 w-4" aria-hidden />
        {t('activityStatement.printAction')}
      </Button>
    </aside>
  )
}
