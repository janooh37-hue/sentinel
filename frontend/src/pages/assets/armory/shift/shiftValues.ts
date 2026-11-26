import type { ArmoryShiftWindowRead } from '@/lib/api'

export function shiftWindowKey(window: ArmoryShiftWindowRead): string {
  return `${window.shift_date}:${window.shift_kind}:${window.starts_at}:${window.ends_at}:${window.time_zone}`
}

export function groupByItem<T extends { item: { id: number } }>(rows: readonly T[]): T[][] {
  const groups = new Map<number, T[]>()
  for (const row of rows) {
    const group = groups.get(row.item.id)
    if (group) group.push(row)
    else groups.set(row.item.id, [row])
  }
  return [...groups.values()]
}

/** Keyboard scanners use the same code normalization as the register. Full matches win. */
export function matchSerial<T>(input: string, rows: readonly T[], codeOf: (row: T) => string | null) {
  const code = input.trim().toUpperCase().replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 0xf))
  let exact: T | undefined
  let suffix: T | undefined
  let suffixCount = 0
  if (code) {
    for (const row of rows) {
      const registered = codeOf(row)?.toUpperCase()
      if (registered === code) {
        if (exact !== undefined) return { hit: undefined, ambiguous: true }
        exact = row
      } else if (code.length >= 4 && registered?.endsWith(code)) {
        suffix = row
        suffixCount++
      }
    }
  }
  return { hit: exact ?? (suffixCount === 1 ? suffix : undefined), ambiguous: exact === undefined && suffixCount > 1 }
}
