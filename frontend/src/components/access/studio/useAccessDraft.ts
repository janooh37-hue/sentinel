import { useState } from 'react'
import {
  savedSetting,
  sameSetting,
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
        if (sameSetting(savedSetting(baseline, patch.capability), normalized))
          next.delete(patch.capability)
        else next.set(patch.capability, normalized)
      }
      return [...next.values()].sort((a, b) =>
        a.capability.localeCompare(b.capability),
      )
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
    setPatches((previous) =>
      previous.filter(
        (patch) => !sameSetting(savedSetting(next, patch.capability), patch),
      ),
    )
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
