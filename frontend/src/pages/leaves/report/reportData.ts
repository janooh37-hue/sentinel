/** Pure derivations for the Leaves "Annual Report" view.
 * All functions are pure over `LeaveListItem[]`. Dates are ISO `YYYY-MM-DD`
 * strings and are compared lexically — never `new Date(isoString)` for
 * ordering (TZ traps). Calendar-day arithmetic goes through `Date.UTC` on
 * split Y/M/D parts. */
import type { LeaveListItem } from '@/lib/api'
import { englishPart } from '@/lib/bilingualValue'
import { classifyLeaveType, CANONICAL_KINDS, type KindId } from './kinds'
import { canonStatus, countsDays } from '../lifecycle'

/** Stored statuses are frequently bilingual ("Generated - <ar>", ×595 in the
 * dev DB) alongside clean values ("Generated"). EVERY status grouping,
 * comparison, or rank in the report must go through this — it is the single
 * place the rule lives (StatusBadge does the same via `englishPart`).
 * NOTE: this intentionally does NOT alias Generated→Approved (that is
 * canonStatus's job). normalizeStatus is the bilingual-collapse layer; use
 * canonStatus for semantic comparisons (workflow order, outcome bucketing). */
export function normalizeStatus(raw: string): string {
  return englishPart(raw).trim()
}

export interface MonthRef { year: number; monthIndex: number } // monthIndex 0–11
export interface ReportScope {
  month: MonthRef | null
  employeeId: string | null
  kinds: KindId[]
  statuses: string[]
  q: string
}
export interface SortSpec { key: 'employee' | 'kind' | 'start' | 'days' | 'status'; dir: 'asc' | 'desc' }

const pad = (n: number): string => String(n + 1).padStart(2, '0')

