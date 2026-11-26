import type { ArmorySerialMovementCreate, ArmorySerialRead } from '@/lib/api'

type Action = ArmorySerialMovementCreate['action']
const ACTIONS: Partial<Record<NonNullable<ArmorySerialRead['state']>, readonly Action[]>> = {
  in_safe: ['send_repair', 'mark_lost', 'write_off', 'transfer'],
  in_repair: ['return_repair', 'mark_lost', 'write_off'],
  lost: ['write_off'],
}
const NO_ACTIONS: readonly Action[] = []

export function allowedSerialActions(serial: Pick<ArmorySerialRead, 'state' | 'safe'>): readonly Action[] {
  return serial.state && serial.safe ? ACTIONS[serial.state] ?? NO_ACTIONS : NO_ACTIONS
}
