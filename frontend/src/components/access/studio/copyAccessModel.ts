import {
  sameSetting,
  type Decision,
  type Patch,
  type Snapshot,
} from './studioModel'
type CopyExclusion = {
  capability: string
  reason: 'nonconfigurable' | 'unsafeEffect' | 'expired'
}

/** Exact replacement of supported personal rows; role/effective grants are never copied. */
export function buildCopyPatch(
  source: Snapshot,
  target: Snapshot,
  now: number = Date.now(),
): { patches: Patch[]; exclusions: CopyExclusion[] } {
  const sourceOverrides = new Map<string, Snapshot['overrides'][number]>(
    source.overrides.map(
      (
        override: Snapshot['overrides'][number],
      ): [string, Snapshot['overrides'][number]] => [
        override.capability,
        override,
      ],
    ),
  )
  const targetOverrides = new Map<string, Snapshot['overrides'][number]>(
    target.overrides.map(
      (
        override: Snapshot['overrides'][number],
      ): [string, Snapshot['overrides'][number]] => [
        override.capability,
        override,
      ],
    ),
  )
  const editableDecisions = new Map<string, Decision[]>()
  for (const item of target.items) {
    for (const decision of item.actions) {
      if (!decision.configurable) continue
      for (const capability of decision.setting_capabilities) {
        const existing = editableDecisions.get(capability)
        if (existing) existing.push(decision)
        else editableDecisions.set(capability, [decision])
      }
    }
  }
  const capabilityIds = new Set<string>([
    ...source.overrides.map(
      (override: Snapshot['overrides'][number]) => override.capability,
    ),
    ...target.overrides.map(
      (override: Snapshot['overrides'][number]) => override.capability,
    ),
  ])
  const patches: Patch[] = []
  const exclusions: CopyExclusion[] = []
  for (const capability of [...capabilityIds].sort()) {
    const sourceOverride = sourceOverrides.get(capability)
    const next: Patch = {
      capability,
      effect: sourceOverride?.effect ?? null,
      expires_at: sourceOverride?.expires_at ?? null,
    }
    const before = targetOverrides.get(capability) ?? {
      capability,
      effect: null,
      expires_at: null,
    }
    const decisions = editableDecisions.get(capability) ?? []
    if (decisions.length === 0) {
      exclusions.push({ capability, reason: 'nonconfigurable' })
      continue
    }
    if (
      !decisions.every((decision: Decision) =>
        decision.editable_effects.includes(next.effect ?? null),
      )
    ) {
      exclusions.push({ capability, reason: 'unsafeEffect' })
      continue
    }
    const expirationTime =
      next.expires_at == null ? undefined : Date.parse(next.expires_at)
    if (
      sourceOverride?.state === 'expired' ||
      (expirationTime !== undefined &&
        (!Number.isFinite(expirationTime) || expirationTime <= now))
    ) {
      exclusions.push({ capability, reason: 'expired' })
      continue
    }
    if (!sameSetting(before, next)) patches.push(next)
  }
  return { patches, exclusions }
}