/** UTC-safe calendar-day math: ISO date (or datetime — only Y/M/D used) → UTC ms. */
function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole calendar days from `a` to `b` (both ISO strings). */
function diffDays(a: string, b: string): number {
  return Math.round((isoToUtcMs(b) - isoToUtcMs(a)) / 86_400_000)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function recordOverlapsMonth(r: LeaveListItem, year: number, monthIndex: number): boolean {
  const monthStart = `${year}-${pad(monthIndex)}-01`
  const monthEnd = `${year}-${pad(monthIndex)}-31` // lexical compare; 31 safely bounds every month
  return r.start_date <= monthEnd && r.end_date >= monthStart
}

export function recordOverlapsYear(r: LeaveListItem, year: number): boolean {
  return r.start_date <= `${year}-12-31` && r.end_date >= `${year}-01-01`
}

/** Inclusive ISO day window — the figures' day-counting scope. */
export interface DayWindow { start: string; end: string }

export function monthWindow(year: number, monthIndex: number): DayWindow {
  // Date.UTC(y, m+1, 0) = last day of month m; getUTCDate() = its day number.
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return {
    start: `${year}-${pad(monthIndex)}-01`,
    end: `${year}-${pad(monthIndex)}-${String(lastDay).padStart(2, '0')}`,
  }
}

export function yearToDateWindow(year: number, todayIso: string): DayWindow {
  return { start: `${year}-01-01`, end: todayIso.slice(0, 10) }
}

/** A record's day contribution to a window (the prototype's per-day
 * attribution, done arithmetically): stored `days` when the record lies fully
 * inside; otherwise the calendar-day overlap, capped at the stored count
 * (stored `days` can be fewer than the calendar span — form-entered working
 * days — and must never be exceeded). 0 when there is no overlap. */
export function daysInWindow(r: LeaveListItem, w: DayWindow): number {
  const start = r.start_date.slice(0, 10)
  const end = r.end_date.slice(0, 10)
  if (end < w.start || start > w.end) return 0
  if (start >= w.start && end <= w.end) return r.days
  const overlapStart = start > w.start ? start : w.start
  const overlapEnd = end < w.end ? end : w.end
  return Math.min(r.days, diffDays(overlapStart, overlapEnd) + 1)
}

/** Rows whose days count as leave days (per-kind lifecycle: record-only kinds
 * and Rejected/Cancelled rows drop out). Used for all figures
 * (Fig. 1 / Fig. 2 / insight). */
export function countedRows(rows: LeaveListItem[]): LeaveListItem[] {
  return rows.filter((r) => countsDays(r.leave_type, r.status))
}


/** AND all active facets. `q` matches employee_id / employee_name_en /
 * employee_name_ar (case-insensitive includes); kinds match via
 * classifyLeaveType(r.leave_type); statuses compare via canonStatus so a
 * stored "Generated" row matches the "Approved" chip. */
export function applyScope(rows: LeaveListItem[], s: ReportScope): LeaveListItem[] {
  const q = s.q.trim().toLowerCase()
  return rows.filter((r) => {
    if (s.month && !recordOverlapsMonth(r, s.month.year, s.month.monthIndex)) return false
    if (s.employeeId && r.employee_id !== s.employeeId) return false
    if (s.kinds.length > 0 && !s.kinds.includes(classifyLeaveType(r.leave_type))) return false
    if (s.statuses.length > 0 && !s.statuses.includes(canonStatus(r.status))) return false
    if (q) {
      const hay = [r.employee_id, r.employee_name_en ?? '', r.employee_name_ar ?? '']
      if (!hay.some((h) => h.toLowerCase().includes(q))) return false
    }
    return true
  })
}

export interface KindAgg { kind: KindId; records: number; days: number; employees: number; avgDays: number; sharePct: number }

/** Group by classifyLeaveType; only kinds with records; sorted by days desc.
 * With a `window`, each record contributes its clipped `daysInWindow` share
 * and records contributing 0 days drop out entirely (the prototype's
 * `dys > 0` rule — a December leave is not "days taken" in June). */
export function kindAggregates(rows: LeaveListItem[], window?: DayWindow): KindAgg[] {
  const byKind = new Map<KindId, { records: number; days: number; employees: Set<string> }>()
  let totalDays = 0
  for (const r of rows) {
    const days = window ? daysInWindow(r, window) : r.days
    if (window && days === 0) continue
    const kind = classifyLeaveType(r.leave_type)
    let agg = byKind.get(kind)
    if (!agg) {
      agg = { records: 0, days: 0, employees: new Set() }
      byKind.set(kind, agg)
    }
    agg.records += 1
    agg.days += days
    agg.employees.add(r.employee_id)
    totalDays += days
  }
  const out: KindAgg[] = []
  for (const k of CANONICAL_KINDS) {
    const agg = byKind.get(k.id)
    if (!agg) continue
    out.push({
      kind: k.id,
      records: agg.records,
      days: agg.days,
      employees: agg.employees.size,
      avgDays: agg.records > 0 ? agg.days / agg.records : 0,
      sharePct: totalDays > 0 ? (agg.days / totalDays) * 100 : 0,
    })
  }
  out.sort((a, b) => b.days - a.days)
  return out
}

export interface MonthAgg { monthIndex: number; records: number; days: number; employees: number; topKind: KindId | null }

/** Always 12 entries (Jan–Dec of `year`). Each record contributes its
 * clipped `daysInWindow` share to each month it touches — a straddling record
 * appears in both months but its days are PARTITIONED, never double-counted
 * (the prototype's per-day attribution). Records contributing 0 days to a
 * month don't count toward that month's records/employees. */
export function monthAggregates(rows: LeaveListItem[], year: number): MonthAgg[] {
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const w = monthWindow(year, monthIndex)
    const inMonth = rows
      .map((r) => ({ r, d: daysInWindow(r, w) }))
      .filter((x) => x.d > 0)
    const days = inMonth.reduce((sum, x) => sum + x.d, 0)
    const employees = new Set(inMonth.map((x) => x.r.employee_id)).size
    let topKind: KindId | null = null
    if (inMonth.length > 0) {
      const daysByKind = new Map<KindId, number>()
      for (const x of inMonth) {
        const kind = classifyLeaveType(x.r.leave_type)
        daysByKind.set(kind, (daysByKind.get(kind) ?? 0) + x.d)
      }
      let best = -1
      for (const k of CANONICAL_KINDS) { // canonical order breaks ties deterministically
        const d = daysByKind.get(k.id)
        if (d !== undefined && d > best) {
          best = d
          topKind = k.id
        }
      }
    }
    return { monthIndex, records: inMonth.length, days, employees, topKind }
  })
}

export type OutcomeBucket = 'settled' | 'inMotion' | 'rejected' | 'cancelled'

export interface OutcomeAgg { bucket: OutcomeBucket; count: number; pct: number; days: number; medianLeadDays: number | null }

const BUCKET_OF: Record<string, OutcomeBucket> = {
  Approved: 'settled',
  Completed: 'settled',
  Pending: 'inMotion',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
}
const BUCKET_ORDER: OutcomeBucket[] = ['settled', 'inMotion', 'rejected', 'cancelled']

