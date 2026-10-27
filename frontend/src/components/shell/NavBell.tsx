/**
 * NavBell — TopNav notifications affordance. Renders a numeric badge over
 * the bell when there are unread incoming emails in the ledger. Backed by
 * `GET /api/v1/ledger/unread-count` (polled every 30s in TopNav).
 *
 * - count undefined or 0 → no badge (bell alone)
 * - count > 0 → small accent pill with the number
 * - count > 99   → "99+" instead of the raw number
 *
 * On a coarse pointer the button is a real 44px target (a mouse keeps the compact box).
 */

import { useTranslation } from 'react-i18next'

interface Props {
  count?: number
  onClick?: () => void
  /** Whether the notifications panel this button toggles is open. */
  expanded?: boolean
}

export function NavBell({ count, onClick, expanded }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const showBadge = typeof count === 'number' && count > 0
  const label = showBadge ? (count > 99 ? '99+' : String(count)) : null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={
        showBadge
          ? t('appBar.notificationsUnread', { count, defaultValue: 'Notifications, {{count}} unread' })
          : t('appBar.notifications', { defaultValue: 'Notifications' })
      }
      className="relative rounded-lg p-2 transition-colors hover:bg-surface-tinted pointer-coarse:inline-flex pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px] pointer-coarse:items-center pointer-coarse:justify-center"
    >
      <span className="text-[1.05em]" aria-hidden>🔔</span>
      {showBadge && (
        <span
          aria-hidden
          className="absolute -end-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface"
        >
          {label}
        </span>
      )}
    </button>
  )
}
