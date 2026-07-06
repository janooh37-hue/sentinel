/**
 * StatusDialog — quick status change from the employee hero pill.
 *
 * Status select + end-date input; the end date appears and is required when
 * status ≠ Active (same invariant the backend enforces). Saving as Active
 * sends end_date: null so re-activating clears a stale end date.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage, type EmployeeRead, type EmployeeStatus } from '@/lib/api'
import { EMPLOYEE_STATUSES } from '@/components/employees/schema'
import { pickEmployeeName } from '@/lib/employeeName'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  open: boolean
  employee: EmployeeRead
  onOpenChange: (open: boolean) => void
}

export function StatusDialog({ open, employee, onOpenChange }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [status, setStatus] = useState<EmployeeStatus>(employee.status)
  const [endDate, setEndDate] = useState(employee.end_date ?? '')

  const endDateRequired = status !== 'Active'
  const canSave = !endDateRequired || endDate.trim().length > 0

  const mutation = useMutation({
    mutationFn: () =>
      api.updateEmployee(employee.id, {
        status,
        end_date: status === 'Active' ? null : endDate,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-detail', employee.id] })
      void qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success(t('employees.toast.updated'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('employees.statusDialog.title')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{employee.id}</span>
            {' · '}
            <span dir="auto">{pickEmployeeName(employee, i18n.language)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-4 py-4 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status-dialog-status">{t('employees.fields.status')}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as EmployeeStatus)}>
              <SelectTrigger id="status-dialog-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYEE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`employees.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {endDateRequired && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="status-dialog-end-date">{`${t('employees.fields.end_date')} *`}</Label>
              <Input
                id="status-dialog-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="font-mono"
              />
              {!endDate.trim() && (
                <span role="alert" className="text-xs text-destructive">
                  {t('employees.validation.endDateRequired')}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
