/**
 * StatusDialog — quick status change from the employee hero pill.
 *
 * Status select + end-date input; the end date appears and is required when
 * status is not Active/Loaned (same invariant the backend enforces). Saving as
 * the same working status sends end_date: null so it clears a stale end date;
 * switching Active ↔ Loaned sends only the status, so a pending departure survives.
 * Transferred adds a required destination site + optional expected return
 * date; reactivating a non-working employee (to Active/Loaned) asks for the
 * return date (today by default), sent as the write-only `effective_date`.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage, type EmployeeRead, type EmployeeStatus } from '@/lib/api'
import { EMPLOYEE_STATUSES, isWorkingStatus } from '@/components/employees/schema'
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

function todayIso(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

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

  const [site, setSite] = useState(employee.transfer_site ?? '')
  const [returnDate, setReturnDate] = useState(employee.transfer_return_date ?? '')
  const [reactivationDate, setReactivationDate] = useState(todayIso)

  const endDateRequired = !isWorkingStatus(status)
  const isTransferred = status === 'Transferred'
  const isReactivation = !isWorkingStatus(employee.status) && isWorkingStatus(status)
  const isWorkingSwitch =
    isWorkingStatus(employee.status) && isWorkingStatus(status) && status !== employee.status
  const returnBeforeEffective =
    isTransferred && returnDate !== '' && endDate !== '' && returnDate <= endDate
  const canSave =
    (!endDateRequired || endDate.trim().length > 0) &&
    (!isTransferred || site.trim().length > 0) &&
    !returnBeforeEffective &&
    (!isReactivation || reactivationDate.trim().length > 0)

  const mutation = useMutation({
    mutationFn: () =>
      api.updateEmployee(
        employee.id,
        isWorkingSwitch
          ? { status }
          : {
              status,
              end_date: isWorkingStatus(status) ? null : endDate,
              ...(isTransferred
                ? {
                    transfer_site: site.trim(),
                    transfer_return_date: returnDate.trim() || null,
                  }
                : {}),
              ...(isReactivation
                ? {
                    effective_date: reactivationDate,
                    // Reactivation clears the transfer fields.
                    ...(employee.status === 'Transferred'
                      ? { transfer_site: null, transfer_return_date: null }
                      : {}),
                  }
                : {}),
            },
      ),
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
              <Label htmlFor="status-dialog-end-date">{`${t(isTransferred ? 'employees.fields.effective_date' : 'employees.fields.end_date')} *`}</Label>
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

          {isTransferred && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="status-dialog-site">{`${t('employees.fields.transfer_site')} *`}</Label>
                <Input
                  id="status-dialog-site"
                  dir="auto"
                  maxLength={128}
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                />
                {!site.trim() && (
                  <span role="alert" className="text-xs text-destructive">
                    {t('employees.validation.transferSiteRequired')}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="status-dialog-return-date">
                  {t('employees.fields.transfer_return_date')}
                </Label>
                <Input
                  id="status-dialog-return-date"
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="font-mono"
                />
                {returnBeforeEffective && (
                  <span role="alert" className="text-xs text-destructive">
                    {t('employees.validation.returnAfterEffective')}
                  </span>
                )}
              </div>
            </>
          )}

          {isReactivation && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="status-dialog-reactivation-date">{`${t('employees.fields.return_date')} *`}</Label>
              <Input
                id="status-dialog-reactivation-date"
                type="date"
                value={reactivationDate}
                onChange={(e) => setReactivationDate(e.target.value)}
                className="font-mono"
              />
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
