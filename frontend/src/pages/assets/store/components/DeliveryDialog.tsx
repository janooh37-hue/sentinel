import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogFooter, DialogShell, Field, FieldGrid, FormAlert, UploadSlot } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, type StoreDeliveryCreate } from '@/lib/api'
import { toast } from '@/lib/toast'
import { todayIso } from '@/pages/vehicles/vehicleUtils'
import { invalidateStoreQueries, isBusinessDate, storeErrorMessage } from '../storeUtils'
import { DeliveryLines } from './DeliveryLines'
import { createDeliveryLines, type DeliveryLineErrors, validateDeliveryLines } from './deliveryLineModel'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (uploadError: string | null) => void
}
interface HeaderValues { received_on: string; note: string }

export function DeliveryDialog({ open, onOpenChange, onSaved }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.store.deliveries.log')} description={t('assets.store.deliveries.dialogDescription')} size="xl" busy={busy}>
      {open && <DeliveryForm onOpenChange={onOpenChange} onSaved={onSaved} onBusyChange={setBusy} />}
    </DialogShell>
  )
}

function DeliveryForm({ onOpenChange, onSaved, onBusyChange }: Omit<Props, 'open'> & { onBusyChange: (busy: boolean) => void }): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const id = useId()
  const [lines, setLines] = useState(() => createDeliveryLines())
  const [lineErrors, setLineErrors] = useState<DeliveryLineErrors>({})
  const [message, setMessage] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors } } = useForm<HeaderValues>({ defaultValues: { received_on: todayIso(), note: '' } })
  const mutation = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async (body: StoreDeliveryCreate) => {
      const delivery = await api.createStoreDelivery(body)
      // Creation is durable even if attaching the supporting document fails.
      let uploadError: string | null = null
      if (file) {
        try { await api.uploadStoreDeliveryNote(delivery.id, file) }
        catch (error) { uploadError = t('assets.store.deliveries.uploadFailed', { error: storeErrorMessage(error) }) }
      }
      return { uploadError }
    },
    onSuccess: ({ uploadError }) => {
      invalidateStoreQueries(qc)
      if (uploadError) toast.error(uploadError)
      else toast.success(t('assets.store.deliveries.saved'))
      onSaved?.(uploadError)
      onOpenChange(false)
    },
    onError: (error) => {
      const text = storeErrorMessage(error)
      setMessage(text)
      toast.error(text)
    },
  })

  function submit(values: HeaderValues): void {
    setMessage(null)
    const { errors: invalid, payload } = validateDeliveryLines(lines, t)
    setLineErrors(invalid)
    if (Object.keys(invalid).length || fileError) {
      setMessage(t('assets.store.deliveries.correctFields'))
      return
    }
    mutation.mutate({ received_on: values.received_on, note: values.note.trim() || null, lines: payload })
  }

  function chooseFile(chosen: File): void {
    let error: string | null = null
    if (chosen.size > 10 * 1024 * 1024) error = t('assets.store.errors.noteFileTooLarge')
    else if (!chosen.size) error = t('assets.store.errors.noteFileEmpty')
    else if (!/\.(pdf|png|jpe?g|webp)$/i.test(chosen.name)) error = t('assets.store.errors.noteFileBadFormat')
    setFileError(error)
    setFile(error ? null : chosen)
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" noValidate onSubmit={handleSubmit(submit)}>
      <DialogBody>
        <FormAlert id={`${id}-alert`} message={message} />
        <FieldGrid>
          <Field id={`${id}-date`} label={t('assets.store.deliveries.receivedOn')} required error={errors.received_on?.message}>
            <Input id={`${id}-date`} type="date" dir="ltr" max={todayIso()} className="min-h-11 font-mono tabular-nums" aria-invalid={!!errors.received_on || undefined} {...register('received_on', {
              required: t('assets.store.deliveries.dateRequired'),
              validate: (value) => isBusinessDate(value) || t('assets.store.deliveries.dateRequired'),
            })} disabled={mutation.isPending} />
          </Field>
          <Field id={`${id}-note`} label={t('assets.store.deliveries.note')}>
            <Textarea id={`${id}-note`} dir="auto" className="min-h-11" {...register('note')} disabled={mutation.isPending} />
          </Field>
        </FieldGrid>
        <DeliveryLines idPrefix={id} lines={lines} onChange={setLines} errors={lineErrors} alertId={`${id}-alert`} disabled={mutation.isPending} />
        <div className="[&_button]:min-h-11 [&_button]:min-w-11 [&_*]:motion-reduce:transition-none">
          <UploadSlot label={t('assets.store.deliveries.deliveryNote')} accept=".pdf,.png,.jpg,.jpeg,.webp" file={file} onFile={chooseFile} onClear={() => { setFile(null); setFileError(null) }} clearLabel={t('assets.store.deliveries.clearFile')} hint={t('assets.store.deliveries.fileHint')} disabled={mutation.isPending} />
        </div>
        <FormAlert id={`${id}-file-error`} message={fileError} />
        {fileError && (
          <Button type="button" variant="ghost" className="min-h-11 self-start" disabled={mutation.isPending} onClick={() => setFileError(null)}>
            {t('assets.store.deliveries.clearFile')}
          </Button>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" className="min-h-11" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>{t('common.cancel')}</Button>
        <Button type="submit" className="min-h-11" disabled={mutation.isPending}>{t(mutation.isPending ? 'assets.store.deliveries.saving' : 'assets.store.deliveries.save')}</Button>
      </DialogFooter>
    </form>
  )
}

