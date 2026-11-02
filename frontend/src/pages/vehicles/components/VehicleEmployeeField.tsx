/**
 * The one Vehicles-specific dialog field. The generic dialog shell and form
 * scaffolding live in `@/components/forms/DialogShell`.
 */

import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { EmployeePicker } from '@/pages/application/EmployeePicker'

/**
 * The optional driver on a fine or an accident report. `EmployeePicker` is a
 * combobox without an id to label, so the group carries the label instead —
 * a screen reader announces «Employee» on entry — and the hint states what an
 * empty selection means, because an imported fine legitimately has no driver.
 */
export function VehicleEmployeeField({
  employeeId,
  onChange,
  hint,
}: {
  employeeId: string | null
  onChange: (employeeId: string | null) => void
  hint: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const labelId = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
      <Label id={labelId}>{t('vehicles.employeePicker')}</Label>
      <div role="group" aria-labelledby={labelId}>
        <EmployeePicker selectedId={employeeId} onSelect={onChange} />
      </div>
      <span className="text-[0.72em] leading-snug text-muted-foreground">{hint}</span>
    </div>
  )
}
