/**
 * Banner shown above a record's document while a Word edit session is active:
 * the preview is the last SAVED version, not the live Word edits. The optional
 * toggle swaps the desk between the saved PDF and the live draft; it renders
 * only when the host supplies `onToggleLive`.
 */
import { Eye, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BookRead } from '@/lib/api'
import { parseUtcMs } from '@/lib/time'
import { cn } from '@/lib/utils'

export function WordSessionBanner({
  book,
  compact = false,
  live,
  onToggleLive,
}: {
  book: Pick<BookRead, 'edit_session' | 'voided_at'>
  /** pane variant: smaller, explanation only (the status line already names the editor) */
  compact?: boolean
  /** the live draft is currently shown instead of the saved version */
  live: boolean
  onToggleLive?: () => void
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const session = book.edit_session
  if (book.voided_at || session?.state !== 'active') return null

  const savedAt = parseUtcMs(session.last_put_at ?? session.created_at)
  // LTR isolates keep "14:20" from reordering inside Arabic text.
  const time = Number.isNaN(savedAt)
    ? ''
    : `\u2066${new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(savedAt)}\u2069`

  return (
    <div
      role="note"
      dir={i18n.dir()}
      className={cn(
        'flex items-center gap-2.5 border border-warning/30 bg-warning-soft text-warning',
        compact ? 'rounded-[10px] px-2.5 py-2 text-[0.72em]' : 'rounded-xl px-3.5 py-2.5 text-[0.8em]',
      )}
    >
      <FileText className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {!compact && (
          <b className="block">
            {t('books.status.wordActive', { name: session.user_name ?? '' })}
          </b>
        )}
        {t('books.paper.wordBanner', { t: time })}
      </span>
      {onToggleLive && (
        <button
          type="button"
          aria-pressed={live}
          onClick={onToggleLive}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-warning/40 bg-surface px-2.5 text-[0.95em] font-semibold text-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
          {live ? t('books.paper.showSaved') : t('books.paper.showLive')}
        </button>
      )}
    </div>
  )
}
