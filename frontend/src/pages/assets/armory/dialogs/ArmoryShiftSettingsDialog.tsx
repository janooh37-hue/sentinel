import { zodResolver } from '@hookform/resolvers/zod'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import { useId, useState, type ReactNode } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'

import { DialogBody, DialogFooter, DialogShell, Field, FieldGrid, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiError, type ArmorySettingsRead, type ArmorySettingsUpdate, type Versioned } from '@/lib/api'
import { normalizeDigits } from '@/lib/utils'
import { Ltr } from '../ArmoryLtr'
import { displayDate, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, isArmoryAccessError, useArmoryAccess, useArmorySettings, useUpdateArmorySettings } from '../armoryQueries'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  onSaved(): void
  returnFocusRef: React.RefObject<HTMLElement | null>
}

type SettingsVersion = Versioned<ArmorySettingsRead>
type SettingsQuery = UseQueryResult<SettingsVersion>

const hhmm = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const startTime = z.string().regex(hhmm, 'assets.armory.shell.needTime')
const schema = z.object({
  day_start: startTime,
  night_start: startTime,
  grace_minutes: z.string().refine(value => /^\d+$/.test(value) && Number(value) <= 1440, 'assets.armory.needGrace'),
}).refine(values => !hhmm.test(values.day_start) || !hhmm.test(values.night_start) || values.day_start < values.night_start, {
  path: ['night_start'], message: 'assets.armory.dayBeforeNight',
})

export function ArmoryShiftSettingsDialog(props: Props): React.JSX.Element | null {
  const { canEdit, principal } = useArmoryAccess()
  return props.open && canEdit ? <SettingsEditor key={principal} {...props} /> : null
}

function SettingsEditor({ open, onOpenChange, onSaved, returnFocusRef }: Props): React.JSX.Element {
  const { t } = useArmoryLocale()
  const settings = useArmorySettings()
  const update = useUpdateArmorySettings()
  const id = useId()
  const denied = isArmoryAccessError(settings.error) || isArmoryAccessError(update.error)

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} busy={update.isPending} title={t('assets.armory.shiftSettings')}
      description={t('assets.armory.settingsEffective')} size="md" returnFocusRef={returnFocusRef}>
      {settings.data && !denied ? (
        <PolicyForm version={settings.data} settings={settings} update={update} onSaved={onSaved} onOpenChange={onOpenChange} />
      ) : (
        <>
          <DialogBody>
            <FormAlert id={`${id}-load`} message={update.error || settings.error ? armoryErrorMessage(update.error ?? settings.error) : null} />
            {settings.isPending && !denied && <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
            {settings.isError && !denied && <Button type="button" variant="outline" className="min-h-11 self-start" onClick={() => void settings.refetch()}>{t('assets.armory.retry')}</Button>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => onOpenChange(false)}>{t('assets.armory.cancel')}</Button>
          </DialogFooter>
        </>
      )}
    </DialogShell>
  )
}

function PolicySummary({ policy, title }: { policy: ArmorySettingsRead['current']; title: ReactNode }): React.JSX.Element {
  const { t } = useArmoryLocale()
  return (
    <div className="min-w-0 rounded-md bg-surface-raised p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('assets.armory.dayStart')}</dt><dd><Ltr className="tabular-nums">{policy.day_start.slice(0, 5)}</Ltr></dd>
        <dt className="text-muted-foreground">{t('assets.armory.nightStart')}</dt><dd><Ltr className="tabular-nums">{policy.night_start.slice(0, 5)}</Ltr></dd>
        <dt className="text-muted-foreground">{t('assets.armory.graceMinutes')}</dt><dd><Ltr className="tabular-nums">{policy.grace_minutes}</Ltr></dd>
      </dl>
    </div>
  )
}

