import type { components } from '@/lib/api.types'
import type { TFunction } from 'i18next'

export type Snapshot = components['schemas']['AccessSnapshot']
export type Decision = components['schemas']['Decision']
export type Patch = components['schemas']['Patch']
export type AccessItem = components['schemas']['AccessItem']
export type Resource = components['schemas']['Resource']
export type Action = components['schemas']['Action']
export type PreviewResponse = components['schemas']['PreviewResponse']
export type CheckResponse = components['schemas']['CheckResponse']
export type CheckRequest = components['schemas']['CheckRequest']

export function localized(
  value: { en: string; ar: string },
  language: string,
): string {
  return language.startsWith('ar') ? value.ar : value.en
}
export function settingLabel(snapshot: Snapshot, capability: string, language: string, t: TFunction): string {
  const catalogItem = snapshot.items.find((item) => item.resource.kind === 'capability' && item.resource.id === capability)
  if (catalogItem) return localized(catalogItem.label, language)
  const bindings = snapshot.items.flatMap((item) => item.actions.filter((action) => action.setting_capabilities.includes(capability)).map((action) => ({ item, action })))
  if (bindings.length !== 1) return t('access.studio.accountSetting')
  const { item, action } = bindings[0]
  return `${t(`access.studio.actions.${action.action}`)} · ${localized(item.label, language)}`
}

export function destinationId(resource: Resource, action: Action): string {
  return `${resource.kind}:${resource.id}:${action}`
}

export function savedSetting(snapshot: Snapshot, capability: string): Patch {
  const override = snapshot.overrides.find(
    (entry: Snapshot['overrides'][number]) => entry.capability === capability,
  )
  return {
    capability,
    effect: override?.effect ?? null,
    expires_at: override?.expires_at ?? null,
  }
}

export function sameSetting(a: Patch, b: Patch): boolean {
  return (
    (a.effect ?? null) === (b.effect ?? null) &&
    (a.expires_at ?? null) === (b.expires_at ?? null)
  )
}
export function personalSetting(
  capability: string,
  snapshot: Snapshot,
  patches: Patch[],
): Patch {
  const staged = patches.find((patch) => patch.capability === capability)
  return staged ?? savedSetting(snapshot, capability)
}

export function isMessageTemplate(resource: Resource): boolean {
  return resource.kind === 'notification_template' || resource.kind === 'email_template'
}

/** Editing requires view, but removing edit must not remove independent viewing. */
export function personalSettingBindings(item: AccessItem, decision: Decision): string[] {
  if (!isMessageTemplate(item.resource) || !['edit', 'reset'].includes(decision.action))
    return decision.setting_capabilities
  const view = item.actions.find((action) => action.action === 'view')
  return decision.setting_capabilities.filter((capability) =>
    !view?.setting_capabilities.includes(capability),
  )
}

export function stageActionSetting(
  item: AccessItem,
  decision: Decision,
  effect: Patch['effect'],
  snapshot: Snapshot,
  patches: Patch[],
): Patch[] {
  const bindings = effect === 'grant'
    ? decision.setting_capabilities
    : personalSettingBindings(item, decision)
  return bindings.map((capability) => {
    const setting = personalSetting(capability, snapshot, patches)
    return { ...setting, effect, expires_at: effect == null ? null : setting.expires_at }
  })
}

/** Preserve the complete reviewed conjunction, including an already-saved edit grant. */
export function reviewedTemplateGrants(snapshot: Snapshot, patches: Patch[]): Set<string> {
  const grants = new Set(patches.filter((patch) => patch.effect === 'grant').map((patch) => patch.capability))
  return new Set(snapshot.items.filter((item) => isMessageTemplate(item.resource)).flatMap((item) =>
    item.actions.filter((action) =>
      ['edit', 'reset'].includes(action.action) &&
      action.setting_capabilities.length > 1 &&
      action.setting_capabilities.every((capability) => grants.has(capability)) &&
      action.setting_capabilities.some((capability) => {
        const patch = patches.find((entry) => entry.capability === capability)
        return patch != null && !sameSetting(savedSetting(snapshot, capability), patch)
      }),
    ).flatMap((action) => action.setting_capabilities),
  ))
}

/** Missing permissions come from the guard, never from capability naming conventions. */
export function missingPrerequisites(action: Decision): string[] {
  return [...new Set([
    ...(action.warnings ?? []).filter((warning) =>
      ['PREREQUISITE_BLOCKED', 'CONDITIONAL_PREREQUISITE_BLOCKED'].includes(warning.code),
    ).flatMap((warning) => warning.capabilities ?? []),
    ...action.reasons.filter((reason) => reason.code === 'PREREQUISITE_MISSING' && reason.capability && !action.setting_capabilities.includes(reason.capability))
      .map((reason) => reason.capability!),
  ])]
}

/** Informational notes about records and intentional access splits are not faults. */
export function actionableWarnings(action: Decision): NonNullable<Decision['warnings']> {
  return (action.warnings ?? []).filter((warning) =>
    warning.severity !== 'info' ||
    ['PREREQUISITE_BLOCKED', 'CONDITIONAL_PREREQUISITE_BLOCKED'].includes(warning.code),
  )
}

/** The summary, filter and row marker must describe the same attention set. */
export function needsAttention(action: Decision, snapshot: Snapshot): boolean {
  const expired = action.setting_capabilities.some((capability) => snapshot.overrides.some((override) => override.capability === capability && override.state === 'expired'))
  if (expired) return true
  if (action.authorization === 'needs_context') return false
  return action.authorization === 'unknown' ||
    (action.authorization === 'allowed' && action.executable_now === false) ||
    actionableWarnings(action).length > 0
}
