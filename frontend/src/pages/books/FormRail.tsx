/**
 * Records page — form-kind rail (left pane). One item per form kind present in
 * the data (+ "All"), with count and colored mini-dots for the non-draft
 * states present in that kind. Calibrated artwork provides wayfinding, with
 * glyphs retained as the fallback for services without artwork.
 *
 * Two tiers (the page picks one from its container width, never both):
 *   full   the 15rem rail: artwork · label · state dots · count
 *   icons  the `w-14` rail: artwork + count badge, label in a `Hint`
 * The "Created by me" toggle sits at the top of either tier; the page hides it
 * (passes no `mine`) for inmate reporters, and renders `MineChip` itself in the
 * drawer tier where there is no rail.
 */
import { UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Hint } from '@/components/ui/hint'
import { ServiceArtwork, type ServiceArtworkId } from '@/components/ui/service-artwork'

import { cn } from '@/lib/utils'
import { useCapabilities } from '@/lib/useCapabilities'
import { hasServiceRecordsCap } from '@/lib/dashboardLayout'

export interface RailItem {
  serviceId: string
  glyph: string
  artwork?: ServiceArtworkId
  /** Already-localised label (from serviceLabels.useServiceLabel). */
  label: string
  count: number
  /** distinct non-draft approval states present, e.g. ['pending','approved'] */
  states: string[]
}

export type RailTier = 'icons' | 'full'

/** The "Created by me" toggle's state, owned by the page (URL `mine=1`). */
export interface MineToggleState {
  pressed: boolean
  /** Records I created (always-on badge query); `null` until the first response. */
  count: number | null
  onToggle: () => void
}

const DOT: Record<string, string> = {
  pending: 'bg-warning',
  awaiting_scan: 'bg-info',
  returned: 'bg-info',
  approved: 'bg-success',
  rejected: 'bg-accent',
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

/**
 * "Created by me": `aria-pressed`, `UserRound`, label + count badge.
 * `row` = full-rail row, `icon` = icon-rail cell (label in a Hint),
 * `chip` = pill for the drawer tier's toolbar, next to Drafts.
 */
export function MineChip({
  pressed,
  count,
  onToggle,
  variant,
}: MineToggleState & { variant: 'row' | 'icon' | 'chip' }): React.JSX.Element {
  const { t } = useTranslation()
  const label = t('books.list.createdByMe')
  const badge = count !== null && (
    <span
      className={cn(
        'font-mono tabular-nums',
        variant === 'icon' &&
          'absolute end-0.5 top-0.5 rounded-full border border-border bg-surface px-1 text-[0.6em] leading-4',
        variant === 'row' && 'ms-auto text-[0.68em] text-faint',
        variant === 'chip' &&
          'inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[0.85em] font-bold',
      )}
    >
      <bdi dir="ltr">{count}</bdi>
    </span>
  )

  if (variant === 'icon') {
    return (
      <Hint label={label} side="end">
        <button
          type="button"
          aria-pressed={pressed}
          onClick={onToggle}
          className={cn(
            'relative grid min-h-11 w-full place-items-center rounded-sm transition-colors motion-reduce:transition-none',
            FOCUS,
            pressed ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:bg-surface-tinted',
          )}
        >
          <UserRound className="h-4 w-4" aria-hidden />
          <span className="sr-only">{label}</span>
          {badge}
        </button>
      </Hint>
    )
  }

  if (variant === 'chip') {
    return (
      <button
        type="button"
        aria-pressed={pressed}
        onClick={onToggle}
        className={cn(
          'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.75em] font-semibold transition-colors motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          pressed
            ? 'border-primary/40 bg-primary-soft text-primary'
            : 'border-hairline bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
        )}
      >
        <UserRound className="h-3.5 w-3.5" aria-hidden />
        {label}
        {badge}
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        'flex min-h-11 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-start transition-colors motion-reduce:transition-none',
        FOCUS,
        pressed ? 'bg-primary-soft' : 'hover:bg-surface-tinted',
      )}
    >
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-hairline bg-surface-raised"
      >
        <UserRound className="h-4 w-4" />
      </span>
      <span className={cn('min-w-0 flex-1 truncate text-[0.8em] font-semibold', pressed && 'text-primary')}>
        {label}
      </span>
      {badge}
    </button>
  )
}

export function FormRail({
  items,
  active,
  onChange,
  tier = 'full',
  mine,
}: {
  items: RailItem[]
  active: string
  onChange: (serviceId: string) => void
  tier?: RailTier
  /** Omit to hide the "Created by me" toggle (inmate reporters). */
  mine?: MineToggleState
}): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const visibleItems = items.filter(
    (item) => item.serviceId === 'all' || hasServiceRecordsCap(item.serviceId, has),
  )
  const icons = tier === 'icons'
  return (
    <nav
      aria-label={t('books.formKind.all')}
      data-records-rail
      data-rail-tier={tier}
      className={cn(
        'min-h-0 overflow-y-auto rounded-2xl border border-hairline bg-surface',
        icons ? 'p-1.5' : 'p-2',
      )}
    >
      {mine && (
        <div className="mb-1.5 border-b border-hairline pb-1.5">
          <MineChip {...mine} variant={icons ? 'icon' : 'row'} />
        </div>
      )}
      {visibleItems.map((item) => {
        const isActive = active === item.serviceId
        const tile = (
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-hairline bg-surface-raised text-[1em]"
          >
            {item.artwork ? <ServiceArtwork artwork={item.artwork} size="row" /> : item.glyph}
          </span>
        )
        if (icons) {
          return (
            <Hint key={item.serviceId} label={item.label} side="end">
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => onChange(item.serviceId)}
                className={cn(
                  'relative grid min-h-11 w-full place-items-center rounded-sm transition-colors motion-reduce:transition-none',
                  FOCUS,
                  isActive ? 'bg-primary-soft' : 'hover:bg-surface-tinted',
                )}
              >
                {tile}
                <span className="sr-only">{item.label}</span>
                <span className="absolute end-0.5 top-0.5 rounded-full border border-border bg-surface px-1 font-mono text-[0.6em] leading-4 tabular-nums text-faint">
                  <bdi dir="ltr">{item.count}</bdi>
                </span>
              </button>
            </Hint>
          )
        }
        return (
          <button
            key={item.serviceId}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(item.serviceId)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-start transition-colors motion-reduce:transition-none',
              FOCUS,
              isActive ? 'bg-primary-soft' : 'hover:bg-surface-tinted',
            )}
          >
            {tile}
            <span className="min-w-0 flex-1">
              <span
                className={cn('block truncate text-[0.8em] font-semibold', isActive && 'text-primary')}
              >
                {item.label}
              </span>
              {item.states.length > 0 && (
                <span className="mt-0.5 flex gap-1" aria-hidden>
                  {item.states.map((s) => (
                    <span key={s} className={cn('h-1.5 w-1.5 rounded-full', DOT[s] ?? 'bg-border')} />
                  ))}
                </span>
              )}
            </span>
            <span className="font-mono text-[0.68em] text-faint tabular-nums">
              <bdi dir="ltr">{item.count}</bdi>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
