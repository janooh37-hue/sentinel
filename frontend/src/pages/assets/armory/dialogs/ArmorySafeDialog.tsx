import { zodResolver } from '@hookform/resolvers/zod'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { DialogBody, DialogFooter, DialogShell, Field, FieldGrid, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NATIVE_SELECT } from '@/components/ui/native-select'
import type { ArmoryDutyPostRead, ArmorySafeRead } from '@/lib/api'
import { isolateBidi } from '@/lib/useCapabilityCatalog'
import { useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, isArmoryAccessError, useArmoryAccess, useArmorySiteOptions, useCreateArmorySafe } from '../armoryQueries'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  onSaved(safe: ArmorySafeRead): void
  returnFocusRef: React.RefObject<HTMLElement | null>
}

const nameField = z.string().trim().min(1, 'assets.armory.shell.needBothNames')
const schema = z.object({ name_en: nameField, name_ar: nameField, site: z.string(), post: z.string() })
const SELECT_CLASS = `${NATIVE_SELECT} min-h-11 w-full`

function dutyPath(post: ArmoryDutyPostRead): string {
  return JSON.stringify([post.duty_unit, post.duty_post])
}

export function ArmorySafeDialog(props: Props): React.JSX.Element | null {
  const { canEdit, principal } = useArmoryAccess()
  return props.open && canEdit ? <SafeEditor key={principal} {...props} /> : null
}

function SafeEditor({ open, onOpenChange, onSaved, returnFocusRef }: Props): React.JSX.Element {
  const { t, name } = useArmoryLocale()
  const options = useArmorySiteOptions()
  const createSafe = useCreateArmorySafe()
  const id = useId()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.input<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name_en: '', name_ar: '', site: '', post: '' },
  })
  const denied = isArmoryAccessError(options.error) || isArmoryAccessError(createSafe.error)
  const busy = createSafe.isPending
  const nameError = errors.name_en?.message ?? errors.name_ar?.message
  const serverError = createSafe.error ?? options.error

  const submit = handleSubmit(values => {
    if (busy || denied || !options.data) return
    const site = options.data.vehicle_sites.find(site => String(site.id) === values.site)
    const post = options.data.duty_posts.find(post => dutyPath(post) === values.post)
    createSafe.mutate({
      name_en: values.name_en,
      name_ar: values.name_ar,
      vehicle_site_id: site?.id ?? null,
      duty_unit: post?.duty_unit ?? null,
      duty_post: post?.duty_post ?? null,
    }, {
      onSuccess: safe => { onSaved(safe); onOpenChange(false) },
      onError: error => { if (isArmoryAccessError(error)) reset() },
    })
  })

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} busy={busy} title={t('assets.armory.addSafe')}
      description={t('assets.armory.safeDialogHint')} size="md" returnFocusRef={returnFocusRef}>
      <form noValidate className="flex min-h-0 flex-1 flex-col" aria-busy={busy} onSubmit={submit}>
        <DialogBody>
          <FormAlert id={`${id}-server`} message={serverError ? armoryErrorMessage(serverError) : null} />
          {!denied && (
            <>
              <FormAlert id={`${id}-names`} message={nameError ? t(nameError) : null} />
              <fieldset disabled={busy} className="min-w-0">
                <FieldGrid>
                  <Field id={`${id}-en`} label={t('assets.armory.safeNameEn')} required>
                    <Input id={`${id}-en`} {...register('name_en')} dir="ltr" required maxLength={120} className="min-h-11"
                      aria-invalid={!!errors.name_en} aria-describedby={errors.name_en ? `${id}-names` : undefined} />
                  </Field>
                  <Field id={`${id}-ar`} label={t('assets.armory.safeNameAr')} required>
                    <Input id={`${id}-ar`} {...register('name_ar')} dir="rtl" required maxLength={120} className="min-h-11"
                      aria-invalid={!!errors.name_ar} aria-describedby={errors.name_ar ? `${id}-names` : undefined} />
                  </Field>
                  {options.data && (
                    <>
                      <Field id={`${id}-site`} label={t('assets.armory.vehicleSite')} full>
                        <select id={`${id}-site`} {...register('site')} className={SELECT_CLASS}>
                          <option value="">{t('assets.armory.notLinked')}</option>
                          {options.data.vehicle_sites.map(site => <option key={site.id} value={site.id} dir="auto">{name(site)}</option>)}
                        </select>
                      </Field>
                      <Field id={`${id}-post`} label={t('assets.armory.dutyPost')} full>
                        <select id={`${id}-post`} {...register('post')} className={SELECT_CLASS} aria-describedby={`${id}-post-help`}>
                          <option value="">{t('assets.armory.notLinked')}</option>
                          {options.data.duty_posts.map(post => {
                            const path = dutyPath(post)
                            return <option key={path} value={path}>{t('assets.armory.shell.dutyPath', { unit: isolateBidi(post.duty_unit), post: isolateBidi(post.duty_post) })}</option>
                          })}
                        </select>
                        <p id={`${id}-post-help`} className="text-xs text-muted-foreground">{t('assets.armory.dutyPostHint')}</p>
                      </Field>
                    </>
                  )}
                </FieldGrid>
              </fieldset>
              {!options.data && options.isPending && <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
              {options.isError && <Button type="button" variant="outline" className="min-h-11 self-start" onClick={() => void options.refetch()}>{t('assets.armory.retry')}</Button>}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={busy} className="min-h-11" onClick={() => onOpenChange(false)}>{t('assets.armory.cancel')}</Button>
          {!denied && (
            <Button type="submit" className="min-h-11" disabled={busy || !options.data}>
              {t(busy ? 'common.saving' : 'assets.armory.saveSafe')}
            </Button>
          )}
        </DialogFooter>
      </form>
    </DialogShell>
  )
}
