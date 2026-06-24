/**
 * LedgerTimeline — Mail-app style row list grouped by month (TAMM redesign).
 *
 * Direction is signalled by a colored 9px dot per row (success · accent ·
 * primary). Rows are rendered by `LedgerRow`. Month headers carry inline
 * direction counts ("MAY 2026 · 59 in · 2 out · 129 internal"). A small dot
 * legend is rendered at the bottom of each list.
 *
 * The list renders newest-first; month headers stay sticky as you scroll.
 */

import { useMemo } from 'react'
import { format } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'

import type { LedgerListItem } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { LedgerRow } from './LedgerRow'

// ─── LedgerTimeline ──────────────────────────────────────────────────────────

interface MonthGroup {
  label: string
  items: LedgerListItem[]
  incoming: number
  outgoing: number
  internal: number
}

function groupByMonth(items: LedgerListItem[], isAr: boolean): MonthGroup[] {
  const map = new Map<string, LedgerListItem[]>()
  for (const item of items) {
    const d = new Date(item.entry_date + 'T00:00:00')
    const key = format(d, 'yyyy-MM')
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  const sorted = Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  return sorted.map(([key, group]) => {
    const d = new Date(key + '-01T00:00:00')
    const label = format(d, 'MMMM yyyy', isAr ? { locale: arLocale } : undefined)
    // Direction tallies computed once per `items` change (folded into the memo)
    // rather than re-filtering on every render.
    let incoming = 0
    let outgoing = 0
    let internal = 0
    for (const e of group) {
      if (e.direction === 'incoming') incoming++
      else if (e.direction === 'outgoing') outgoing++
      else if (e.direction === 'internal') internal++
    }
    return { label, items: group, incoming, outgoing, internal }
  })
}

interface LedgerTimelineProps {
  items: LedgerListItem[]
  onEntryClick: (id: number) => void
}

export function LedgerTimelineSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-none" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function LedgerTimeline({
  items,
  onEntryClick,
}: LedgerTimelineProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')

  const groups = useMemo(() => groupByMonth(items, isAr), [items, isAr])

  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ label, items: groupItems, incoming, outgoing, internal }) => {
        const countParts = directionCountParts(t, {
          in: incoming,
          out: outgoing,
          int: internal,
        })
        return (
          <div key={label} className="flex flex-col gap-2">
            {/* Month header — TAMM vocabulary: uppercase tracked label +
             * primary-colored direction counts. Each count is its own span so
             * RTL bidi keeps "{{n}} label" units intact and ordered. */}
            <div className="sticky top-0 z-10 bg-background pb-2 pt-1">
              <h2
                className="flex flex-wrap items-baseline gap-2 px-1 text-[0.78em] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                dir={isAr ? 'rtl' : 'ltr'}
              >
                <span>{label}</span>
                <span
                  className="inline-flex flex-wrap items-baseline gap-x-1.5 text-[0.95em] font-medium normal-case tracking-normal text-primary"
                  data-testid="direction-counts"
                >
                  {countParts.map((part, i) => (
                    <span key={i} className="inline-flex items-baseline gap-1.5">
                      <span aria-hidden className="text-muted-foreground/50">
                        ·
                      </span>
                      <span>{part}</span>
                    </span>
                  ))}
                </span>
              </h2>
            </div>

            {/* Card container */}
            <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
              {groupItems.map((item) => (
                <LedgerRow
                  key={item.id}
                  entry={item}
                  onClick={() => onEntryClick(item.id)}
                />
              ))}
            </div>
          </div>
        )
      })}

      {/* Legend — small dot + label for each direction. Rendered once for the
       * whole list, not per month group. */}
      <Legend />
    </div>
  )
}

/**
 * Build the per-direction count labels for a month group. Uses a plain `{{n}}`
 * interpolation (not i18next's `count` option) on purpose: Arabic has six
 * plural categories (zero/one/two/few/many/other) and the locale only carries
 * a single form per direction, so passing `count` would miss the resolved
 * category for most numbers and fall back to the English default. Returns the
 * parts unjoined so the caller can render each as its own bidi-isolated span.
 */
function directionCountParts(
  t: (key: string, options?: Record<string, unknown>) => string,
  counts: { in: number; out: number; int: number },
): string[] {
  const parts: string[] = []
  if (counts.in > 0) {
    parts.push(t('ledger.month.in', { n: counts.in, defaultValue: '{{n}} in' }))
  }
  if (counts.out > 0) {
    parts.push(t('ledger.month.out', { n: counts.out, defaultValue: '{{n}} out' }))
  }
  if (counts.int > 0) {
    parts.push(t('ledger.month.int', { n: counts.int, defaultValue: '{{n}} internal' }))
  }
  return parts
}

function Legend(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-4 px-1 pt-1 text-[0.72em] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full bg-success"
          aria-hidden
        />
        {t('ledger.direction.incoming')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full bg-accent"
          aria-hidden
        />
        {t('ledger.direction.outgoing')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full bg-primary"
          aria-hidden
        />
        {t('ledger.direction.internal')}
      </span>
    </div>
  )
}
