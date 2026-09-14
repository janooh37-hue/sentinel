import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SLOT_IDS,
  NAV_SLOTS_STORAGE_KEY,
  SIGNAL_ENTRIES,
  loadSlotIds,
  placeEntry,
  resetSlot,
  saveSlotIds,
} from './navCustomization'

beforeEach(() => {
  localStorage.clear()
})

describe('navigation slot storage', () => {
  it('uses the default slots when storage is empty', () => {
    expect(loadSlotIds()).toEqual(DEFAULT_SLOT_IDS)
  })

  it('uses the default slots when storage is corrupt', () => {
    localStorage.setItem(NAV_SLOTS_STORAGE_KEY, '{not-json')

    expect(loadSlotIds()).toEqual(DEFAULT_SLOT_IDS)
  })

  it('replaces an unknown slot with that position’s default', () => {
    const stored = [...DEFAULT_SLOT_IDS]
    ;[stored[0], stored[1]] = [stored[1], stored[0]]
    stored[2] = 'sec:/not-a-route'
    localStorage.setItem(NAV_SLOTS_STORAGE_KEY, JSON.stringify({ v: 1, ids: stored }))

    expect(loadSlotIds()).toEqual([
      DEFAULT_SLOT_IDS[1],
      DEFAULT_SLOT_IDS[0],
      DEFAULT_SLOT_IDS[2],
      DEFAULT_SLOT_IDS[3],
    ])
  })

  it('uses the complete default layout when stored slots contain a duplicate', () => {
    const stored = [...DEFAULT_SLOT_IDS]
    stored[2] = stored[0]
    localStorage.setItem(NAV_SLOTS_STORAGE_KEY, JSON.stringify({ v: 1, ids: stored }))

    expect(loadSlotIds()).toEqual(DEFAULT_SLOT_IDS)
  })

  it('round-trips a valid custom layout using the versioned schema', () => {
    const custom = [...DEFAULT_SLOT_IDS]
    ;[custom[0], custom[3]] = [custom[3], custom[0]]

    saveSlotIds(custom)

    expect(JSON.parse(localStorage.getItem(NAV_SLOTS_STORAGE_KEY) ?? '')).toEqual({ v: 1, ids: custom })
    expect(loadSlotIds()).toEqual(custom)
  })

  it('keeps the first four slots of a legacy five-slot layout', () => {
    localStorage.setItem(
      NAV_SLOTS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        ids: ['sec:/', 'sec:/ledger', 'sec:/employees', 'sig:approvals', 'sec:/books'],
      }),
    )

    expect(loadSlotIds()).toEqual(['sec:/', 'sec:/ledger', 'sec:/employees', 'sig:approvals'])
  })
})

describe('navigation slot placement', () => {
  it('places a library entry into the requested slot without mutating the input', () => {
    const ids = [...DEFAULT_SLOT_IDS]
    const signal = SIGNAL_ENTRIES[0].id

    const placed = placeEntry(ids, 3, signal)

    expect(placed).toEqual([...DEFAULT_SLOT_IDS.slice(0, 3), signal, ...DEFAULT_SLOT_IDS.slice(4)])
    expect(ids).toEqual(DEFAULT_SLOT_IDS)
  })

  it('swaps an entry already in a different slot without mutating the input', () => {
    const ids = [...DEFAULT_SLOT_IDS]

    const placed = placeEntry(ids, 3, ids[0])

    expect(placed).toEqual([
      DEFAULT_SLOT_IDS[3],
      DEFAULT_SLOT_IDS[1],
      DEFAULT_SLOT_IDS[2],
      DEFAULT_SLOT_IDS[0],
    ])
    expect(ids).toEqual(DEFAULT_SLOT_IDS)
  })
})

describe('navigation slot reset', () => {
  it('restores the default entry for a slot', () => {
    const ids = placeEntry([...DEFAULT_SLOT_IDS], 1, SIGNAL_ENTRIES[0].id)

    expect(resetSlot(ids, 1)[1]).toBe(DEFAULT_SLOT_IDS[1])
  })

  it('swaps when the requested default is currently in another slot', () => {
    const ids = [...DEFAULT_SLOT_IDS]
    ;[ids[0], ids[2]] = [ids[2], ids[0]]

    expect(resetSlot(ids, 0)).toEqual(DEFAULT_SLOT_IDS)
  })
})
