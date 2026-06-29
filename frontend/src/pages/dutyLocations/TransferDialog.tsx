/**
 * TransferDialog — move the selected employees to a destination unit/post and
 * generate a General Book transfer letter.
 *
 * Shows the employees being moved (G# · name · current unit·post), asks for
 * destination unit + post (free-form comboboxes), recipient, signing manager,
 * and optional CC. On confirm it POSTs `/duty/transfer`; on success it toasts
 * with a "View record" action that opens `/books/:id`.
 */

import { useId, useMemo, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { api, ApiError, type EmployeeListItem } from '@/lib/api'
import { unitOptions, postsForUnit } from '@/lib/dutyUnits'
import { buildTransferRequest } from './transferRequest'
import { loadTransferDefaults, saveTransferDefaults } from './transferDefaults'
import { RecipientPickerField } from '@/components/application/fields/RecipientPickerField'
import { ManagerPickerField } from '@/components/application/fields/ManagerPickerField'
import { MultiRecipientPickerField } from '@/components/application/fields/MultiRecipientPickerField'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { pickEmployeeName } from '@/lib/employeeName'

// ─── component ───────────────────────────────────────────────────────────────

export interface TransferDialogProps {
  open: boolean
  /** The employees being moved (the current selection). */
  employees: readonly EmployeeListItem[]
  /** All roster employees — used to derive destination suggestions. */
  allEmployees: readonly EmployeeListItem[]
  onOpenChange: (open: boolean) => void
  /** Called after a successful transfer (clears the selection). */
  onTransferred: () => void
}

export function TransferDialog({
  open,
  employees,
  allEmployees,
  onOpenChange,
  onTransferred,
}: TransferDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const unitListId = useId()
  const postListId = useId()

  const [toUnit, setToUnit] = useState('')
  const [toPost, setToPost] = useState('')

  const units = unitOptions(allEmployees)
  const posts = postsForUnit(allEmployees, toUnit.trim())

  const employeeIds = useMemo(() => employees.map((e) => e.id), [employees])

  const [initial] = useState(loadTransferDefaults)
  const methods = useForm<{ recipient_id: number | null; manager_id: number | null; cc: string[] }>({
    defaultValues: { recipient_id: initial.recipientId, manager_id: initial.managerId, cc: initial.cc },
  })

  const mutation = useMutation({
    mutationFn: () => {
      const v = methods.getValues()
      return api.transferDuty(
        buildTransferRequest({
          employeeIds,
          toUnit,
          toPost,
          recipientId: v.recipient_id,
          managerId: v.manager_id,
          cc: v.cc,
        }),
      )
    },
    onSuccess: (result) => {
      const v = methods.getValues()
      saveTransferDefaults({ recipientId: v.recipient_id, managerId: v.manager_id, cc: v.cc })
      void qc.invalidateQueries({ queryKey: ['employees'] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('dutyLocations.transfer.success', { ref: result.ref }), {
        action: {
          label: t('dutyLocations.transfer.viewRecord'),
          onClick: () => navigate(`/books/${result.book_id}`),
        },
      })
      onTransferred()
      onOpenChange(false)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const canSubmit = toUnit.trim().length > 0 && employees.length > 0 && !mutation.isPending

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('dutyLocations.transfer.title')}</DialogTitle>
          <DialogDescription>
            {t('dutyLocations.transfer.subtitle', { count: employees.length })}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <div className="grid gap-5 overflow-y-auto px-4 py-4 text-sm md:grid-cols-[1.1fr_1fr]">
            {/* Employees being moved */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {t('dutyLocations.transfer.movingLabel')}
              </span>
              <ul className="max-h-64 overflow-y-auto rounded-md border border-hairline">
                {employees.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-t border-hairline px-3 py-2 first:border-t-0"
                  >
                    <span className="font-mono font-semibold text-primary">{e.id}</span>
                    <span dir="auto">{pickEmployeeName(e, i18n.language)}</span>
                    <span className="ms-auto text-xs text-faint" dir="auto">
                      {e.duty_unit
                        ? `${e.duty_unit}${e.duty_post ? ` · ${e.duty_post}` : ''}`
                        : t('dutyLocations.unassigned')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Destination form */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${unitListId}-input`} className="text-xs font-semibold text-muted-foreground">
                  {t('dutyLocations.transfer.destUnit')}
                </label>
                <input
                  id={`${unitListId}-input`}
                  list={unitListId}
                  value={toUnit}
                  dir="auto"
                  autoComplete="off"
                  placeholder={t('dutyLocations.field.unitPlaceholder')}
                  onChange={(e) => setToUnit(e.target.value)}
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
                  value={toPost}
                  dir="auto"
                  autoComplete="off"
                  placeholder={t('dutyLocations.field.postPlaceholder')}
                  onChange={(e) => setToPost(e.target.value)}
                  className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <datalist id={postListId}>
                  {posts.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>

              <RecipientPickerField name="recipient_id" label_en="To (Recipient)" label_ar="إلى (المستلم)" required={false} />
              <ManagerPickerField name="manager_id" label_en="Signing Manager" label_ar="المدير الموقع" required={false} />
              <MultiRecipientPickerField name="cc" label_en="CC (optional)" label_ar="نسخة إلى (اختياري)" required={false} />
            </div>
          </div>
        </FormProvider>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="commit"
            size="commit"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
          >
            {t('dutyLocations.transfer.generate')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
