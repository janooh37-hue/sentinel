/** URL contract of `/holdings/armory` (SPEC §7). Panes patch only their own keys. */
export const ARMORY_PATH = '/holdings/armory'

export const ARMORY_TABS = ['shift', 'items', 'custody', 'guards', 'audit'] as const
export type ArmoryTab = (typeof ARMORY_TABS)[number]

export function readArmoryTab(params: URLSearchParams): ArmoryTab {
  const tab = params.get('tab')
  return (ARMORY_TABS as readonly string[]).includes(tab ?? '') ? (tab as ArmoryTab) : 'shift'
}

/** Positive integer id from a query key, else `null` (never a guessed record). */
export function readArmoryId(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key)
  if (raw === null || !/^[1-9]\d{0,15}$/.test(raw)) return null
  return Number(raw)
}

/** Copy of `previous` with `patch` applied; `null` removes a key. */
export function patchArmoryParams(previous: URLSearchParams, patch: Readonly<Record<string, string | number | null>>): URLSearchParams {
  const next = new URLSearchParams(previous)
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) next.delete(key)
    else next.set(key, String(value))
  }
  return next
}

/** Detail keys owned by each tab; switching tabs drops the others' detail state. */
export const ARMORY_DETAIL_KEYS = ['item', 'serial', 'issue', 'return', 'custody', 'receipt', 'guard', 'pane', 'count', 'decision', 'movement'] as const

/** In-app link to an Armory destination; `safe` is kept by the shell when omitted. */
export function armoryLink(tab: ArmoryTab, params: Readonly<Record<string, string | number>> = {}): string {
  const query = new URLSearchParams({ tab })
  for (const [key, value] of Object.entries(params)) query.set(key, String(value))
  return `${ARMORY_PATH}?${query.toString()}`
}
