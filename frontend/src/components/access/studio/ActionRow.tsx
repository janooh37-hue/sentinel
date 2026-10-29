import { useId, useState, type ChangeEvent, type FocusEvent } from 'react'
import { LockKeyhole } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  destinationId,
  localized,
  missingPrerequisites,
  settingLabel,
  isMessageTemplate,
  personalSetting,
  personalSettingBindings,
  stageActionSetting,
  type AccessItem,
  type Decision,
  type Patch,
  type Snapshot,
} from './studioModel'
import { AccessWarnings, DecisionOutcome, WhyAccess } from './WhyAccess'
import { LocalDateTime } from './SettingIdentity'

export interface ActionRowProps {
  item: AccessItem
  decision: Decision
  proposed?: Decision
  snapshot: Snapshot
  patches: Patch[]
  disabled: boolean
  selected: boolean
  onSelect: (selected: boolean) => void
  onStage: (patches: Patch[], requireReview?: boolean) => void
}

type Effect = Decision['editable_effects'][number]

function validExpiry(
  value: string,
  existing: string | null | undefined,
): boolean {
  if (value === (existing ?? '') || !value) return true
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    Date.parse(value) > Date.now()
  )
}

function ExpiryField({
  patch,
  disabled,
  onStage,
}: {
  patch: Patch
  disabled: boolean
  onStage: (patches: Patch[]) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [value, setValue] = useState(patch.expires_at ?? '')
  const [invalid, setInvalid] = useState(false)
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-xs text-muted-foreground">
        {t('access.studio.expiry.label')} ·{' '}
        <bdi className="font-mono">{patch.capability}</bdi>
      </label>
      <input
        data-access-expiry
        id={id}
        type="text"
        dir="ltr"
        value={value}
        disabled={disabled || patch.effect == null}
        placeholder={t('access.studio.expiry.placeholder')}
        aria-invalid={invalid}
        aria-describedby={`${id}-help`}
        className="min-h-11 w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const next = event.target.value.trim()
          const valid = validExpiry(next, patch.expires_at)
          setValue(event.target.value)
          setInvalid(!valid)
          event.target.setCustomValidity(
            valid ? '' : t('access.studio.expiry.invalid'),
          )
        }}
        onBlur={(event: FocusEvent<HTMLInputElement>) => {
          const next = value.trim()
          const valid = validExpiry(next, patch.expires_at)
          setInvalid(!valid)
          event.target.setCustomValidity(
            valid ? '' : t('access.studio.expiry.invalid'),
          )
          if (valid && next !== (patch.expires_at ?? ''))
            onStage([{ ...patch, expires_at: next || null }])
        }}
      />
      <p
        id={`${id}-help`}
        className={cn(
          'text-xs',
          invalid ? 'text-accent' : 'text-muted-foreground',
        )}
        role={invalid ? 'alert' : undefined}
      >
        {t(
          invalid
            ? 'access.studio.expiry.invalid'
            : 'access.studio.expiry.help',
        )}
      </p>
    </div>
  )
}

