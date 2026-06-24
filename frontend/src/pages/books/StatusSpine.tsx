/**
 * Records page — always-visible status spine. Seven segments (All + the six
 * approval states, incl. awaiting_scan for scan-path forms) with live counts;
 * the active segment is the filter.
 * Draft is neutral, pending is amber — visually distinct on purpose (audit
 * finding: the old page used the same warning tone for both).
 */
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export type SpineState =
  | 'all'
  | 'none'
  | 'pending'
  | 'awaiting_scan'
  | 'returned'
  | 'approved'
  | 'rejected'

const SEGMENTS: { state: SpineState; dotClass: string | null }[] = [
  { state: 'all', dotClass: null },
  { state: 'none', dotClass: '' }, // neutral — styled inline with var(--text-faint)
  { state: 'pending', dotClass: 'bg-warning' },
  { state: 'awaiting_scan', dotClass: 'bg-info' },
  { state: 'returned', dotClass: 'bg-info' },
  { state: 'approved', dotClass: 'bg-success' },
  { state: 'rejected', dotClass: 'bg-accent' },
]

export function StatusSpine({
  counts,
  active,
  onChange,
}: {
  counts: Record<SpineState, number>
  active: SpineState
  onChange: (s: SpineState) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('books.spine.all')}
      className="mb-3 flex overflow-hidden rounded-2xl border border-hairline bg-surface"
    >
      {SEGMENTS.map(({ state, dotClass }) => {
        const isActive = active === state
        return (
          <button
            key={state}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(state)}
            className={cn(
              'flex flex-1 flex-col items-start gap-0.5 border-e border-hairline px-3.5 py-2 text-start transition-colors last:border-e-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              isActive ? 'bg-primary-soft shadow-[inset_0_-2px_0_var(--primary)]' : 'hover:bg-surface-tinted',
            )}
          >
            <span className="font-mono text-[1.15em] font-bold leading-none tabular-nums">
              {counts[state]}
            </span>
            <span
              className={cn(
                'flex items-center gap-1.5 text-[0.7em] font-semibold',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {dotClass !== null && (
                <span
                  aria-hidden
                  className={cn('h-1.5 w-1.5 rounded-full', dotClass)}
                  style={state === 'none' ? { background: 'var(--text-faint)' } : undefined}
                />
              )}
              {t(`books.spine.${state}`)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
