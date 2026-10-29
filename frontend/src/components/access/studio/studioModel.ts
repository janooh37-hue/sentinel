import type { components } from '@/lib/api.types'

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
