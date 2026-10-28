/**
 * LedgerPaperFrame — the server-rendered Ledger Book paper (draft or issued
 * Revision) in a sandboxed iframe. Same origin so fonts and images load and the
 * parent can print it; no `allow-scripts`, matching the paper's own CSP sandbox.
 */
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { ledgerPaperUrl, type LedgerPaperSource } from './ledgerBookKeys'

export function LedgerPaperFrame({ source, reloadKey, className }: {
  source: LedgerPaperSource
  /** Change it to reload the paper (e.g. after a draft autosave). */
  reloadKey?: number | string
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const src = ledgerPaperUrl(source)
  return (
    <iframe
      key={`${src}#${reloadKey ?? ''}`}
      src={src}
      title={t('ledgerBook.composer.paper.title')}
      sandbox="allow-same-origin allow-modals"
      referrerPolicy="same-origin"
      className={cn('block h-full min-h-[70vh] w-full rounded-lg border border-hairline bg-white', className)}
    />
  )
}
