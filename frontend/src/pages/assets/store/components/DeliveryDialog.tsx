import { useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'

import { DialogBody, DialogFooter, DialogShell, Field, FieldGrid, FormAlert, UploadSlot } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, type StoreDeliveryCreate, type StorePickerItem } from '@/lib/api'
import { toast } from '@/lib/toast'
import { todayIso } from '@/pages/vehicles/vehicleUtils'
import {
  batchKey,
  DEFAULT_EXPIRY,
  EMPTY_QUANTITY,
  expiryFromValue,
  type ExpiryValue,
  invalidateStoreQueries,
  isBusinessDate,
  itemName,
  quantityFromParts,
  quantityIssue,
  type QuantityParts,
  storeErrorMessage,
} from '../storeUtils'
import { ExpiryInput } from './ExpiryInput'
import { QuantityInput } from './QuantityInput'
import { StoreItemPicker } from './StoreItemPicker'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (uploadError: string | null) => void
}
interface Line {
  key: number
  item: StorePickerItem | null
  expiry: ExpiryValue
  quantity: QuantityParts
}
interface HeaderValues { received_on: string; note: string }
type LineErrors = Record<number, { item?: string; expiry?: string; quantity?: string }>
const newLine = (key: number): Line => ({ key, item: null, expiry: { ...DEFAULT_EXPIRY }, quantity: { ...EMPTY_QUANTITY } })

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
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const id = useId()
  const nextKey = useRef(1)
  const [lines, setLines] = useState<Line[]>([newLine(0)])
  const [lineErrors, setLineErrors] = useState<LineErrors>({})
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
        catch (error) { uploadError = t('assets.store.deliveries.uploadFailed', { error: storeErrorMessage(error, t) }) }
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
      const text = storeErrorMessage(error, t)
      setMessage(text)
      toast.error(text)
    },
  })
  const updateLine = (key: number, patch: Partial<Line>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))

  function submit(values: HeaderValues): void {
    setMessage(null)
    const invalid: LineErrors = {}
    const seen = new Set<string>()
    const payload: StoreDeliveryCreate['lines'] = []
    for (const line of lines) {
      const issue: LineErrors[number] = {}
      if (!line.item) issue.item = t('assets.store.deliveries.itemRequired')
      const expiry = expiryFromValue(line.expiry)
      if (expiry === undefined) issue.expiry = t('assets.store.deliveries.expiryRequired')
      const quantity = line.item ? quantityFromParts(line.quantity, line.item) : null
      if (quantityIssue(quantity, { min: 1 })) issue.quantity = t('assets.store.deliveries.quantityRequired')
      if (line.item && expiry !== undefined) {
        const key = batchKey(line.item.id, expiry)
        if (seen.has(key)) issue.expiry = t('assets.store.deliveries.duplicateLine')
        seen.add(key)
        if (quantity != null) payload.push({ item_id: line.item.id, expiry, quantity })
      }
      if (Object.keys(issue).length) invalid[line.key] = issue
    }
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
        <section className="flex flex-col gap-3" aria-labelledby={`${id}-lines`}>
          <h3 id={`${id}-lines`} className="font-semibold text-foreground">{t('assets.store.deliveries.lines')}</h3>
          {lines.map((line, index) => {
            const prefix = `${id}-${line.key}`
            const issue = lineErrors[line.key]
            return (
              <fieldset key={line.key} disabled={mutation.isPending} className="min-w-0 border-t border-border pt-3">
                <legend className="px-1 text-sm font-medium text-foreground">{t('assets.store.deliveries.line', { number: index + 1 })}</legend>
                <div className="mb-2 flex justify-end">
                  <Button type="button" variant="ghost" className="min-h-11 text-accent" disabled={lines.length === 1 || mutation.isPending} onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))} aria-label={t('assets.store.deliveries.removeLine', { number: index + 1 })}>
                    <Trash2 aria-hidden className="h-4 w-4" />{t('assets.store.deliveries.remove')}
                  </Button>
                </div>
                <FieldGrid>
                  <Field id={`${prefix}-item`} label={t('assets.store.deliveries.item')} required error={issue?.item}>
                    <StoreItemPicker id={`${prefix}-item`} value={line.item?.id ?? null} onChange={(item) => updateLine(line.key, { item, quantity: { ...EMPTY_QUANTITY } })} disabled={mutation.isPending} invalid={!!issue?.item} describedBy={issue?.item ? `${id}-alert` : undefined} />
                  </Field>
                  <Field id={`${prefix}-quantity`} label={t('assets.store.deliveries.quantity')} required error={issue?.quantity}>
                    {line.item ? <QuantityInput id={`${prefix}-quantity`} item={line.item} value={line.quantity} onChange={(quantity) => updateLine(line.key, { quantity })} label={itemName(line.item, i18n.language)} invalid={!!issue?.quantity} describedBy={issue?.quantity ? `${id}-alert` : undefined} disabled={mutation.isPending} required /> : <p className="py-3 text-sm text-muted-foreground">{t('assets.store.deliveries.selectItemFirst')}</p>}
                  </Field>
                  <Field id={`${prefix}-expiry`} label={t('assets.store.deliveries.expiry')} required full error={issue?.expiry}>
                    <ExpiryInput id={`${prefix}-expiry`} value={line.expiry} onChange={(expiry) => updateLine(line.key, { expiry })} invalid={!!issue?.expiry} describedBy={issue?.expiry ? `${id}-alert` : undefined} disabled={mutation.isPending} />
                  </Field>
                </FieldGrid>
              </fieldset>
            )
          })}
          <Button type="button" variant="secondary" className="min-h-11 self-start" disabled={mutation.isPending} onClick={() => { const key = nextKey.current++; setLines((current) => [...current, newLine(key)]) }}><Plus aria-hidden className="h-4 w-4" />{t('assets.store.deliveries.addLine')}</Button>
        </section>
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

