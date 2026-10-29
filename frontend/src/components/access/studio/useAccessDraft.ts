import { useState } from 'react'
import {
  savedSetting,
  sameSetting,
  reviewedTemplateGrants,
  type Patch,
  type Snapshot,
} from './studioModel'

export function useAccessDraft(snapshot: Snapshot) {
  const [savedBaseline, setBaseline] = useState(snapshot)
  const [patches, setPatches] = useState<Patch[]>([])
  const [version, setVersion] = useState(0)
  const baseline = patches.length ? savedBaseline : snapshot
  function stage(items: Patch[]) {
    setBaseline(baseline)
    setPatches((previous) => {
      const next = new Map(previous.map((patch) => [patch.capability, patch]))
      for (const patch of items) {
        const normalized: Patch = {
          capability: patch.capability,
          effect: patch.effect ?? null,
          expires_at: patch.effect == null ? null : (patch.expires_at ?? null),
        }
        next.set(patch.capability, normalized)
      }
      const candidate = [...next.values()]
      const reviewedBindings = reviewedTemplateGrants(baseline, candidate)
      return candidate.filter((patch) =>
        reviewedBindings.has(patch.capability) || !sameSetting(savedSetting(baseline, patch.capability), patch),
      ).sort((a, b) => a.capability.localeCompare(b.capability))
    })
    setVersion((value) => value + 1)
  }
  function discard(next = snapshot) {
    setBaseline(next)
    setPatches([])
    setVersion((value) => value + 1)
  }
  function rebase(next: Snapshot) {
    setBaseline(next)
    setPatches((previous) => {
      const reviewedBindings = reviewedTemplateGrants(next, previous)
      return previous.filter(
        (patch) => reviewedBindings.has(patch.capability) || !sameSetting(savedSetting(next, patch.capability), patch),
      )
    })
    setVersion((value) => value + 1)
  }
  return {
    baseline,
    patches,
    version,
    stage,
    discard,
    rebase,
    dirty: patches.length > 0,
  }
}
