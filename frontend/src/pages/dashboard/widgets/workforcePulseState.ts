import type { WorkforceAccess, WorkforceSnapshot } from '@/lib/api'

export type MissingReadiness = 'schedules' | 'policy' | 'mappings' | 'integration'

export type PulseState =
  | { kind: 'self'; snapshot: WorkforceSnapshot }
  | { kind: 'aggregate'; snapshot: WorkforceSnapshot }
  | { kind: 'no_scope' }
  | { kind: 'setup'; missing: MissingReadiness[] }
  | { kind: 'stale' }
  | { kind: 'withheld'; snapshot: WorkforceSnapshot }

export function derivePulseState(access: WorkforceAccess, snapshot: WorkforceSnapshot): PulseState {
  if (access.workforce_access_tier === 'none') return { kind: 'no_scope' }

  const missing: MissingReadiness[] = []
  if (snapshot.readiness) {
    if (!snapshot.readiness.schedules_ready) missing.push('schedules')
    if (!snapshot.readiness.policy_ready) missing.push('policy')
    if (!snapshot.readiness.mappings_ready) missing.push('mappings')
    if (!snapshot.readiness.integration_ready) missing.push('integration')
  }
  if (missing.length > 0) return { kind: 'setup', missing }
  if (snapshot.sync_health?.punches?.state === 'stale') return { kind: 'stale' }
  if (snapshot.current_shift.working == null && snapshot.current_shift.scheduled > 0) {
    return { kind: 'withheld', snapshot }
  }
  return snapshot.aggregate ? { kind: 'aggregate', snapshot } : { kind: 'self', snapshot }
}
