/**
 * Records page — form-kind rail (left pane). One item per form kind present in
 * the data (+ "All"), with count and colored mini-dots for the non-draft
 * states present in that kind. Calibrated artwork provides wayfinding, with
 * glyphs retained as the fallback for services without artwork.
 */
import { useTranslation } from 'react-i18next'

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

const DOT: Record<string, string> = {
  pending: 'bg-warning',
  awaiting_scan: 'bg-info',
  returned: 'bg-info',
  approved: 'bg-success',
  rejected: 'bg-accent',
}

export function FormRail({
  items,
  active,
  onChange,
}: {
  items: RailItem[]
  active: string
  onChange: (serviceId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const visibleItems = items.filter(
    (item) => item.serviceId === 'all' || hasServiceRecordsCap(item.serviceId, has),
  )
  return (
    <nav
      aria-label={t('books.formKind.all')}
      className="overflow-y-auto rounded-2xl border border-hairline bg-surface p-2"
    >
      {visibleItems.map((item) => {
        const isActive = active === item.serviceId
        return (
          <button
            key={item.serviceId}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(item.serviceId)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-start transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              isActive ? 'bg-primary-soft' : 'hover:bg-surface-tinted',
            )}
          >
            <span
              aria-hidden
              className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-hairline bg-surface-raised text-[1em]"
            >
              {item.artwork ? (
                <ServiceArtwork artwork={item.artwork} size="row" />
              ) : (
                item.glyph
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn('block truncate text-[0.8em] font-semibold', isActive && 'text-primary')}
              >
                {item.label}
              </span>
              {item.states.length > 0 && (
                <span className="mt-0.5 flex gap-1">
                  {item.states.map((s) => (
                    <span
                      key={s}
                      title={t(`books.spine.${s}`)}
                      className={cn('h-1.5 w-1.5 rounded-full', DOT[s] ?? 'bg-border')}
                    />
                  ))}
                </span>
              )}
            </span>
            <span className="font-mono text-[0.68em] text-faint tabular-nums">{item.count}</span>
          </button>
        )
      })}
    </nav>
  )
}
