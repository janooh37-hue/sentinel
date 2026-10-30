import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogFooter, DialogShell, Field, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, type StoreDisposalCreate, type StoreDisposalReason } from '@/lib/api'
import { toast } from '@/lib/toast'
import { todayIso } from '@/pages/vehicles/vehicleUtils'

import { StoreQueryState } from '../StoreQueryState'
import {
  EMPTY_QUANTITY,
  expiryInput,
  invalidateStoreQueries,
  isBusinessDate,
  itemName,
  quantityFromParts,
  quantityIssue,
  type QuantityParts,
  storeErrorMessage,
  storeKeys,
} from '../storeUtils'
import { QuantityInput } from './QuantityInput'
import { ExpiryText } from './ExpiryText'
import { StoreQuantity } from './RecordParts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Values {
  batchId: string
  quantity: QuantityParts
  disposed_on: string
  reason: StoreDisposalReason
  note: string
}

export function DisposalDialog({ open, onOpenChange }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const id = useId()
  const alertId = `${id}-alert`
  const [serverError, setServerError] = useState<string | null>(null)
  const batchesQuery = useQuery({
    queryKey: storeKeys.batches(),
    queryFn: () => api.listStoreBatches(),
    enabled: open,
  })
  const batches = batchesQuery.data?.filter((batch) => batch.on_hand > 0) ?? []
  const { register, control, handleSubmit, setValue, clearErrors, formState: { errors } } = useForm<Values>({
    defaultValues: { batchId: '', quantity: EMPTY_QUANTITY, disposed_on: todayIso(), reason: 'damaged', note: '' },
  })
  const batchId = useWatch({ control, name: 'batchId' })
  const batch = batches.find((option) => String(option.id) === batchId)
  const mutation = useMutation({
    mutationFn: (body: StoreDisposalCreate) => api.createStoreDisposal(body),
    onSuccess: () => {
      invalidateStoreQueries(queryClient)
      toast.success(t('assets.store.disposals.saved'))
      onOpenChange(false)
    },
    onError: (error) => setServerError(storeErrorMessage(error)),
  })
  const validationError = errors.batchId?.message ?? errors.quantity?.message ?? errors.disposed_on?.message ?? null

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.store.disposals.record')} description={t('assets.store.disposals.dialogDescription')} busy={mutation.isPending}>
      <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit((values) => {
        if (!batch) return
        const quantity = quantityFromParts(values.quantity, batch)
        if (quantity === null || quantityIssue(quantity, { min: 1, max: batch.on_hand })) return
        setServerError(null)
        mutation.mutate({ disposed_on: values.disposed_on, item_id: batch.item_id, expiry: expiryInput(batch), quantity, reason: values.reason, note: values.note.trim() || null })
      })}>
        <DialogBody>
          <FormAlert id={alertId} message={serverError ?? validationError} />
          <StoreQueryState isPending={batchesQuery.isPending} error={batchesQuery.error} onRetry={() => { void batchesQuery.refetch() }} isEmpty={batches.length === 0} emptyMessage={t('assets.store.disposals.noBatches')} emptyDescription={t('assets.store.disposals.noBatchesDescription')}>
            <Field id={`${id}-batch`} label={t('assets.store.disposals.batch')} required>
              <Controller control={control} name="batchId" rules={{ validate: (value) => batches.some((option) => String(option.id) === value) || t('assets.store.disposals.batchRequired') }} render={({ field }) => (
                <Select value={field.value} onValueChange={(value) => {
                  field.onChange(value)
                  const selected = batches.find((option) => String(option.id) === value)
                  setValue('reason', selected?.days_to_expiry != null && selected.days_to_expiry < 0 ? 'expired' : 'damaged')
                  setValue('quantity', EMPTY_QUANTITY)
                  clearErrors(['quantity', 'batchId'])
                  setServerError(null)
                }} disabled={mutation.isPending}>
                  <SelectTrigger ref={field.ref} id={`${id}-batch`} className="min-h-11 text-start motion-reduce:transition-none" aria-invalid={!!errors.batchId} aria-describedby={errors.batchId ? alertId : undefined} aria-required>
                    <SelectValue placeholder={t('assets.store.disposals.chooseBatch')} />
                  </SelectTrigger>
                  <SelectContent>
                    {batches.map((option) => (
                      <SelectItem key={option.id} value={String(option.id)} className="min-h-11">
                        <bdi dir="ltr" className="font-mono tabular-nums">{option.item_code}</bdi>{' · '}
                        <span dir="auto">{itemName(option, i18n.language)}</span>{' · '}
                        <ExpiryText batch={option} />{' · '}
                        {t('assets.store.disposals.onHand')}{': '}
                        <StoreQuantity value={option.on_hand} item={option} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </Field>
            {batch && (
              <Field id={`${id}-quantity`} label={t('assets.store.disposals.quantity')} required>
                <p className="text-xs text-muted-foreground">{t('assets.store.disposals.onHand')}{': '}<StoreQuantity value={batch.on_hand} item={batch} /></p>
                <Controller control={control} name="quantity" rules={{ validate: (value) => {
                  const issue = quantityIssue(quantityFromParts(value, batch), { min: 1, max: batch.on_hand })
                  if (issue === 'aboveMax') return t('assets.store.disposals.quantityExceedsStock')
                  return !issue || t('assets.store.disposals.quantityRequired')
                } }} render={({ field }) => (
                  <QuantityInput id={`${id}-quantity`} item={batch} value={field.value} onChange={field.onChange} label={t('assets.store.disposals.quantity')} invalid={!!errors.quantity} describedBy={errors.quantity ? alertId : undefined} disabled={mutation.isPending} required />
                )} />
              </Field>
            )}
            <fieldset disabled={mutation.isPending} className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium">{t('assets.store.disposals.reason')}</legend>
              <div className="flex flex-wrap gap-3">
                {(['expired', 'damaged'] as const).map((reason) => (
                  <label key={reason} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm">
                    <input type="radio" value={reason} {...register('reason')} className="h-4 w-4 accent-primary" />
                    {t(`assets.store.disposals.reasons.${reason}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field id={`${id}-date`} label={t('assets.store.disposals.disposedOn')} required>
              <Input id={`${id}-date`} type="date" max={todayIso()} dir="ltr" className="min-h-11 font-mono tabular-nums" disabled={mutation.isPending} aria-invalid={!!errors.disposed_on} aria-describedby={errors.disposed_on ? alertId : undefined} {...register('disposed_on', { required: t('assets.store.disposals.dateRequired'), validate: (value) => isBusinessDate(value) || t('assets.store.errors.dateInFuture') })} />
            </Field>
            <Field id={`${id}-note`} label={t('assets.store.disposals.note')}>
              <Textarea id={`${id}-note`} dir="auto" disabled={mutation.isPending} {...register('note')} />
            </Field>
          </StoreQueryState>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" className="min-h-11" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button type="submit" className="min-h-11" disabled={mutation.isPending || !batch || !!batchesQuery.error}>{mutation.isPending ? t('assets.store.disposals.saving') : t('assets.store.disposals.record')}</Button>
        </DialogFooter>
      </form>
    </DialogShell>
  )
}

