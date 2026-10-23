import { formatDistanceToNow } from 'date-fns'
import { ar } from 'date-fns/locale'
import { parseUtcMs } from '@/lib/time'

export function recordAge(iso: string | null | undefined, isAr: boolean): string {
  if (!iso) return '—'
  const timestamp = parseUtcMs(iso)
  return Number.isFinite(timestamp) ? formatDistanceToNow(timestamp, { addSuffix: true, locale: isAr ? ar : undefined }) : '—'
}
