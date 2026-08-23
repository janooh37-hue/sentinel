import { Hourglass, ScanLine, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { NAV_ITEMS } from './navItems'

export type WaitingSignalId = 'approvals' | 'scanback'

export interface DockEntry {
  id: string
  kind: 'section' | 'signal'
  labelKey: string
  Icon: LucideIcon
  to: string
  cap?: string
  signal?: WaitingSignalId
}

export const SECTION_ENTRIES: readonly DockEntry[] = [
  ...NAV_ITEMS.map(
    ({ to, key, Icon, cap }): DockEntry => ({
      id: `sec:${to}`,
      kind: 'section',
      labelKey: key,
      Icon,
      to,
      cap,
    }),
  ),
  {
    id: 'sec:/settings',
    kind: 'section',
    labelKey: 'nav.settings',
    Icon: Settings,
    to: '/settings',
  },
]

export const SIGNAL_ENTRIES: readonly DockEntry[] = [
  {
    id: 'sig:approvals',
    kind: 'signal',
    labelKey: 'nav.signals.approvals',
    Icon: Hourglass,
    to: '/books',
    signal: 'approvals',
  },
  {
    id: 'sig:scanback',
    kind: 'signal',
    labelKey: 'nav.signals.scanback',
    Icon: ScanLine,
    to: '/books',
    signal: 'scanback',
  },
]

export const DEFAULT_SLOT_IDS: readonly string[] = [
  'sec:/',
  'sec:/employees',
  'sec:/leaves',
  'sec:/application',
  'sec:/books',
]

export const NAV_SLOTS_STORAGE_KEY = 'gssg.nav.slots'

const entriesById = Object.fromEntries(
  [...SECTION_ENTRIES, ...SIGNAL_ENTRIES].map((entry) => [entry.id, entry]),
) as Record<string, DockEntry>

interface StoredSlotIds {
  v: 1
  ids: string[]
}

export function entryById(id: string): DockEntry | undefined {
  return entriesById[id]
}

function normalizeSlotIds(ids: readonly unknown[]): string[] {
  if (ids.length !== DEFAULT_SLOT_IDS.length) return [...DEFAULT_SLOT_IDS]

  const normalized = ids.map((id, index) =>
    typeof id === 'string' && entryById(id) ? id : DEFAULT_SLOT_IDS[index],
  )

  return new Set(normalized).size === DEFAULT_SLOT_IDS.length ? normalized : [...DEFAULT_SLOT_IDS]
}

export function loadSlotIds(): string[] {
  if (typeof window === 'undefined') return [...DEFAULT_SLOT_IDS]

  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(NAV_SLOTS_STORAGE_KEY) ?? 'null')
    if (
      !stored ||
      typeof stored !== 'object' ||
      (stored as Partial<StoredSlotIds>).v !== 1 ||
      !Array.isArray((stored as Partial<StoredSlotIds>).ids)
    ) {
      return [...DEFAULT_SLOT_IDS]
    }

    return normalizeSlotIds((stored as StoredSlotIds).ids)
  } catch {
    return [...DEFAULT_SLOT_IDS]
  }
}

export function saveSlotIds(ids: string[]): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      NAV_SLOTS_STORAGE_KEY,
      JSON.stringify({ v: 1, ids: normalizeSlotIds(ids) } satisfies StoredSlotIds),
    )
  } catch {
    // Storage may be unavailable (for example, private browsing); the dock stays usable for this visit.
  }
}

export function placeEntry(ids: string[], slotIndex: number, entryId: string): string[] {
  const next = normalizeSlotIds(ids)
  if (!entryById(entryId) || slotIndex < 0 || slotIndex >= next.length) return next

  const previousIndex = next.indexOf(entryId)
  if (previousIndex >= 0) {
    ;[next[slotIndex], next[previousIndex]] = [next[previousIndex], next[slotIndex]]
  } else {
    next[slotIndex] = entryId
  }

  return next
}

export function resetSlot(ids: string[], slotIndex: number): string[] {
  return placeEntry(ids, slotIndex, DEFAULT_SLOT_IDS[slotIndex] ?? '')
}
