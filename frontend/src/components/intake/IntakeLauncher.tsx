/**
 * IntakeLauncher — a "Scan" button (ScanLine icon) + hand-rolled drawer that
 * hosts IntakePanel.
 *
 * Pattern mirrors NavBellPopover: outside-click + Escape close, absolute
 * positioned panel anchored to the trigger button.
 *
 * Wrapped in <CapabilityGate cap="documents.scan"> — renders nothing when the
 * signed-in user lacks the capability or while caps are loading.
 */

import { useEffect, useRef, useState } from 'react'
import { ScanLine, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CapabilityGate } from '@/components/shell/CapabilityGate'
import { IntakePanel } from './IntakePanel'

function LauncherInner(): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Outside-click / Escape — mirrors NavBellPopover / AccountMenu.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('intake.scanButton')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        title={t('intake.scanButton')}
        className="rounded-lg p-2 text-foreground transition-colors hover:bg-surface-tinted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <ScanLine className="h-[1.15em] w-[1.15em]" strokeWidth={1.8} aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('intake.drawerTitle')}
          className="anim-pop-in anim-pop-in-end absolute end-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] max-w-[420px] overflow-hidden rounded-2xl border border-hairline bg-surface shadow-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ScanLine aria-hidden strokeWidth={1.75} className="h-4 w-4 text-muted-foreground" />
              {t('intake.drawerTitle')}
            </h3>
            <button
              type="button"
              aria-label={t('extraction.panel.dismiss')}
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            </button>
          </div>

          {/* Body */}
          <div className="p-4">
            <IntakePanel />
          </div>
        </div>
      )}
    </div>
  )
}

export function IntakeLauncher(): React.JSX.Element {
  return (
    <CapabilityGate cap="documents.scan">
      <LauncherInner />
    </CapabilityGate>
  )
}
