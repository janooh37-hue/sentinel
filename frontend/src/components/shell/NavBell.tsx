/** Notification bell for approvals, leave actions, scan inbox, and scan-back. */

interface Props {
  count?: number
  onClick?: () => void
}

export function NavBell({ count, onClick }: Props): React.JSX.Element {
  const showBadge = typeof count === 'number' && count > 0
  const label = showBadge ? (count > 99 ? '99+' : String(count)) : null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        showBadge ? `Notifications, ${count} unread` : 'Notifications'
      }
      className="relative rounded-lg p-2 transition-colors hover:bg-surface-tinted"
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