function ActionProblems({ decision, snapshot, patches, disabled, onStage }: Pick<ActionRowProps, 'decision' | 'snapshot' | 'patches' | 'disabled' | 'onStage'>) {
  const { t, i18n } = useTranslation()
  const missing = decision.authorization === 'needs_context' ? [] : missingPrerequisites(decision)
  const expired = snapshot.overrides.filter((override) =>
    override.state === 'expired' && decision.setting_capabilities.includes(override.capability),
  )
  const otherWarnings = decision.authorization === 'needs_context' ? [] : (decision.warnings ?? []).filter((warning) =>
    !['PREREQUISITE_BLOCKED', 'CONDITIONAL_PREREQUISITE_BLOCKED'].includes(warning.code),
  )
  const blocked = decision.authorization === 'allowed' && decision.executable_now === false
  const prerequisiteWarnings = decision.authorization === 'needs_context' ? [] : (decision.warnings ?? []).filter((warning) =>
    ['PREREQUISITE_BLOCKED', 'CONDITIONAL_PREREQUISITE_BLOCKED'].includes(warning.code),
  )
  if (!expired.length && !missing.length && !otherWarnings.length && !prerequisiteWarnings.length && !blocked) return null
  return (
    <div className="col-span-full space-y-2 pb-2 text-xs">
      {expired.map((override) => {
        const staged = patches.some((patch) => patch.capability === override.capability)
        const setting = settingLabel(snapshot, override.capability, i18n.language, t)
        return <div key={override.capability} className="space-y-1">
          <p className="text-warning">{t(override.expires_at ? 'access.studio.attention.expired' : 'access.studio.attention.expiredUnknownDate', {
            setting, type: t(`access.studio.settings.${override.effect === 'grant' ? 'allow' : 'deny'}`),
            time: override.expires_at ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn' }).format(new Date(override.expires_at)) : '',
          })}</p>
          {decision.configurable && !staged ? <div className="flex flex-wrap gap-2">
            {decision.editable_effects.includes(override.effect) && <button type="button" disabled={disabled} className="min-h-11 rounded px-2 font-medium text-primary hover:bg-surface-tinted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" onClick={() => onStage([{ capability: override.capability, effect: override.effect, expires_at: null }], true)}>{t('access.studio.attention.setAgain', { type: t(`access.studio.settings.${override.effect === 'grant' ? 'allow' : 'deny'}`) })}</button>}
            {decision.editable_effects.includes(null) && <button type="button" disabled={disabled} className="min-h-11 rounded px-2 font-medium text-primary hover:bg-surface-tinted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" onClick={() => onStage([{ capability: override.capability, effect: null, expires_at: null }], true)}>{t('access.studio.attention.followRole')}</button>}
          </div> : !staged && <p className="text-muted-foreground">{t('access.studio.attention.expiredFix')}</p>}
        </div>
      })}
      {missing.map((capability) => {
        const catalog = snapshot.items.find((item) => item.resource.kind === 'capability' && item.resource.id === capability)
        const permission = catalog ? localized(catalog.label, i18n.language).trim() : ''
        const canGrant = catalog?.actions.some((action) =>
          permission !== '' && action.configurable && action.editable_effects.includes('grant') && action.setting_capabilities.includes(capability),
        )
        const setting = personalSetting(capability, snapshot, patches)
        const staged = patches.some((patch) => patch.capability === capability && patch.effect === 'grant')
        const expiry = snapshot.overrides.some((override) => override.capability === capability && override.state === 'expired') ? null : setting.expires_at
        return <div key={capability} className="flex flex-wrap items-center gap-x-2">
          <p className="text-warning">{permission ? t(prerequisiteWarnings.some((warning) => warning.code === 'CONDITIONAL_PREREQUISITE_BLOCKED' && warning.capabilities?.includes(capability)) ? 'access.studio.issueCodes.CONDITIONAL_PREREQUISITE_BLOCKED' : 'access.studio.attention.prerequisite', { permission }) : t('access.studio.attention.prerequisiteUnknown')}</p>
          {canGrant && !staged && <button type="button" disabled={disabled} className="min-h-11 rounded px-2 font-medium text-primary hover:bg-surface-tinted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" onClick={() => onStage([{ capability, effect: 'grant', expires_at: expiry }], true)}>{t('access.studio.attention.alsoAllow', { permission })}</button>}
        </div>
      })}
      {prerequisiteWarnings.some((warning) => warning.code === 'CONDITIONAL_PREREQUISITE_BLOCKED' && warning.params?.category_exists === false) && <p className="text-warning">{t('access.studio.attention.conditionalCategoryMissing')}</p>}
      {!missing.length && prerequisiteWarnings.length > 0 && !prerequisiteWarnings.some((warning) => warning.params?.category_exists === false) && <p className="text-warning">{t('access.studio.attention.prerequisiteUnknown')}</p>}
      {blocked && !missing.length && <p className="text-warning">{t(decision.reasons.some((reason) => reason.code === 'ACCOUNT_INELIGIBLE') ? 'access.studio.attention.accountUnavailable' : 'access.studio.attention.notReady')}</p>}
      <AccessWarnings warnings={otherWarnings} snapshot={snapshot} />
    </div>
  )
}

