/**
 * The scan-back queue's entry point — it lives in the Records header, not the
 * top nav (the queue is a Records chore, not a seventh destination).
 *
 * Always rendered for `books.manage` holders, badge only when something is
 * stranded: it's a place, so it must not vanish when the queue is empty.
 */
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'

import { useScanBack } from './useScanBack'

export function ScanBackEntry({ compact = false }: { compact?: boolean }): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { count, enabled } = useScanBack()

  if (!enabled) return null

  return (
    <button
      type="button"
      onClick={() => navigate('/scan-back')}
      // Compact (mobile) drops the label, not the count — three labelled
      // buttons don't fit a phone header next to the title block.
      aria-label={compact ? t('nav.scanBack') : undefined}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-2 text-[0.85em] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Printer className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      {!compact && t('nav.scanBack')}
      {count > 0 && (
        <span className="rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[0.8em] font-bold tabular-nums text-accent">
          {count}
        </span>
      )}
    </button>
  )
}
