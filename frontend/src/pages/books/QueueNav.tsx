/**
 * QueueNav — prev/next through the list or approval queue the record was
 * opened from, shown beside the record page's back button.
 *
 * Lives in the HEADER, never on the desk: BookRecordPage pins the desk to
 * `direction: ltr` so the Progress rail doesn't flip sides in Arabic, and
 * chevrons placed there would point the wrong way. In the header they inherit
 * page direction, and `rtl:-scale-x-100` mirrors the glyphs (repo idiom).
 *
 * `compact` (phone): 44px targets, an `i/n` counter and no key hints — the
 * keyboard shortcuts K / J do not exist on touch.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Hint } from '@/components/ui/hint'
import { cn } from '@/lib/utils'

// Private-use delimiters: placeholders survive translation and are swapped for isolated numbers
// (same technique as `StatusText` in record/RecordHeader).
const NUM_OPEN = '\uE000'
const NUM_CLOSE = '\uE001'
const NUM_TOKEN = new RegExp(`(${NUM_OPEN}\\w+${NUM_CLOSE})`)
const NUM_TOKEN_ONE = new RegExp(`^${NUM_OPEN}(\\w+)${NUM_CLOSE}$`)

export function QueueNav({
  position,
  total,
  onPrev,
  onNext,
  compact = false,
}: {
  position: number | null
  total: number
  onPrev: () => void
  onNext: () => void
  compact?: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  // Nothing to walk — stay out of the way of anyone not working a stack.
  if (position == null || total < 2) return null

  const btn = cn(
    'flex items-center justify-center rounded-lg text-primary transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 motion-reduce:transition-none',
    compact ? 'h-11 w-11' : 'h-[30px] w-[30px]',
  )

  const prev = (
    <button
      type="button"
      data-testid="queue-prev"
      onClick={onPrev}
      disabled={position <= 1}
      aria-label={t('books.record.prevRecord')}
      className={btn}
    >
      <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} />
    </button>
  )
  const next = (
    <button
      type="button"
      data-testid="queue-next"
      onClick={onNext}
      disabled={position >= total}
      aria-label={t('books.record.nextRecord')}
      className={btn}
    >
      <ChevronRight className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} />
    </button>
  )

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-0.5 rounded-xl border border-hairline bg-surface p-0.5',
        compact && 'border-transparent bg-transparent',
      )}
    >
      {compact ? prev : (
        <Hint label={t('books.record.prevRecord')} shortcut="K" side="bottom">
          {prev}
        </Hint>
      )}
      <span
        data-testid="queue-position"
        className="min-w-[2.5rem] px-1 text-center font-mono text-[0.72em] font-semibold tabular-nums text-muted-foreground"
      >
        {compact ? (
          <bdi dir="ltr">{`${position}/${total}`}</bdi>
        ) : (
          t('books.record.queuePosition', {
            n: `${NUM_OPEN}n${NUM_CLOSE}`,
            total: `${NUM_OPEN}total${NUM_CLOSE}`,
          })
            .split(NUM_TOKEN)
            .map((part, i) => {
              const key = NUM_TOKEN_ONE.exec(part)?.[1]
              if (!key) return part
              return (
                <bdi key={i} dir="ltr">
                  {key === 'n' ? position : total}
                </bdi>
              )
            })
        )}
      </span>
      {compact ? next : (
        <Hint label={t('books.record.nextRecord')} shortcut="J" side="bottom">
          {next}
        </Hint>
      )}
    </div>
  )
}
