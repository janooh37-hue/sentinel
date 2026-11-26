import type { ArmoryActorRead } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

/** Recording actor as shown on Armory records: linked employee name, then the account's friendly name; null when neither is known. */
export function actorName(actor: ArmoryActorRead | null | undefined, language: string): string | null {
  if (!actor) return null
  if (actor.employee) return pickEmployeeName(actor.employee, language)
  return actor.display_name?.trim() || null
}