function PolicyForm({ version, settings, update, onSaved, onOpenChange }: Pick<Props, 'onSaved' | 'onOpenChange'> & {
  version: SettingsVersion
  settings: SettingsQuery
  update: UseMutationResult<SettingsVersion, Error, { body: ArmorySettingsUpdate; etag: string }>
}): React.JSX.Element {
  const { t } = useArmoryLocale()
  const id = useId()
  const [draftEtag, setDraftEtag] = useState(version.etag)
  const { current, pending } = version.data
  const initial = pending ?? current
  const { control, register, handleSubmit, formState: { errors } } = useForm<z.input<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { day_start: initial.day_start.slice(0, 5), night_start: initial.night_start.slice(0, 5), grace_minutes: String(initial.grace_minutes) },
  })
  const conflict = update.error instanceof ApiError && update.error.status === 412
  const needsRefresh = conflict && (settings.isFetching || version.etag === draftEtag || settings.isError)
  const busy = update.isPending
  const timeError = errors.day_start?.message ?? errors.night_start?.message
  const graceError = errors.grace_minutes?.message
  const [beforeDate, afterDate] = pending?.effective_on
    ? t('assets.armory.pendingSettings', { skipInterpolation: true }).split('{{date}}')
    : []

  const submit = handleSubmit(values => {
    if (busy || needsRefresh) return
    // Ordinary background refreshes do not advance a draft's version. After a
    // conflict, the operator sees both refreshed policies before saving again.
    const etag = conflict ? version.etag : draftEtag
    setDraftEtag(etag)
    update.mutate({ body: { day_start: values.day_start, night_start: values.night_start, grace_minutes: Number(values.grace_minutes) }, etag }, {
      onSuccess: () => { onSaved(); onOpenChange(false) },
      onError: error => {
        if (error instanceof ApiError && error.status === 412) void settings.refetch({ cancelRefetch: false })
      },
    })
  })

  return (
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={submit} aria-busy={busy}>
      <DialogBody>
        <div className="grid gap-2">
          <PolicySummary policy={current} title={t('assets.armory.currentSettings')} />
          {pending && <PolicySummary policy={pending} title={pending.effective_on ? (
            <>{beforeDate}<Ltr className="tabular-nums">{displayDate(pending.effective_on)}</Ltr>{afterDate}</>
          ) : t('assets.armory.shell.scheduledSettings')} />}
        </div>
        <FormAlert id={`${id}-server`} message={conflict ? t('assets.armory.errors.versionMismatch') : update.error ? armoryErrorMessage(update.error) : null} />
        {needsRefresh && settings.isFetching && <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
        {needsRefresh && !settings.isFetching && (
          <Button type="button" variant="outline" className="min-h-11 self-start" onClick={() => void settings.refetch()}>{t('assets.armory.retry')}</Button>
        )}
        <FormAlert id={`${id}-time-error`} message={timeError ? t(timeError) : null} />
        <FormAlert id={`${id}-grace-error`} message={graceError ? t(graceError) : null} />
        <p id={`${id}-time-format`} className="text-sm text-muted-foreground">{t('assets.armory.date24Hint')}</p>
        <fieldset disabled={busy} className="min-w-0">
          <FieldGrid>
            {(['day_start', 'night_start'] as const).map(field => (
              <Field key={field} id={`${id}-${field}`} label={t(field === 'day_start' ? 'assets.armory.dayStart' : 'assets.armory.nightStart')} required>
                <Controller control={control} name={field} render={({ field: input }) => (
                  <Input id={`${id}-${field}`} {...input} onChange={event => input.onChange(normalizeDigits(event.target.value))}
                    type="text" dir="ltr" inputMode="numeric" maxLength={5} required
                    placeholder={field === 'day_start' ? '06:00' : '18:00'} className="min-h-11"
                    aria-invalid={!!errors[field]} aria-describedby={`${id}-time-format${errors[field] ? ` ${id}-time-error` : ''}`} />
                )} />
              </Field>
            ))}
            <Field id={`${id}-grace`} label={t('assets.armory.graceMinutes')} required full>
              <Input id={`${id}-grace`} {...register('grace_minutes')} type="number" dir="ltr" required inputMode="numeric" min={0} max={1440} step={1} className="min-h-11"
                aria-invalid={!!errors.grace_minutes} aria-describedby={errors.grace_minutes ? `${id}-grace-error` : undefined} />
            </Field>
          </FieldGrid>
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>{t('assets.armory.cancel')}</Button>
        <Button type="submit" className="min-h-11" disabled={busy || needsRefresh} aria-describedby={needsRefresh ? `${id}-server` : undefined}>
          {t(busy ? 'common.saving' : 'assets.armory.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}
