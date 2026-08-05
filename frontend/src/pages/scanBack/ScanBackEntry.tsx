/**
 * The scan-back queue's entry point — a strip inside Records, not a top-nav
 * destination: the queue is a Records chore, and one stranded record is a task
 * line, not a seventh place to go.
 *
 * Only renders when something is actually stranded (and only for the
 * `books.manage` holders who can file a scan), so it reads as work to do
 * rather than permanent furniture.
 *
 * Wording reuses the bell's counted phrase and the queue's own "view all" —
 * no new strings, so no EN/AR parity surface to drift.
 */
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'

import { useScanBack } from './useScanBack'

export function ScanBackEntry(): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { count, enabled } = useScanBack()

  if (!enabled || count === 0) return null

  return (
    <button
      type="button"
      onClick={() => navigate('/scan-back')}
      className="mb-3 flex w-full shrink-0 items-center gap-2.5 rounded-2xl border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-start transition-colors hover:border-warning/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Printer className="h-4 w-4 shrink-0 text-warning" strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[0.82em] font-semibold text-foreground">
        {t('nav.bell.scanBack', { count })}
      </span>
      <span className="shrink-0 text-[0.78em] font-semibold text-warning">
        {t('scanBack.viewAll', { count })}
      </span>
    </button>
  )
}
