/**
 * TransferEmployeeDialog — change one employee's duty unit/post from his
 * profile. "Issue transfer letter" (default ON) routes through POST
 * /duty/transfer — official letter + General Book record, identical to the
 * Duty Locations page. Unchecked does a silent PATCH (like AssignPopover).
 */
import { useId, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { api, apiErrorMessage, type DutyTransferResult, type EmployeeRead } from '@/lib/api'
import { canIssueDutyTransfer, unitOptions, postsForUnit } from '@/lib/dutyUnits'
import { buildTransferRequest } from '@/pages/dutyLocations/transferRequest'
import { loadTransferDefaults, saveTransferDefaults } from '@/pages/dutyLocations/transferDefaults'
import { RecipientPickerField } from '@/components/application/fields/RecipientPickerField'
import { ManagerPickerField } from '@/components/application/fields/ManagerPickerField'
import { MultiRecipientPickerField } from '@/components/application/fields/MultiRecipientPickerField'
import { pickEmployeeName } from '@/lib/employeeName'
import { Button } from '@/components/ui/button'
import { useCapabilities } from '@/lib/useCapabilities'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  employee: EmployeeRead
  onOpenChange: (open: boolean) => void
}


export function TransferEmployeeDialog({ open, employee, onOpenChange }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { has } = useCapabilities()
  const canIssueLetter = canIssueDutyTransfer(employee, has)
  const canEdit = has('employees.edit')
  const unitListId = useId()
  const postListId = useId()
  const checkboxId = useId()

  const [unit, setUnit] = useState(employee.duty_unit ?? '')
  const [post, setPost] = useState(employee.duty_post ?? '')
  const [issueLetter, setIssueLetter] = useState(() => canIssueLetter)

  // Roster fetch only feeds the unit/post combobox suggestions.
  const { data: roster } = useQuery({
    queryKey: ['employees', 'lookup', { limit: 500 }],
    queryFn: () => api.lookupEmployees({ limit: 500 }),
    enabled: open && (canIssueLetter || canEdit),
  })
  const all = roster?.items ?? []
  const units = unitOptions(all)
  const posts = postsForUnit(all, unit.trim())

  const [initial] = useState(loadTransferDefaults)
  const methods = useForm<{ recipient_id: number | null; manager_id: number | null; cc: string[] }>({
    defaultValues: { recipient_id: initial.recipientId, manager_id: initial.managerId, cc: initial.cc },
  })

  const mutation = useMutation({
    mutationFn: async (): Promise<DutyTransferResult | null> => {
      if (issueLetter ? !canIssueDutyTransfer(employee, has) : !has('employees.edit')) {
        throw new Error(t('common.forbidden'))
      }
      if (!issueLetter) {
        await api.updateEmployee(employee.id, {
          duty_unit: unit.trim() || null,
          duty_post: post.trim() || null,
        })
        return null
      }
      const v = methods.getValues()
      return api.transferDuty(
        buildTransferRequest({
          moves: [{ employeeId: employee.id, toUnit: unit, toPost: post }],
          recipientId: v.recipient_id,
          managerId: v.manager_id,
          cc: v.cc,
        }),
      )
    },
    onMutate: () => toast.loading(t(issueLetter ? 'dutyLocations.transfer.generating' : 'common.saving')),
    onSuccess: (result, _variables, toastId) => {
      void qc.invalidateQueries({ queryKey: ['employee-detail', employee.id] })
      void qc.invalidateQueries({ queryKey: ['employees'] })
      if (result == null) {
        toast.success(t('dutyLocations.assign.saved'), { id: toastId })
      } else {
        const v = methods.getValues()
        saveTransferDefaults({ recipientId: v.recipient_id, managerId: v.manager_id, cc: v.cc })
        void qc.invalidateQueries({ queryKey: ['books'] })
        if (result.book_id == null) {
          toast.success(t('dutyLocations.transfer.movedNoBook', { count: result.moved.length }), { id: toastId })
        } else {
          toast.success(t('dutyLocations.transfer.success'), {
            id: toastId,
            duration: 8000,
            reference: result.ref ?? undefined,
            action: {
              label: t('dutyLocations.transfer.viewRecord'),
              onClick: () => navigate(`/books/${result.book_id}`),
            },
          })
        }
      }
      onOpenChange(false)
    },
    onError: (err, _variables, toastId) => toast.error(apiErrorMessage(err), { id: toastId }),
  })

  // The letter path needs a destination unit (backend requires to_unit); the
  // silent PATCH may clear both fields (unassign), so an empty unit is fine.
  const canSubmit = (issueLetter ? canIssueLetter : canEdit) &&
    !mutation.isPending && (!issueLetter || unit.trim().length > 0)

  if (!canIssueLetter && !canEdit) return <p role="alert">{t('common.forbidden')}</p>
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('employee.profile.transfer')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{employee.id}</span>
            {' · '}
            <span dir="auto">{pickEmployeeName(employee, i18n.language)}</span>
            {' — '}
            <span dir="auto">
              {employee.duty_unit
                ? `${employee.duty_unit}${employee.duty_post ? ` · ${employee.duty_post}` : ''}`
                : t('dutyLocations.unassigned')}
            </span>
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-4 text-sm">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${unitListId}-input`} className="text-xs font-semibold text-muted-foreground">
                {t('dutyLocations.transfer.destUnit')}
              </label>
              <input
                id={`${unitListId}-input`}
                list={unitListId}
                value={unit}
                dir="auto"
                autoComplete="off"
                placeholder={t('dutyLocations.field.unitPlaceholder')}
                onChange={(e) => setUnit(e.target.value)}
                className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id={unitListId}>
                {units.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${postListId}-input`} className="text-xs font-semibold text-muted-foreground">
                {t('dutyLocations.transfer.destPost')}
              </label>
              <input
                id={`${postListId}-input`}
                list={postListId}
                value={post}
                dir="auto"
                autoComplete="off"
                placeholder={t('dutyLocations.field.postPlaceholder')}
                onChange={(e) => setPost(e.target.value)}
                className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id={postListId}>
                {posts.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>

            <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm">
              <input
                id={checkboxId}
                type="checkbox"
                checked={issueLetter}
                disabled={issueLetter ? !canEdit : !canIssueLetter}
                onChange={(e) => setIssueLetter(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              {t('dutyLocations.transfer.issueLetter')}
            </label>

            {issueLetter && (
              <>
                <RecipientPickerField name="recipient_id" label_en="To (Recipient)" label_ar="إلى (المستلم)" required={false} />
                <ManagerPickerField name="manager_id" label_en="Signing Manager" label_ar="المدير الموقع" required={false} />
                <MultiRecipientPickerField name="cc" label_en="CC (optional)" label_ar="نسخة إلى (اختياري)" required={false} />
              </>
            )}
          </div>
        </FormProvider>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {issueLetter ? t('dutyLocations.transfer.generate') : t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
