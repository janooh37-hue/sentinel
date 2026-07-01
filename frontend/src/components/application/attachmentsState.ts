/**
 * attachmentsState — pure value model for the form-page AttachmentsBlock
 * (forms signing paths & required attachments, spec 2026-06-11 §6).
 *
 * Lives in a sibling non-component file (react-refresh: component files must
 * only export components — same convention as *-variants.ts).
 *
 * One `AttachmentValue` per filled slot / extra row, in one of three shapes:
 *  - staged            — a fresh upload parked via POST /documents/attachments/stage
 *  - record_document   — an existing record's current generated PDF
 *  - record_attachment — one of an existing record's film-strip scans
 *
 * `toGenerateSpecs` flattens the state into the wire shape
 * (`DocumentGenerateRequest.attachments`); the backend re-orders by declared
 * slot order then extras, so client-side ordering is presentational only.
 */

import type { AttachmentSlotRead, GenerateAttachmentSpec } from '@/lib/api'

export type AttachmentValue =
  | { kind: 'staged'; token: string; filename: string; size: number }
  | { kind: 'record_document'; bookId: number; label: string }
  | { kind: 'record_attachment'; bookId: number; index: number; label: string }

export interface AttachmentsState {
  /** Named slots keyed by `AttachmentSlotRead.key`; null/absent = empty. */
  slots: Record<string, AttachmentValue | null>
  /** Free-form extras ("＋ Add attachment (optional)"). */
  extras: AttachmentValue[]
}

export function emptyAttachmentsState(): AttachmentsState {
  return { slots: {}, extras: [] }
}

function specFor(
  value: AttachmentValue,
  slotKey: string | null,
): GenerateAttachmentSpec {
  switch (value.kind) {
    case 'staged':
      return { slot_key: slotKey, source: 'staged', staged_token: value.token }
    case 'record_document':
      return { slot_key: slotKey, source: 'record_document', book_id: value.bookId }
    case 'record_attachment':
      return {
        slot_key: slotKey,
        source: 'record_attachment',
        book_id: value.bookId,
        attachment_index: value.index,
      }
  }
}

/** Flatten filled slots (insertion order) then extras into wire specs. */
export function toGenerateSpecs(s: AttachmentsState): GenerateAttachmentSpec[] {
  const specs: GenerateAttachmentSpec[] = []
  for (const [slotKey, value] of Object.entries(s.slots)) {
    if (value) specs.push(specFor(value, slotKey))
  }
  for (const value of s.extras) specs.push(specFor(value, null))
  return specs
}

/** Keys of required slots that are still empty — drives Save-book gating. */
export function missingRequired(
  slots: AttachmentSlotRead[],
  s: AttachmentsState,
): string[] {
  return slots
    .filter((slot) => slot.required && !s.slots[slot.key])
    .map((slot) => slot.key)
}

/** The medical-certificate slot rides the shared "Leave Application Form"
 * template but is only meaningful for Sick Leave. */
export const SICK_ONLY_SLOT_KEY = 'medical_certificate'

/** Slots to render for the current leave type: the sick-only slot is dropped
 * unless leaveType is exactly "Sick Leave". */
export function visibleAttachmentSlots(
  slots: AttachmentSlotRead[],
  leaveType: string | undefined,
): AttachmentSlotRead[] {
  if (leaveType === 'Sick Leave') return slots
  return slots.filter((s) => s.key !== SICK_ONLY_SLOT_KEY)
}

/** Strip slot values whose slot is not in `slots` (e.g. a hidden
 * medical_certificate) so they never ride the generate payload. */
export function filterStateToSlots(
  state: AttachmentsState,
  slots: AttachmentSlotRead[],
): AttachmentsState {
  const allowed = new Set(slots.map((s) => s.key))
  const kept: AttachmentsState['slots'] = {}
  for (const [k, v] of Object.entries(state.slots)) {
    if (allowed.has(k)) kept[k] = v
  }
  return { ...state, slots: kept }
}

/** Compose the attachments state shown when a form (re)opens: the restored
 * draft (or an empty state) with an intake-staged scan seeded on top. The
 * seed only applies when its slot exists in `slots`, so a scan can never be
 * dropped by a restored draft and never lands on a form without the slot. */
export function attachmentsWithSeed(
  base: AttachmentsState | null,
  slots: AttachmentSlotRead[],
  pending: { slotKey: string; staged: { token: string; filename: string; size: number } } | undefined,
): AttachmentsState {
  const start = base ?? emptyAttachmentsState()
  if (!pending) return start
  if (!slots.some((s) => s.key === pending.slotKey)) return start
  return seedStagedSlot(start, pending.slotKey, pending.staged)
}

/** Pre-fill one slot with a staged upload (used to auto-carry an intake scan). */
export function seedStagedSlot(
  state: AttachmentsState,
  slotKey: string,
  staged: { token: string; filename: string; size: number },
): AttachmentsState {
  return {
    ...state,
    slots: {
      ...state.slots,
      [slotKey]: {
        kind: 'staged',
        token: staged.token,
        filename: staged.filename,
        size: staged.size,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// localStorage draft round-trip (formDrafts carries the state under a reserved
// `__attachments` key so a refresh keeps staged tokens — spec §6).
// ---------------------------------------------------------------------------

function isAttachmentValue(raw: unknown): raw is AttachmentValue {
  if (!raw || typeof raw !== 'object') return false
  const v = raw as Record<string, unknown>
  switch (v.kind) {
    case 'staged':
      return (
        typeof v.token === 'string' &&
        typeof v.filename === 'string' &&
        typeof v.size === 'number'
      )
    case 'record_document':
      return typeof v.bookId === 'number' && typeof v.label === 'string'
    case 'record_attachment':
      return (
        typeof v.bookId === 'number' &&
        typeof v.index === 'number' &&
        typeof v.label === 'string'
      )
    default:
      return false
  }
}

/** Defensive parse of a persisted draft blob back into AttachmentsState.
 * Anything malformed degrades to null (caller keeps the empty state). */
export function parseAttachmentsState(raw: unknown): AttachmentsState | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as { slots?: unknown; extras?: unknown }
  if (
    !candidate.slots ||
    typeof candidate.slots !== 'object' ||
    Array.isArray(candidate.slots) ||
    !Array.isArray(candidate.extras)
  ) {
    return null
  }
  const slots: Record<string, AttachmentValue | null> = {}
  for (const [key, value] of Object.entries(
    candidate.slots as Record<string, unknown>,
  )) {
    if (value === null) {
      slots[key] = null
    } else if (isAttachmentValue(value)) {
      slots[key] = value
    }
    // Unknown shapes are dropped (slot reads as empty).
  }
  const extras = (candidate.extras as unknown[]).filter(isAttachmentValue)
  return { slots, extras }
}
