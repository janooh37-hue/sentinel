/**
 * ItemPermitFormDialog — issue (or edit) an item-entry permit: the materials an
 * employee may bring into a zone. Create also picks the signing manager and
 * whether to send the generated 1/5 letter for approval straight away.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { api, apiErrorMessage, type ItemPermitRead, type ItemPermitZone } from '@/lib/api'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { NotifyEmployeeToggle as ToggleRow } from '@/components/notify/NotifyEmployeeToggle'
import { EmployeePicker } from '@/pages/application/EmployeePicker'

const DEFAULT_RECIPIENT = 'مسؤول وحدة التفتيش'
const DEFAULT_SITE = 'مبنى مركز الإصلاح والتأهيل الوثبة - 2'
const ZONES: ItemPermitZone[] = ['red', 'green']

const inputCls =
  'h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

// Messages are i18n keys, translated where rendered.
const REQUIRED = 'permits.items.form.required'
const schema = z.object({
  employee_id: z.string().min(1, 'permits.items.form.employeeRequired'),
  recipient: z.string().trim().min(1, REQUIRED).max(255),
  zone: z.enum(['red', 'green']),
  site: z.string().trim().min(1, REQUIRED).max(255),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'permits.items.form.itemNameRequired').max(255),
        quantity: z.coerce
          .number('permits.items.form.quantityInvalid')
          .int('permits.items.form.quantityInvalid')
          .min(1, 'permits.items.form.quantityInvalid')
          .max(1_000_000, 'permits.items.form.quantityInvalid'),
      }),
    )
    .min(1)
    .max(50),
  manager_id: z.number().nullable(),
  send_for_approval: z.boolean(),
})
type FormInput = z.input<typeof schema>
type Values = z.output<typeof schema>

const defaults = (permit?: ItemPermitRead | null): FormInput => ({
  employee_id: permit?.employee_id ?? '',
  recipient: permit?.recipient ?? DEFAULT_RECIPIENT,
  zone: permit?.zone ?? 'red',
  site: permit?.site ?? DEFAULT_SITE,
  items: permit?.items.map((i) => ({ name: i.name, quantity: i.quantity })) ?? [
    { name: '', quantity: 1 },
  ],
  manager_id: permit?.manager_id ?? null,
  // On by default: a new permit should reach its signing manager without a second step.
  send_for_approval: true,
})

interface Props {
  open: boolean
  /** When set, the dialog edits this item permit instead of creating one. */
  permit?: ItemPermitRead | null
  onOpenChange: (open: boolean) => void
  onSaved?: (permit: ItemPermitRead) => void
}