/** Outcome aggregates keyed by lifecycle bucket (settled/inMotion/rejected/cancelled).
 * canonStatus is applied per row so Generated → Approved → settled and bilingual
 * spellings collapse to the same bucket. All four buckets are always present
 * (callers drop zero-count segments for display). */
export function outcomeAggregates(rows: LeaveListItem[]): OutcomeAgg[] {
  const total = rows.length
  return BUCKET_ORDER.map((bucket) => {
    const inBucket = rows.filter((r) => (BUCKET_OF[canonStatus(r.status)] ?? 'inMotion') === bucket)
    const leads = inBucket
      .filter((r) => Boolean(r.created_at) && Boolean(r.start_date))
      .map((r) => diffDays(r.created_at, r.start_date))
    return {
      bucket,
      count: inBucket.length,
      pct: total > 0 ? (inBucket.length / total) * 100 : 0,
      days: inBucket.reduce((sum, r) => sum + r.days, 0),
      medianLeadDays: median(leads),
    }
  })
}

/** Status sort rank by lifecycle bucket order, then raw status within bucket
 * for stable ties. */
function statusSortRank(raw: string): number {
  const bucket = BUCKET_OF[canonStatus(raw)] ?? 'inMotion'
  return BUCKET_ORDER.indexOf(bucket) * 100 + raw.charCodeAt(0) % 100
}

/** Stable copy-sort; employee key = the DISPLAYED name via `nameOf` (so the
 * Arabic UI sorts by Arabic names with Arabic collation — half the audience),
 * falling back to name_en/id when no accessor is given; kind sorts
 * alphabetically by canonical kind id (intentional — grouping/display order
 * is a UI concern, not a data one); start/days lexical/numeric; status by
 * lifecycle bucket order. */
export function sortRows(
  rows: LeaveListItem[],
  sort: SortSpec,
  nameOf?: (r: LeaveListItem) => string,
  lang?: string,
): LeaveListItem[] {
  const cmp = (a: LeaveListItem, b: LeaveListItem): number => {
    switch (sort.key) {
      case 'employee': {
        const an = nameOf ? nameOf(a) : a.employee_name_en || a.employee_id
        const bn = nameOf ? nameOf(b) : b.employee_name_en || b.employee_id
        return an.localeCompare(bn, lang)
      }
      case 'kind':
        return classifyLeaveType(a.leave_type).localeCompare(classifyLeaveType(b.leave_type))
      case 'start':
        return a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0
      case 'days':
        return a.days - b.days
      case 'status':
        return statusSortRank(a.status) - statusSortRank(b.status)
    }
  }
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => dir * cmp(a, b)) // Array.sort is stable
}

export type GroupMode = 'none' | 'kind' | 'month'

export interface RowGroup {
  /** Stable render key: `'all'` | kind id | `'YYYY-MM'`. */
  key: string
  kind: KindId | null
  /** `YYYY-MM` of `start_date` for month groups. */
  month: string | null
  rows: LeaveListItem[]
  days: number
}

/** Bucket already-sorted rows for rendering (rows keep their incoming order
 * inside each bucket). `'kind'` groups follow CANONICAL_KINDS order (only
 * kinds present). `'month'` groups bucket by the start_date month — a display
 * concern, intentionally distinct from the figures' day-overlap scoping —
 * ordered newest-first, or oldest-first when the table is sorted by start
 * ascending (the prototype's behavior, so group order follows the sort). */
export function groupRows(rows: LeaveListItem[], mode: GroupMode, sort: SortSpec): RowGroup[] {
  const sum = (rs: LeaveListItem[]): number => rs.reduce((s, r) => s + r.days, 0)
  if (mode === 'none') {
    return [{ key: 'all', kind: null, month: null, rows, days: sum(rows) }]
  }
  if (mode === 'month') {
    const byMonth = new Map<string, LeaveListItem[]>()
    for (const r of rows) {
      const ym = r.start_date.slice(0, 7)
      const bucket = byMonth.get(ym)
      if (bucket) bucket.push(r)
      else byMonth.set(ym, [r])
    }
    const asc = sort.key === 'start' && sort.dir === 'asc'
    const keys = [...byMonth.keys()].sort((a, b) =>
      asc ? (a < b ? -1 : 1) : a < b ? 1 : -1,
    )
    return keys.map((ym) => {
      const rs = byMonth.get(ym)!
      return { key: ym, kind: null, month: ym, rows: rs, days: sum(rs) }
    })
  }
  const byKind = new Map<KindId, LeaveListItem[]>()
  for (const r of rows) {
    const kind = classifyLeaveType(r.leave_type)
    const bucket = byKind.get(kind)
    if (bucket) bucket.push(r)
    else byKind.set(kind, [r])
  }
  return CANONICAL_KINDS.filter((k) => byKind.has(k.id)).map((k) => {
    const rs = byKind.get(k.id)!
    return { key: k.id, kind: k.id, month: null, rows: rs, days: sum(rs) }
  })
}

