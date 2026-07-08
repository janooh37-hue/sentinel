/** Recently-opened employee profiles (lookup-page «آخر الملفات المفتوحة» card).
 *  localStorage-backed; failures (private mode, quota) are swallowed. */

export interface RecentEmployee {
  id: string
  name_en: string
  name_ar: string | null
  ts: number
}

const KEY = 'gssg.employees.recent'
const MAX = 5

export function getRecentEmployees(limit = MAX): RecentEmployee[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as RecentEmployee[]).slice(0, limit)
  } catch {
    return []
  }
}

export function recordRecentEmployee(e: { id: string; name_en: string; name_ar?: string | null }): void {
  try {
    const next: RecentEmployee[] = [
      { id: e.id, name_en: e.name_en, name_ar: e.name_ar ?? null, ts: Date.now() },
      ...getRecentEmployees().filter((r) => r.id !== e.id),
    ].slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore storage failures
  }
}
