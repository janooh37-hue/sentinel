/**
 * Pure helpers for grouping employees by duty-location (unit → post).
 *
 * The roster page fetches `listEmployees({ limit: 500 })` once and groups
 * client-side with these. No React, no I/O — unit-tested in
 * `lib/__tests__/dutyUnits.test.ts`.
 */

import type { EmployeeListItem } from './api'

/** The 6 seed units, in operator-confirmed Arabic order. Suggestions only —
 *  `duty_unit` is not a hard enum (new units may appear). */
export const SEED_UNITS: readonly string[] = [
  'الدوام الرسمي',
  'السرية الأولى',
  'السرية الثانية',
  'السرية الثالثة',
  'السرية الرابعة',
  'السرية الخامسة',
] as const

/** Sentinel key for the bucket of employees with no `duty_unit`. */
export const UNASSIGNED = '__unassigned__'

type DutyEmployee = Pick<EmployeeListItem, 'duty_unit' | 'duty_post'>

function unitKey(emp: DutyEmployee): string {
  const u = emp.duty_unit?.trim()
  return u ? u : UNASSIGNED
}

function postKey(emp: DutyEmployee): string {
  return emp.duty_post?.trim() || ''
}

/**
 * Group employees into `unit → (post → employees[])`.
 *
 * - Units are ordered seed-first (in `SEED_UNITS` order), then any extra units
 *   in first-seen order, then the `UNASSIGNED` bucket last (only if non-empty).
 * - Within a unit, posts are in first-seen order; the empty post (`''`) holds
 *   employees assigned to a unit but no post.
 */
export function groupByUnit<T extends DutyEmployee>(emps: readonly T[]): Map<string, Map<string, T[]>> {
  const byUnit = new Map<string, Map<string, T[]>>()

  for (const emp of emps) {
    const u = unitKey(emp)
    let posts = byUnit.get(u)
    if (!posts) {
      posts = new Map<string, T[]>()
      byUnit.set(u, posts)
    }
    const p = postKey(emp)
    const list = posts.get(p)
    if (list) list.push(emp)
    else posts.set(p, [emp])
  }

  // Re-order the units: seed-first, then extras (first-seen), Unassigned last.
  const ordered = new Map<string, Map<string, T[]>>()
  for (const seed of SEED_UNITS) {
    const posts = byUnit.get(seed)
    if (posts) ordered.set(seed, posts)
  }
  for (const [u, posts] of byUnit) {
    if (u === UNASSIGNED || SEED_UNITS.includes(u)) continue
    ordered.set(u, posts)
  }
  const unassigned = byUnit.get(UNASSIGNED)
  if (unassigned) ordered.set(UNASSIGNED, unassigned)

  return ordered
}

/** Distinct, first-seen posts already in use for `unit` (empty post excluded). */
export function postsForUnit(emps: readonly DutyEmployee[], unit: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const emp of emps) {
    if (unitKey(emp) !== unit) continue
    const p = postKey(emp)
    if (!p || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

/**
 * Unit suggestions for a combobox: the 6 seed units (in order) followed by any
 * extra units actually present in the data (first-seen), de-duplicated. The
 * Unassigned bucket is never a destination.
 */
export function unitOptions(emps: readonly DutyEmployee[]): string[] {
  const out: string[] = [...SEED_UNITS]
  const seen = new Set<string>(SEED_UNITS)
  for (const emp of emps) {
    const u = emp.duty_unit?.trim()
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

/** Post suggestions for a combobox, given the chosen destination unit. */
export function postOptions(emps: readonly DutyEmployee[], unit: string): string[] {
  return postsForUnit(emps, unit)
}
