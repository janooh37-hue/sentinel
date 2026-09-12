/**
 * Pure view model for the monthly inmate violation register.
 *
 * The server already orders the entries, assigns each one its per-table ordinal
 * and decides its group, so this module only groups, counts and formats. Two
 * bidi rules are load-bearing and live here rather than in each consumer:
 *
 *  1. numeric and date cells must be bidi-isolated (`dir="ltr"`), or an RTL cell
 *     renders `06/08/2026` as `062026/08/`;
 *  2. `Intl` on an Arabic locale interleaves RLM (U+200F) between date parts,
 *     which flips the fragments back inside those isolated cells — so formatted
 *     dates are stripped of U+200E/U+200F.
 */

import type {
  InmatePopulation,
  InmateRegisterEntry,
  InmateRegisterMonth,
} from '@/lib/api'

/** Document/worksheet order. `pending` is a group, never an inmate population. */
export const POPULATIONS: readonly InmatePopulation[] = ['citizens', 'expats', 'pending']

export const UNSPECIFIED = 'غير محدد'

/** Where the register lives: the third mode tab of the Records service. */
const REGISTER_HREF = '/application?form=inmate_conduct_violations&mode=stats'

/** Deep-link into one month of the register — the reminder's only action. */
export function inmateRegisterHref(year: number, month: number, submissionId?: number | null): string {
  return `${REGISTER_HREF}&stats_month=${monthKey(year, month)}${submissionId == null ? '' : `&stats_submission=${submissionId}`}`
}

export const inmateMonthlyTasksHref = `${REGISTER_HREF}#monthly-tasks`

export function parseSubmissionId(raw: string | null): number | null {
  if (raw === null || !/^[1-9]\d*$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

export interface RegisterGroup {
  key: InmatePopulation
  entries: InmateRegisterEntry[]
  /** `عدد المخالفات` for this table — a plain row count, never stored. */
  count: number
}

/** Group the month's entries into the three register tables, in paper order. */
export function groupEntries(month: InmateRegisterMonth | undefined): RegisterGroup[] {
  const entries = month?.entries ?? []
  return POPULATIONS.map((key) => {
    const own = entries.filter((entry) => entry.population === key)
    return { key, entries: own, count: own.length }
  })
}

/** The tabs/sections actually shown: `pending` appears only when non-empty. */
export function visibleGroups(groups: RegisterGroup[]): RegisterGroup[] {
  return groups.filter((group) => group.key !== 'pending' || group.count > 0)
}

/** `YYYY-MM` — the month switcher's value, and the query key's coordinates. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null
  return { year, month }
}

export function shiftMonth(year: number, month: number, delta: number): {
  year: number
  month: number
} {
  const zero = year * 12 + (month - 1) + delta
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 }
}

/** Strip the bidi marks `Intl` interleaves, so isolated cells stay readable. */
export function stripBidiMarks(value: string): string {
  return value.replace(/[\u200e\u200f]/g, '')
}

export function formatRegisterDate(iso: string, lang: string): string {
  const formatted = new Intl.DateTimeFormat(lang, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00`))
  return stripBidiMarks(formatted)
}

export function formatRegisterMonth(year: number, month: number, lang: string): string {
  const formatted = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1),
  )
  return stripBidiMarks(formatted)
}

export function formatRegisterDateTime(iso: string, lang: string): string {
  const formatted = new Intl.DateTimeFormat(lang, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
  return stripBidiMarks(formatted)
}

/** `IVR/2026-09` — month-derived, never a counter, so no sequence can break. */
export function documentReference(year: number, month: number): string {
  return `IVR/${monthKey(year, month)}`
}

/** Normalized lookup form for a filed nationality string.
 *
 * Mirrors `backend/app/core/nationalities.normalize_nationality` exactly: NFKC,
 * tatweel and Arabic diacritics removed, whitespace collapsed, Latin case-folded,
 * and hamzated/madda alef folded to bare alef. Alef maqsura and ta marbuta are
 * deliberately preserved. The alias table itself is served by the backend, so
 * only this transformation is duplicated.
 */
export function normalizeNationality(raw: string | null | undefined): string {
  if (!raw) return ''
  const stripped = raw
    .normalize('NFKC')
    .replace(/[\u064b-\u0652\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
  return stripped.trim().split(/\s+/).join(' ').toLowerCase()
}

/** Resolve a filed nationality string to its canonical code, or `null`.
 *
 * Blank input is "no nationality at all" (`null`); a non-empty string that
 * matches nothing resolves to the `XX` sentinel, which is a value that failed
 * to resolve — not a missing one.
 */
export function resolveNationalityCode(
  raw: string | null | undefined,
  aliases: Record<string, string>,
): string | null {
  const normalized = normalizeNationality(raw)
  if (!normalized) return null
  return aliases[normalized] ?? 'XX'
}
