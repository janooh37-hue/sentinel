import { describe, it, expect } from 'vitest'
import type { AttachmentSlotRead } from '@/lib/api'
import {
  visibleAttachmentSlots,
  filterStateToSlots,
  emptyAttachmentsState,
  SICK_ONLY_SLOT_KEY,
  seedStagedSlot,
  attachmentsWithSeed,
} from './attachmentsState'

const slot = (key: string): AttachmentSlotRead => ({
  key, label_en: key, label_ar: key, required: false, hint_en: '', hint_ar: '',
})

const staged = { kind: 'staged' as const, token: 't', filename: 'f', size: 1 }

describe('visibleAttachmentSlots', () => {
  it('hides medical_certificate for non-sick leave', () => {
    const slots = [slot(SICK_ONLY_SLOT_KEY), slot('other')]
    expect(visibleAttachmentSlots(slots, 'Annual Leave').map((s) => s.key)).toEqual(['other'])
  })
  it('shows medical_certificate for Sick Leave', () => {
    expect(
      visibleAttachmentSlots([slot(SICK_ONLY_SLOT_KEY)], 'Sick Leave').map((s) => s.key),
    ).toEqual([SICK_ONLY_SLOT_KEY])
  })
  it('hides it when leaveType is undefined', () => {
    expect(visibleAttachmentSlots([slot(SICK_ONLY_SLOT_KEY)], undefined)).toEqual([])
  })
})

describe('filterStateToSlots', () => {
  it('drops values whose slot is not visible', () => {
    const state = {
      ...emptyAttachmentsState(),
      slots: { [SICK_ONLY_SLOT_KEY]: staged, keep: staged },
    }
    const out = filterStateToSlots(state, [slot('keep')])
    expect(Object.keys(out.slots)).toEqual(['keep'])
    expect(out.extras).toEqual(state.extras)
  })
})

describe('seedStagedSlot', () => {
  it('sets a staged value on the given slot', () => {
    const out = seedStagedSlot(emptyAttachmentsState(), SICK_ONLY_SLOT_KEY, {
      token: 'tok', filename: 'scan.pdf', size: 42,
    })
    expect(out.slots[SICK_ONLY_SLOT_KEY]).toEqual({
      kind: 'staged', token: 'tok', filename: 'scan.pdf', size: 42,
    })
  })
})

describe('attachmentsWithSeed', () => {
  const slots = [slot(SICK_ONLY_SLOT_KEY)]
  it('seeds onto a restored draft without dropping existing content', () => {
    const draft = { ...emptyAttachmentsState(), slots: { other: staged }, extras: [staged] }
    const out = attachmentsWithSeed(draft, [slot('other'), slot(SICK_ONLY_SLOT_KEY)],
      { slotKey: SICK_ONLY_SLOT_KEY, staged: { token: 'm', filename: 'cert.pdf', size: 9 } })
    expect(out.slots[SICK_ONLY_SLOT_KEY]).toEqual({ kind: 'staged', token: 'm', filename: 'cert.pdf', size: 9 })
    expect(out.slots.other).toEqual(staged)   // draft content survives
    expect(out.extras).toEqual([staged])
  })
  it('seeds onto an empty base when there is no draft', () => {
    const out = attachmentsWithSeed(null, slots, { slotKey: SICK_ONLY_SLOT_KEY, staged: { token: 'm', filename: 'c', size: 1 } })
    expect(out.slots[SICK_ONLY_SLOT_KEY]?.token).toBe('m')
  })
  it('does not seed when the slot is absent', () => {
    const out = attachmentsWithSeed(null, [slot('other')], { slotKey: SICK_ONLY_SLOT_KEY, staged: { token: 'm', filename: 'c', size: 1 } })
    expect(out.slots[SICK_ONLY_SLOT_KEY]).toBeUndefined()
  })
  it('returns the base unchanged when there is no pending seed', () => {
    const draft = { ...emptyAttachmentsState(), slots: { other: staged } }
    expect(attachmentsWithSeed(draft, slots, undefined)).toEqual(draft)
  })
})
