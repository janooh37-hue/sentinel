/**
 * LedgerPaperFrame — the server-rendered Ledger Book paper (draft or issued
 * Revision) in a sandboxed iframe. Same origin so fonts and images load and the
 * parent can print it; no `allow-scripts`, matching the paper's own CSP sandbox.
 */
import { useEffect, useRef, useState } from 'react'
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
  const panel = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    if (!panel.current) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setScale(Math.min(width / 793.7, height / 1122.5))
    })
    observer.observe(panel.current)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={panel} className={cn('flex h-[75vh] min-h-0 w-full items-center justify-center overflow-hidden rounded-lg border border-hairline bg-muted', className)}>
      <div style={{ width: 793.7 * scale, height: 1122.5 * scale }} className="relative shrink-0">
        <iframe
          key={`${src}#${reloadKey ?? ''}`}
          src={src}
          title={t('ledgerBook.composer.paper.title')}
          sandbox="allow-same-origin allow-modals"
          referrerPolicy="same-origin"
          className="absolute inset-0 block max-w-none border-0 bg-white"
          style={{ width: 793.7, height: 1122.5, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      </div>
    </div>
  )
}
