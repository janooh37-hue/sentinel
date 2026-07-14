/**
 * GatewayIndicator — always-visible WhatsApp session dot in the TopNav right
 * cluster. Awareness only: click navigates to /messages/broadcast where the
 * banner / QR dialog / unlink live. Renders nothing when the feature is dormant
 * (disabled) or the user lacks messages.broadcast (hook disabled → no data).
 */
import { MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

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
  const { data, isLoading, dataUpdatedAt } = useGatewayStatus({ poll: true })
  const state = data?.state as GatewayState | undefined

  // Dormant, loading, or no access → render nothing (zero chrome).
  if (isLoading || !state || state === 'disabled') return null

  const label = t(`gateway.indicator.${state}`)
  const title = `${label} · ${t('gateway.indicator.checkedAgo', { count: secsSince(dataUpdatedAt) })}`

  return (
    <NavLink
      to="/messages/broadcast"
      aria-label={label}
      title={title}
      className="relative rounded-lg p-2 text-foreground transition-colors hover:bg-surface-tinted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      <MessageCircle className="h-[1.15em] w-[1.15em]" strokeWidth={1.8} aria-hidden />
      <span
        data-state={state}
        aria-hidden
        className={`absolute bottom-1 end-1 h-2 w-2 rounded-full ring-2 ring-surface ${DOT[state]}`}
      />
    </NavLink>
  )
}
