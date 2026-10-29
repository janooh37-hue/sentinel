import { useId, useState, type ChangeEvent, type FocusEvent } from 'react'
import { LockKeyhole } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  destinationId,
  localized,
  personalSetting,
  type AccessItem,
  type Decision,
  type Patch,
  type Snapshot,
} from './studioModel'
import {
  AccessWarnings,
  DecisionOutcome,
  ReasonText,
  WhyAccess,
} from './WhyAccess'

export interface ActionRowProps {
  item: AccessItem
  decision: Decision
  proposed?: Decision
  snapshot: Snapshot
  patches: Patch[]
  disabled: boolean
  selected: boolean
  onSelect: (selected: boolean) => void
  onStage: (patches: Patch[]) => void
}

type Effect = Patch['effect']

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
        disabled={disabled || patch.effect === null}
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
  const settings: Patch[] = decision.setting_capabilities.map(
    (capability: Decision['setting_capabilities'][number]) =>
      personalSetting(capability, snapshot, patches),
  )
  const effect =
    settings.length &&
    settings.every((setting: Patch) => setting.effect === settings[0].effect)
      ? settings[0].effect
      : 'mixed'
  const baselineCount = decision.setting_capabilities.filter(
    (capability: Decision['setting_capabilities'][number]) =>
      snapshot.role_defaults.includes(capability),
  ).length
  const baseline =
    baselineCount === 0
      ? 'not_granted'
      : baselineCount === decision.setting_capabilities.length
        ? 'granted'
        : 'mixed'
  const changed = patches.some((patch: Patch) =>
    decision.setting_capabilities.includes(patch.capability),
  )
  const reason =
    decision.reasons.find(
      (entry: Decision['reasons'][number]) => entry.decisive,
    ) ??
    decision.reasons.find((entry: Decision['reasons'][number]) => entry.applied)
  const view = item.actions.find((action: Decision) => action.action === 'view')
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
        'min-w-0 space-y-4 border-t border-hairline p-4 sm:p-5',
        changed && 'bg-primary-soft/30',
      )}
      aria-labelledby={destination}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-52 space-y-1">
          <h4
            id={destination}
            tabIndex={-1}
            className="scroll-mt-24 rounded-sm font-semibold text-foreground [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            {actionLabel} · <bdi>{localized(item.label, i18n.language)}</bdi>
          </h4>
          <p className="max-w-prose text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {localized(item.description, i18n.language)}
          </p>
        </div>
        {editable && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            <input
              type="checkbox"
              checked={selected}
              disabled={disabled}
              onChange={(event) => onSelect(event.target.checked)}
              className="size-4 accent-primary"
            />
            <span>{t('access.studio.selectAction')}</span>
            <span className="sr-only">
              {actionLabel} · {localized(item.label, i18n.language)}
            </span>
          </label>
        )}
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t('access.studio.current')}
          </p>
          <DecisionOutcome decision={decision} />
          {reason && (
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              <ReasonText reason={reason} />
            </p>
          )}
        </div>
        {(changed ||
          (proposed &&
            (proposed.authorization !== decision.authorization ||
              proposed.executable_now !== decision.executable_now ||
              JSON.stringify(proposed.warnings) !==
                JSON.stringify(decision.warnings)))) && (
          <div className="space-y-1" aria-live="polite">
            <p className="text-xs font-medium text-primary">
              {t('access.studio.proposed')}
            </p>
            {proposed ? (
              <DecisionOutcome decision={proposed} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('access.studio.previewPending')}
              </p>
            )}
          </div>
        )}
      </div>
      {decision.setting_capabilities.length > 0 && (
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">
              {t('access.studio.roleBaseline')}:{' '}
            </span>
            <span className="font-medium">
              {t(`access.studio.baseline.${baseline}`)}
            </span>
          </p>
          {decision.setting_capabilities.length > 1 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {decision.setting_capabilities.map(
                (capability: Decision['setting_capabilities'][number]) => (
                  <li key={capability} className="[overflow-wrap:anywhere]">
                    <bdi className="font-mono">{capability}</bdi> ·{' '}
                    {t(
                      `access.studio.baseline.${snapshot.role_defaults.includes(capability) ? 'granted' : 'not_granted'}`,
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}
      {editable ? (
        <div className="space-y-3">
          <fieldset disabled={disabled} className="min-w-0 space-y-2">
            <legend className="text-sm font-medium">
              {t('access.studio.personalSetting')}
              {effect === 'mixed' && (
                <span className="ms-2 text-warning">
                  {t('access.studio.mixed')}
                </span>
              )}
            </legend>
            <div className="flex flex-wrap gap-2">
              {options
                .filter((option) =>
                  decision.editable_effects.includes(option.effect),
                )
                .map((option) => (
                  <label
                    key={option.key}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
                      effect === option.effect
                        ? 'bg-primary-soft font-medium text-primary'
                        : 'bg-surface text-foreground',
                      disabled && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input
                      type="radio"
                      name={radioName}
                      checked={effect === option.effect}
                      value={option.effect ?? 'default'}
                      className="size-4 accent-primary"
                      onChange={() =>
                        onStage(
                          settings.map((setting: Patch) => ({
                            ...setting,
                            effect: option.effect,
                            expires_at:
                              option.effect === null
                                ? null
                                : setting.expires_at,
                          })),
                        )
                      }
                    />
                    {t(`access.studio.settings.${option.key}`)}
                  </label>
                ))}
            </div>
          </fieldset>
          <ul
            className="space-y-1 text-xs text-muted-foreground"
            aria-label={t('access.studio.boundSettings')}
          >
            {settings.map((setting: Patch) => {
              const saved = snapshot.overrides.find(
                (override: Snapshot['overrides'][number]) =>
                  override.capability === setting.capability,
              )
              return (
                <li
                  key={setting.capability}
                  className="[overflow-wrap:anywhere]"
                >
                  <bdi className="font-mono">{setting.capability}</bdi> ·{' '}
                  {t(
                    `access.studio.settings.${setting.effect === null ? 'followRole' : setting.effect === 'grant' ? 'allow' : 'deny'}`,
                  )}
                  {saved?.state === 'expired' &&
                    !patches.some(
                      (patch: Patch) => patch.capability === setting.capability,
                    ) && (
                      <span className="ms-2 text-warning">
                        {t('access.studio.expiry.expired')}
                      </span>
                    )}
                </li>
              )
            })}
          </ul>
          {settings
            .filter((setting: Patch) => setting.effect !== null)
            .map((setting: Patch) => (
              <ExpiryField
                key={`${setting.capability}:${setting.expires_at ?? ''}:${setting.effect}`}
                patch={setting}
                disabled={disabled}
                onStage={onStage}
              />
            ))}
        </div>
      ) : (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('access.studio.lockedPolicy')}
        </p>
      )}
      {residualView && (
        <p className="text-sm text-muted-foreground">
          {t('access.studio.residualView')}
        </p>
      )}
      <AccessWarnings warnings={(proposed ?? decision).warnings} />
      <WhyAccess decision={decision} snapshot={snapshot} />
    </article>
  )
}
