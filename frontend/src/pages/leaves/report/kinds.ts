/** Canonical leave kinds = the Leave Application Form options
 * (backend/templates/_fields.json) + National Service (operator-mandated).
 * Legacy/unknown leave_type values bucket into Others for figures/chips,
 * while rows keep displaying their stored label.
 *
 * 'Administrative Leave' and 'Leave Permit' are record-only kinds: they have
 * their own dedicated DOCX forms and are tracked as pre-approved register
 * entries. They never appear in absence figures or balance sums (countsDays
 * returns false for both; see lifecycle.ts). */
import { englishPart } from '@/lib/bilingualValue'

export type KindId =
  | 'Annual Leave' | 'Sick Leave' | 'Compassionate Leave' | 'Duty Leave'
  | 'Emergency Leave' | 'Hajj Leave' | 'National Service'
  | 'Administrative Leave' | 'Leave Permit'
  | 'Others'

export interface KindDef { id: KindId; emoji: string; i18nKey: string }

export const CANONICAL_KINDS: KindDef[] = [
  { id: 'Annual Leave',        emoji: '🏖️', i18nKey: 'leaves.type.Annual Leave' },
  { id: 'Sick Leave',          emoji: '🤒', i18nKey: 'leaves.type.Sick Leave' },
  { id: 'Compassionate Leave', emoji: '🕊️', i18nKey: 'leaves.type.Compassionate Leave' },
  { id: 'Duty Leave',          emoji: '💼', i18nKey: 'leaves.type.Duty Leave' },
  { id: 'Emergency Leave',     emoji: '⚡', i18nKey: 'leaves.type.Emergency Leave' },
  { id: 'Hajj Leave',          emoji: '🕋', i18nKey: 'leaves.type.Hajj Leave' },
  { id: 'National Service',    emoji: '🎖️', i18nKey: 'leaves.type.National Service' },
  { id: 'Administrative Leave', emoji: '🏛️', i18nKey: 'leaves.type.Administrative Leave' },
  { id: 'Leave Permit',         emoji: '⏱️', i18nKey: 'leaves.type.Leave Permit' },
  { id: 'Others',              emoji: '🗂️', i18nKey: 'leaves.type.Others' },
]

const BY_ID = new Map(CANONICAL_KINDS.map((k) => [k.id, k]))

export function kindMeta(id: KindId): KindDef {
  return BY_ID.get(id) ?? CANONICAL_KINDS[CANONICAL_KINDS.length - 1]
}

/** Match stored leave_type (v4 "Annual Leave" or v3 "Annual") to a canonical kind.
 * Stored values are frequently bilingual ("Sick Leave - <ar>") — the " - "
 * suffix is stripped via `englishPart` before matching. A value matches when it
 * equals the canonical English value, or the canonical value is the v3 short
 * form + " Leave" (e.g. "Annual" → "Annual Leave"). Everything else — legacy
 * "Maternity Leave", "Unpaid Leave", blanks — is Others. */
export function classifyLeaveType(raw: string): KindId {
  const v = englishPart(raw).trim().toLowerCase()
  if (!v) return 'Others'
  for (const k of CANONICAL_KINDS) {
    if (k.id === 'Others') continue
    const canon = k.id.toLowerCase()
    if (v === canon || `${v} leave` === canon) return k.id
  }
  return 'Others'
}