export function ItemPermitFormDialog({
  open,
  permit,
  onOpenChange,
  onSaved,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isEdit = Boolean(permit)

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormInput, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults(permit),
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const managerId = useWatch({ control, name: 'manager_id' })
  const sendForApproval = useWatch({ control, name: 'send_for_approval' })

  // Re-seed each time the dialog opens so a reopen starts clean (create) or
  // from the record's current values (edit).
  useEffect(() => {
    if (open) reset(defaults(permit))
  }, [open, permit, reset])

  // Managers list (only needed in create mode; skip in edit)
  const { data: managers } = useQuery({
    queryKey: ['managers-list'],
    queryFn: () => api.listManagers(),
    enabled: !isEdit,
    staleTime: 60_000,
  })
  // The approval chain reaches the manager through his linked login account.
  const canRoute = Boolean(managers?.find((m) => m.id === managerId)?.user_id)

  const mutation = useMutation({
    mutationFn: (v: Values): Promise<ItemPermitRead> => {
      const body = {
        employee_id: v.employee_id,
        recipient: v.recipient,
        zone: v.zone,
        site: v.site,
        items: v.items,
      }
      return permit
        ? api.updateItemPermit(permit.id, body)
        : api.createItemPermit({
            ...body,
            manager_id: v.manager_id,
            send_for_approval: v.send_for_approval,
          })
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['item-permits-list'] })
      void qc.invalidateQueries({ queryKey: ['item-permit', data.id] })
      void qc.invalidateQueries({ queryKey: ['books', 'permit'] })
      if (permit) toast.success(t('common.savedToast'))
      onSaved?.(data)
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const err = (message: string | undefined): React.JSX.Element | null =>
    message ? <p className="text-xs text-destructive">{t(message)}</p> : null

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('permits.items.form.editTitle') : t('permits.items.form.newTitle')}
          </DialogTitle>
          <DialogDescription>{t('permits.items.form.help')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleSubmit((v) => mutation.mutate(v))}
          noValidate
        >
          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-4 text-sm">
            {/* Employee */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t('permits.items.form.employee')}</span>
              <Controller
                control={control}
                name="employee_id"
                render={({ field }) => (
                  <EmployeePicker
                    selectedId={field.value || null}
                    onSelect={(id) => field.onChange(id ?? '')}
                    ariaLabel={t('permits.items.form.employee')}
                  />
                )}
              />
              {err(errors.employee_id?.message)}
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t('permits.items.form.recipient')}</span>
              <input className={inputCls} dir="auto" {...register('recipient')} />
              {err(errors.recipient?.message)}
            </label>

            {/* Zone */}
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend className="mb-1.5 text-xs text-muted-foreground">
                {t('permits.items.form.zone')}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {ZONES.map((z) => (
                  <label key={z} className="cursor-pointer">
                    <input type="radio" value={z} className="peer sr-only" {...register('zone')} />
                    <span
                      className={`flex h-9 items-center justify-center rounded-md border border-input bg-surface text-sm font-medium peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${
                        z === 'red'
                          ? 'peer-checked:border-destructive peer-checked:bg-destructive/10 peer-checked:text-destructive'
                          : 'peer-checked:border-success peer-checked:bg-success/10 peer-checked:text-success'
                      }`}
                    >
                      {t(`permits.zone.${z}`)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t('permits.items.form.site')}</span>
              <input className={inputCls} dir="auto" {...register('site')} />
              {err(errors.site?.message)}
            </label>

            {/* Items */}
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  {t('permits.items.form.items')}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                  disabled={fields.length >= 50}
                  onClick={() => append({ name: '', quantity: 1 })}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('permits.items.form.addItem')}
                </button>
              </div>
              {fields.map((field, i) => {
                const rowErr = errors.items?.[i]
                return (
                  <div key={field.id} className="flex flex-col gap-1">
                    <div className="grid grid-cols-[1fr_5rem_auto] items-center gap-2">
                      <input
                        className={inputCls}
                        dir="auto"
                        placeholder={t('permits.items.form.itemName')}
                        aria-label={`${t('permits.items.form.itemName')} ${i + 1}`}
                        {...register(`items.${i}.name`)}
                      />
                      <input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        className={`${inputCls} font-mono`}
                        aria-label={`${t('permits.items.form.quantity')} ${i + 1}`}
                        {...register(`items.${i}.quantity`)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={fields.length === 1}
                        aria-label={t('permits.items.form.removeItem')}
                        onClick={() => remove(i)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                    {err(rowErr?.name?.message)}
                    {err(rowErr?.quantity?.message)}
                  </div>
                )
              })}
            </div>

            {/* Signing manager — create only */}
            {!isEdit && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">{t('permits.form.signingManager')}</span>
                <select
                  className={inputCls}
                  {...register('manager_id', { setValueAs: (v) => (v ? Number(v) : null) })}
                >
                  <option value="">—</option>
                  {managers?.filter((m) => m.active).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name_en ?? m.name_ar ?? m.title ?? String(m.id)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* Send for approval — on by default; off holds the letter as a draft */}
            {!isEdit && (
              <div className="flex flex-col gap-1.5">
                <Controller
                  control={control}
                  name="send_for_approval"
                  render={({ field }) => (
                    <ToggleRow
                      checked={field.value}
                      onChange={field.onChange}
                      label={t('permits.form.sendForApproval')}
                      hint={t('permits.form.sendForApprovalHint')}
                    />
                  )}
                />
                {/* The chain routes via the manager's login account. Without one
                    the letter silently stays a draft — say so before it happens. */}
                {sendForApproval && !canRoute && (
                  <p className="text-[0.75em] text-warning">
                    {t('permits.form.sendForApprovalUnroutable')}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {isEdit ? t('permits.items.form.save') : t('permits.items.form.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}
