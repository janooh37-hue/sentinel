/**
 * GatewayIndicator — WhatsApp session dot + dropdown in the TopNav right cluster.
 * The trigger shows a live 4-state status dot; clicking opens a popover with the
 * connection status and a "Send to Group" link (the page's sole nav entry point).
 * Renders nothing when dormant (disabled) or the user lacks messages.broadcast.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Megaphone, MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useGatewayStatus, type GatewayState } from '@/lib/useGatewayStatus'

const DOT: Record<Exclude<GatewayState, 'disabled'>, string> = {
  connected: 'bg-green-500',
  disconnected: 'bg-amber-500 motion-safe:animate-pulse',
  unreachable: 'bg-red-500',
}

/** Plain helper — `Date.now()` is allowed outside component/hook scope. */
function secsSince(ms: number): number {
  return Math.max(0, Math.round((Date.now() - ms) / 1000))
}

export function GatewayIndicator(): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const { data, isLoading, dataUpdatedAt } = useGatewayStatus({ poll: true })
  const state = data?.state as GatewayState | undefined

  // Outside-click / Escape — mirrors NavBellPopover.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
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

  // Focus into the panel on open; restore to the trigger on close.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null
      panelRef.current?.focus()
    } else if (triggerRef.current) {
      triggerRef.current.focus()
      triggerRef.current = null
    }
  }, [open])

  // Dormant, loading, or no access → render nothing (zero chrome).
  if (isLoading || !state || state === 'disabled') return null

  const label = t(`gateway.indicator.${state}`)
  const checked = t('gateway.indicator.checkedAgo', { count: secsSince(dataUpdatedAt) })

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('gateway.indicator.menuLabel')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${label} · ${checked}`}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-foreground transition-colors hover:bg-surface-tinted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <MessageCircle className="h-[1.15em] w-[1.15em]" strokeWidth={1.8} aria-hidden />
        <span
          data-state={state}
          aria-hidden
          className={`absolute bottom-1 end-1 h-2 w-2 rounded-full ring-2 ring-surface ${DOT[state]}`}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          tabIndex={-1}
          aria-label={t('gateway.indicator.menuLabel')}
          className="anim-pop-in anim-pop-in-end absolute end-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] max-w-[280px] overflow-hidden rounded-2xl border border-hairline bg-surface shadow-xl focus-visible:outline-none"
        >
          {/* Status header */}
          <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
            <span
              data-state={state}
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[state]}`}
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[0.85em] font-semibold text-foreground">{label}</span>
              <span className="text-[0.72em] text-muted-foreground">{checked}</span>
            </div>
          </div>

          {/* Send to Group link */}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              navigate('/messages/broadcast')
            }}
            className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Megaphone className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden />
            <span className="flex-1 text-[0.9em] font-medium text-foreground">
              {t('nav.sendToGroup')}
            </span>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180"
              strokeWidth={1.8}
              aria-hidden
            />
          </button>
        </div>
      )}
    </div>
  )
}