export function ActionRow({
  item,
  decision,
  proposed,
  snapshot,
  patches,
  disabled,
  selected,
  onSelect,
  onStage,
}: ActionRowProps) {
  const { t, i18n } = useTranslation()
  const radioName = useId()
  const destination = destinationId(item.resource, decision.action)
  const actionLabel = t(
    item.resource.kind === 'service' &&
      (decision.action === 'create' || decision.action === 'read')
      ? `access.studio.services.${decision.action}`
      : `access.studio.actions.${decision.action}`,
  )
  const editable =
    decision.configurable &&
    decision.setting_capabilities.length > 0 &&
    decision.editable_effects.length > 0
  const template = isMessageTemplate(item.resource)
  const editImpliesView = template && ['edit', 'reset'].includes(decision.action)
  const settingBindings = personalSettingBindings(item, decision)
  const settings: Patch[] = settingBindings.map(
    (capability) =>
      personalSetting(capability, snapshot, patches),
  )
  const view = item.actions.find((action: Decision) => action.action === 'view')
  const viewBlocked = view?.setting_capabilities.some((capability) => {
    const setting = personalSetting(capability, snapshot, patches)
    if (setting.effect === 'deny') return true
    if (setting.effect === 'grant') return false
    if (patches.some((patch) => patch.capability === capability))
      return !snapshot.role_defaults.includes(capability)
    return view.authorization === 'denied'
  })
  const effect =
    settings.length &&
    settings.every(
      (setting: Patch) =>
        (setting.effect ?? null) === (settings[0].effect ?? null),
    )
      ? (editImpliesView && viewBlocked && settings[0].effect === 'grant'
          ? 'mixed'
          : (settings[0].effect ?? null))
      : 'mixed'
  const baselineCount = settingBindings.filter(
    (capability) =>
      snapshot.role_defaults.includes(capability),
  ).length
  const baseline =
    baselineCount === 0
      ? 'not_granted'
      : baselineCount === settingBindings.length
        ? 'granted'
        : 'mixed'
  const changed = patches.some((patch: Patch) =>
    decision.setting_capabilities.includes(patch.capability),
  )
  const showProposed = changed || (proposed != null && (
    proposed.authorization !== decision.authorization ||
    proposed.executable_now !== decision.executable_now ||
    JSON.stringify(proposed.warnings ?? []) !== JSON.stringify(decision.warnings ?? [])
  ))
  const residualView =
    decision.action !== 'view' &&
    view?.authorization === 'allowed' &&
    ((proposed ?? decision).authorization === 'denied' ||
      (changed && settings.some((setting: Patch) => setting.effect === 'deny')))
  const options: { effect: Effect; key: string }[] = [
    { effect: null, key: 'followRole' },
    { effect: 'grant', key: 'allow' },
    { effect: 'deny', key: 'deny' },
  ]
  return (
    <article
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-hairline px-3 py-1 sm:px-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,0.7fr)_auto_auto_auto] lg:py-0',
        changed && 'bg-primary-soft/30',
      )}
      aria-labelledby={destination}
    >
      <div className="col-span-full flex min-w-0 items-center gap-2 lg:col-span-1">
        {editable && (
          <label className="flex min-h-11 shrink-0 cursor-pointer items-center px-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            <input type="checkbox" checked={selected} disabled={disabled} onChange={(event) => onSelect(event.target.checked)} className="size-4 accent-primary" />
            <span className="sr-only">{t('access.studio.selectAction')} · {actionLabel} · {localized(item.label, i18n.language)}</span>
          </label>
        )}
        <h4 id={destination} tabIndex={-1} title={`${actionLabel} · ${localized(item.label, i18n.language)}`} className="min-w-0 scroll-mt-24 truncate rounded-sm text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          {actionLabel} · <bdi>{localized(item.label, i18n.language)}</bdi>
        </h4>
        {!editable && <LockKeyhole className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('access.studio.lockedPolicy')} />}
      </div>
      <p title={localized(item.description, i18n.language)} className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">{localized(item.description, i18n.language)}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-1 lg:max-w-48" aria-live="polite">
        <span title={t('access.studio.current')}><DecisionOutcome decision={decision} resource={item.resource} /></span>
        {showProposed && <span className="sr-only">{t('access.studio.proposed')}</span>}
        {showProposed && (proposed ? <span title={t('access.studio.proposed')}><span aria-hidden="true">› </span><DecisionOutcome decision={proposed} resource={item.resource} /></span> : <span className="text-xs text-muted-foreground">{t('access.studio.previewPending')}</span>)}
      </div>
      {editable ? (
        <fieldset disabled={disabled} className="col-span-full min-w-0 lg:col-span-1">
          <legend className="sr-only">{t('access.studio.personalSetting')} · {actionLabel} · {localized(item.label, i18n.language)}{effect === 'mixed' && ` · ${t('access.studio.mixed')}`}</legend>
          <div className="inline-flex max-w-full rounded-md border border-border bg-surface-tinted p-0.5">
            {options.map((option) => (
              <label key={option.key} className={cn(
                'relative flex min-h-11 min-w-0 cursor-pointer items-center justify-center rounded px-3 text-xs focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring lg:min-h-8 lg:px-2 pointer-coarse:min-h-11',
                effect === option.effect ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground hover:bg-surface',
                (disabled || !decision.editable_effects.includes(option.effect)) && 'cursor-not-allowed opacity-60',
              )}>
                <input type="radio" name={radioName} checked={effect === option.effect} value={option.effect ?? 'default'} disabled={!decision.editable_effects.includes(option.effect)} className="absolute inset-0 m-0 h-full w-full cursor-inherit opacity-0" onChange={() => onStage(stageActionSetting(item, decision, option.effect, snapshot, patches))} />
                {t(`access.studio.settings.${option.key}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : <span className="hidden lg:block" />}
      <WhyAccess
        compact
        baseline={baseline}
        decision={decision}
        snapshot={snapshot}
        resource={item.resource}
        technicalDetails={
          <>
            <ul className="space-y-1" aria-label={t('access.studio.boundSettings')}>
              {settings.map((setting) => <li key={setting.capability}><bdi dir="ltr" className="font-mono">{setting.capability}</bdi> · {t(`access.studio.settings.${setting.effect == null ? 'followRole' : setting.effect === 'grant' ? 'allow' : 'deny'}`)}{snapshot.overrides.some((saved) => saved.capability === setting.capability && saved.state === 'expired') && !patches.some((patch) => patch.capability === setting.capability) && <span className="ms-2 text-warning">{t('access.studio.expiry.expired')}</span>}</li>)}
            </ul>
            {editable && settings.filter((setting) => setting.effect != null).map((setting) => <ExpiryField key={`${setting.capability}:${setting.expires_at ?? ''}:${setting.effect}`} patch={setting} disabled={disabled} onStage={onStage} />)}
          </>
        }
      >
        <p className="text-muted-foreground lg:hidden">{localized(item.description, i18n.language)}</p>
        {showProposed && <div className="space-y-1"><p className="font-medium">{t('access.studio.proposed')}</p>{proposed ? <><DecisionOutcome decision={proposed} resource={item.resource} /><AccessWarnings warnings={proposed.warnings} snapshot={snapshot} /></> : <p>{t('access.studio.previewPending')}</p>}</div>}
        {effect === 'mixed' && <p className="text-warning">{t('access.studio.personalSetting')}: {t('access.studio.mixed')}</p>}
        {settings.some((setting) => setting.effect != null) && <ul className="space-y-1 text-muted-foreground">{settings.filter((setting) => setting.effect != null).map((setting) => <li key={setting.capability}>{t('access.studio.expiry.label')}: {setting.expires_at ? <LocalDateTime value={setting.expires_at} /> : t('access.studio.expiry.none')}</li>)}</ul>}
        {template && decision.action === 'view' && decision.authorization === 'denied' && <p>{t('access.studio.templateViewRequired')}</p>}
        {editImpliesView && <p>{t('access.studio.templateEditImpliesView')}</p>}
        {template && decision.action === 'view' && <p>{t(item.resource.kind === 'email_template' ? 'access.studio.templateViewConsequenceEmail' : 'access.studio.templateViewConsequence')}</p>}
        {!editable && <p className="text-muted-foreground">{t('access.studio.lockedPolicy')}</p>}
        {residualView && !editImpliesView && <p>{t('access.studio.residualView')}</p>}
      </WhyAccess>
      <ActionProblems decision={decision} snapshot={snapshot} patches={patches} disabled={disabled} onStage={onStage} />
    </article>
  )
}
