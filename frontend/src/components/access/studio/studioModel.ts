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
    a.effect === b.effect && (a.expires_at ?? null) === (b.expires_at ?? null)
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
