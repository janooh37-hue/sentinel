import { useContext } from 'react'
import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccountMenu } from '@/components/shell/AccountMenu'
import { NavBellPopover } from '@/components/shell/NavBellPopover'
import { AuthContext } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'

interface MobileTopBarProps {
  onBurger: () => void
  /** Receives the menu button, so the drawer can hand focus back to it by reference (see NavDrawer). */
  menuButtonRef?: React.Ref<HTMLButtonElement>
  onLock: () => void
  onOpenSettings?: () => void
  onSignOut?: () => void
}

export function MobileTopBar({
  onBurger,
  onLock,
  menuButtonRef,
  onOpenSettings,
  onSignOut,
}: MobileTopBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const user = useContext(AuthContext)?.user ?? null
  const isInmateReporter = user?.role === 'inmate_reporter'
  const { has } = useCapabilities()
  return (
    <header
      // `relative`: the account / notifications panels are positioned against this header (see headerPopover.ts).
      // Inline padding clears the notch in landscape; env() insets are physical, so the larger one is used on
      // both sides, which keeps the bar symmetric and direction-agnostic.
      // Vertical padding: 0.75rem of breathing room above and below the 44px controls, on top of the status-bar
      // / notch inset. The phone popover height cap (headerPopover.ts) mirrors this arithmetic: change both together.
      // Below 180 CSS px (a 360px phone at 200% browser zoom) the gaps and side padding collapse so three 44px
      // targets still fit instead of widening the page.
      // No `md:hidden`: App renders this bar from a px query (useIsMobile, 767px), and `md` is 48rem, which moves with
      // the BROWSER's default font size (576px at 12px): the bar must not hide itself on the strength of another breakpoint.
      className="relative flex items-center gap-2 border-b border-white/10 bg-primary px-[max(1rem,var(--safe-left),var(--safe-right))] pb-3 pt-[calc(var(--safe-top)+0.75rem)] text-primary-foreground max-[180px]:gap-0 max-[180px]:px-[max(0.25rem,var(--safe-left),var(--safe-right))] [&_button:hover]:bg-white/10"
    >
      {/* Targets are 44 CSS px, not rem: they must stay 44px at any text size, and three rem-scaled targets
          (66px at Aa24, 88px at 200% root text) pushed the avatar off a 320px screen. */}
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onBurger}
        aria-label={t('nav.menu')}
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-primary-foreground"
      >
        <Menu className="h-[24px] w-[24px]" strokeWidth={1.8} aria-hidden />
      </button>
      {/* Brand takes whatever the controls leave. The logo is a fixed 32px circle (never squeezed: `max-w-none`
          defeats preflight's `max-width:100%`, which collapsed it to a sliver inside a narrow container) and
          only shows when its container can hold it; the wordmark needs a wider container still. So a cramped
          row sheds the wordmark, then the logo, instead of pushing the controls off-screen. */}
      <div className="@container flex min-w-0 flex-1 items-center gap-3">
        <img
          src="/brand/gssg-logo.png"
          alt="GSSG"
          className="hidden aspect-square h-[32px] w-[32px] max-w-none shrink-0 rounded-full object-cover ring-1 ring-white/25 @[32px]:block"
        />
        <span className="hidden text-[1.05em] font-bold leading-none tracking-tight text-primary-foreground @[6.5rem]:inline">
          GSSG
        </span>
      </div>
      {/* Bell and avatar triggers are real 44px targets with no padding of their own (their padding is rem and
          would grow the box at large text) and `leading-none`, so the bell glyph's line box (1.05em of a 32px
          root is taller than 44px) cannot stretch the header and break the popover height cap's arithmetic. The
          direct-child selector (wrapper div > button) leaves the buttons inside their panels alone, and the
          desktop TopNav does not render this bar. */}
      <div className="flex shrink-0 items-center gap-1.5 max-[180px]:gap-0 [&>div>button]:flex [&>div>button]:min-h-[44px] [&>div>button]:min-w-[44px] [&>div>button]:items-center [&>div>button]:justify-center [&>div>button]:p-0 [&>div>button]:leading-none">
        {!isInmateReporter ? <NavBellPopover phone /> : null}
        <AccountMenu
          phone
          onLock={onLock}
          onOpenSettings={!isInmateReporter && has('settings.view') ? onOpenSettings : undefined}
          onSignOut={onSignOut}
        />
      </div>
    </header>
  )
}