export interface TableTotals { records: number; days: number; employees: number }

/** Footer totals over the visible (scoped) rows. */
export function tableTotals(rows: LeaveListItem[]): TableTotals {
  return {
    records: rows.length,
    days: rows.reduce((s, r) => s + r.days, 0),
    employees: new Set(rows.map((r) => r.employee_id)).size,
  }
}

export interface Insights { sickDays: number; totalDays: number; sickSharePct: number; busiestMonthIndex: number | null }

/** Derives from the already-windowed figure aggregates so the insight line
 * always agrees with Fig. 1 (sick share) and Fig. 2 (busiest month). */
export function computeInsights(kinds: KindAgg[], months: MonthAgg[]): Insights {
  let sickDays = 0
  let totalDays = 0
  for (const k of kinds) {
    totalDays += k.days
    if (k.kind === 'Sick Leave') sickDays += k.days
  }
  let busiestMonthIndex: number | null = null
  let best = 0
  for (const m of months) {
    if (m.days > best) { // strict > → earliest month wins ties; all-zero → null
      best = m.days
      busiestMonthIndex = m.monthIndex
    }
  }
  return {
    sickDays,
    totalDays,
    sickSharePct: totalDays > 0 ? (sickDays / totalDays) * 100 : 0,
    busiestMonthIndex,
  }
}

export interface EmployeeProfile {
  current: LeaveListItem | null; daysUntilReturn: number | null
  last: LeaveListItem | null; pendingCount: number
  daysByKind: { kind: KindId; days: number }[]
}

/** current: canon status not Rejected/Cancelled && start <= today <= end
 * (prefer Approved over Generated/Pending if two overlap);
 * daysUntilReturn = calendar days today→end_date (UTC-safe);
 * last: latest end_date < today with canon status Approved or Completed;
 * pendingCount: rows with canon status Pending;
 * daysByKind: this calendar year (year of todayIso, counted rows per
 * countsDays), sorted days desc — record-only kinds excluded. */
export function employeeProfile(rows: LeaveListItem[], employeeId: string, todayIso: string): EmployeeProfile {
  const today = todayIso.slice(0, 10)
  const mine = rows.filter((r) => r.employee_id === employeeId)

  const currentCandidates = mine.filter((r) => {
    const cs = canonStatus(r.status)
    return cs !== 'Rejected' && cs !== 'Cancelled' && r.start_date <= today && r.end_date >= today
  })
  currentCandidates.sort((a, b) => {
    const ap = canonStatus(a.status) === 'Approved' ? 0 : 1
    const bp = canonStatus(b.status) === 'Approved' ? 0 : 1
    if (ap !== bp) return ap - bp
    return a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0 // latest start first
  })
  const current = currentCandidates[0] ?? null
  const daysUntilReturn = current ? diffDays(today, current.end_date) : null

  const completed = mine.filter((r) => {
    const cs = canonStatus(r.status)
    return r.end_date < today && (cs === 'Approved' || cs === 'Completed')
  })
  completed.sort((a, b) => (a.end_date < b.end_date ? 1 : a.end_date > b.end_date ? -1 : 0))
  const last = completed[0] ?? null

  const pendingCount = mine.filter((r) => canonStatus(r.status) === 'Pending').length

  const year = today.slice(0, 4)
  const daysByKindMap = new Map<KindId, number>()
  for (const r of mine) {
    if (!countsDays(r.leave_type, r.status)) continue
    if (!r.start_date.startsWith(year)) continue
    const kind = classifyLeaveType(r.leave_type)
    daysByKindMap.set(kind, (daysByKindMap.get(kind) ?? 0) + r.days)
  }
  const daysByKind = CANONICAL_KINDS
    .filter((k) => daysByKindMap.has(k.id))
    .map((k) => ({ kind: k.id, days: daysByKindMap.get(k.id)! }))
    .sort((a, b) => b.days - a.days)

  return { current, daysUntilReturn, last, pendingCount, daysByKind }
}
