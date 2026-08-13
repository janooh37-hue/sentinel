/**
 * TransferDialog — move the selected employees to their own destination
 * unit/post and generate ONE General Book transfer letter.
 *
 * The selection can span duty units, and every employee gets their own
 * destination: that is what the letter's fixed intro already promises ("إلى
 * الجهات المبينة بجانب أسمائهم") and it is what makes a swap expressible. A
 * bulk row fills every destination at once for the common mass move; the
 * per-row inputs override it. On confirm it POSTs `/duty/transfer`; on success
 * it toasts a short confirmation and reports the complete transfer result
 * before closing.
 */

import { useId, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage, type DutyTransferResult, type EmployeeListItem } from '@/lib/api'
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
import { cn } from '@/lib/utils'
import { pickEmployeeName } from '@/lib/employeeName'

// ─── component ───────────────────────────────────────────────────────────────

/** One employee's destination while the operator is still editing it. */
interface Destination {
  unit: string
  post: string
}

const EMPTY: Destination = { unit: '', post: '' }
const FIELD =
  'h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export interface TransferDialogProps {
  open: boolean
  /** The employees being moved (the current selection, possibly cross-unit). */
  employees: readonly EmployeeListItem[]
  /** All roster employees — used to derive destination suggestions. */
  allEmployees: readonly EmployeeListItem[]
  onOpenChange: (open: boolean) => void
  /** Called after a successful transfer with its complete result. */
  onTransferred: (result: DutyTransferResult) => void
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
  const unitListId = useId()
  const postListId = useId()

  // The bulk row is a shortcut, not a source of truth: it only writes into the
  // rows when "apply to all" is pressed, so a later per-row edit is never
  // silently overwritten.
  const [bulk, setBulk] = useState<Destination>(EMPTY)
  const [dest, setDest] = useState<Record<string, Destination>>({})

  const units = unitOptions(allEmployees)
  const bulkPosts = postsForUnit(allEmployees, bulk.unit.trim())

  function setRow(id: string, patch: Partial<Destination>): void {
    setDest((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY), ...patch } }))
  }

  const moves = employees.map((e) => {
    const d = dest[e.id] ?? EMPTY
    return { employeeId: e.id, toUnit: d.unit, toPost: d.post }
  })
  const missing = moves.filter((m) => !m.toUnit.trim()).length

  const [initial] = useState(loadTransferDefaults)
  const methods = useForm<{ recipient_id: number | null; manager_id: number | null; cc: string[] }>({
    defaultValues: { recipient_id: initial.recipientId, manager_id: initial.managerId, cc: initial.cc },
  })

  const mutation = useMutation({
    mutationFn: () => {
      const v = methods.getValues()
      return api.transferDuty(
        buildTransferRequest({
          moves,
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
      if (result.book_id == null) {
        toast.success(t('dutyLocations.transfer.movedNoBook', { count: result.moved.length }))
      } else {
        toast.success(t('dutyLocations.transfer.success', { ref: result.ref }))
      }
      onTransferred(result)
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const canSubmit = employees.length > 0 && missing === 0 && !mutation.isPending

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('dutyLocations.transfer.title')}</DialogTitle>
          <DialogDescription>
            {t('dutyLocations.transfer.subtitle', { count: employees.length })}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4 text-sm">
            {/* Bulk destination — the mass-move shortcut */}
            <div className="rounded-lg border border-border bg-surface-raised p-3">
              <span className="mb-2 block text-xs font-semibold text-muted-foreground">
                {t('dutyLocations.transfer.bulkLabel')}
              </span>
              <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  list={unitListId}
                  value={bulk.unit}
                  dir="auto"
                  autoComplete="off"
                  aria-label={t('dutyLocations.transfer.destUnit')}
                  placeholder={t('dutyLocations.field.unitPlaceholder')}
                  onChange={(e) => setBulk({ unit: e.target.value, post: '' })}
                  className={FIELD}
                />
                <input
                  list={`${postListId}-bulk`}
                  value={bulk.post}
                  dir="auto"
                  autoComplete="off"
                  aria-label={t('dutyLocations.transfer.destPost')}
                  placeholder={t('dutyLocations.field.postPlaceholder')}
                  onChange={(e) => setBulk((b) => ({ ...b, post: e.target.value }))}
                  className={FIELD}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!bulk.unit.trim()}
                  onClick={() =>
                    setDest(Object.fromEntries(employees.map((e) => [e.id, { ...bulk }])))
                  }
                >
                  {t('dutyLocations.transfer.applyToAll')}
                </Button>
              </div>
              <datalist id={`${postListId}-bulk`}>
                {bulkPosts.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>

            {/* One destination per employee */}
            <div className="max-h-[40vh] overflow-y-auto rounded-md border border-hairline">
              {employees.map((e) => {
                const d = dest[e.id] ?? EMPTY
                const name = pickEmployeeName(e, i18n.language)
                return (
                  <div
                    key={e.id}
                    className={cn(
                      'grid items-center gap-2.5 border-t border-hairline px-3 py-2.5 first:border-t-0',
                      'sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]',
                      !d.unit.trim() && 'bg-warning-soft',
                    )}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono font-semibold text-primary">{e.id}</span>
                      <span dir="auto">{name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground" dir="auto">
                      {t('dutyLocations.transfer.rowFrom')}:{' '}
                      {e.duty_unit
                        ? `${e.duty_unit}${e.duty_post ? ` - ${e.duty_post}` : ''}`
                        : t('dutyLocations.unassigned')}
                    </div>
                    <input
                      list={unitListId}
                      value={d.unit}
                      dir="auto"
                      autoComplete="off"
                      aria-label={t('dutyLocations.transfer.rowUnitAria', { name })}
                      placeholder={t('dutyLocations.transfer.destUnit')}
                      onChange={(ev) => setRow(e.id, { unit: ev.target.value, post: '' })}
                      className={FIELD}
                    />
                    <input
                      list={`${postListId}-${e.id}`}
                      value={d.post}
                      dir="auto"
                      autoComplete="off"
                      aria-label={t('dutyLocations.transfer.rowPostAria', { name })}
                      placeholder={t('dutyLocations.transfer.destPost')}
                      onChange={(ev) => setRow(e.id, { post: ev.target.value })}
                      className={FIELD}
                    />
                    <datalist id={`${postListId}-${e.id}`}>
                      {postsForUnit(allEmployees, d.unit.trim()).map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                )
              })}
            </div>

            {/* Letter metadata */}
            <div className="grid gap-3 md:grid-cols-2">
              <RecipientPickerField name="recipient_id" label_en="To (Recipient)" label_ar="إلى (المستلم)" required={false} />
              <ManagerPickerField name="manager_id" label_en="Signing Manager" label_ar="المدير الموقع" required={false} />
              <div className="md:col-span-2">
                <MultiRecipientPickerField name="cc" label_en="CC (optional)" label_ar="نسخة إلى (اختياري)" required={false} />
              </div>
            </div>

            <datalist id={unitListId}>
              {units.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
        </FormProvider>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          {missing > 0 && (
            <span className="me-auto text-xs text-warning">
              {t('dutyLocations.transfer.missingUnit')}
            </span>
          )}
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
