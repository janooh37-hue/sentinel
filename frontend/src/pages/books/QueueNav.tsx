/**
 * QueueNav — prev/next through the manager's approval queue, shown beside the
 * record page's back button.
 *
 * Lives in the HEADER, never on the desk: BookRecordPage pins the desk to
 * `direction: ltr` so the Progress rail doesn't flip sides in Arabic, and
 * chevrons placed there would point the wrong way. In the header they inherit
 * page direction, and `rtl:-scale-x-100` mirrors the glyphs (repo idiom).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function QueueNav({
  position,
  total,
  onPrev,
  onNext,
}: {
  position: number | null
  total: number
  onPrev: () => void
  onNext: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  // Nothing to walk — stay out of the way of anyone not working a stack.
  if (position == null || total < 2) return null

  const btn =
    'flex h-9 w-8 items-center justify-center rounded-lg border border-hairline bg-surface text-primary transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40'

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-testid="queue-prev"
        onClick={onPrev}
        disabled={position <= 1}
        aria-label={t('books.record.prevAwaiting')}
        className={btn}
      >
        <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} />
      </button>
      <span
        data-testid="queue-position"
        className="min-w-[3.5rem] text-center font-mono text-[0.7em] tabular-nums text-muted-foreground"
      >
        {t('books.record.queuePosition', { n: position, total })}
      </span>
      <button
        type="button"
        data-testid="queue-next"
        onClick={onNext}
        disabled={position >= total}
        aria-label={t('books.record.nextAwaiting')}
        className={btn}
      >
        <ChevronRight className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} />
      </button>
    </div>
  )
}
