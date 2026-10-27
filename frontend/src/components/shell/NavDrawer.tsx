/**
 * NavDrawer — mobile slide-in navigation panel.
 *
 * Slides in from the inline-start edge (respects RTL). Contains:
 *   - Brand block
 *   - 5 primary nav links (same routes as TopNav's NAV_ITEMS)
 *   - Secondary links: Settings, and admin-only Access requests
 *   - Chrome controls: AaSlider, LanguageToggle, ThemeToggle
 */

import { Bug, Settings, ShieldCheck, X } from 'lucide-react'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { AuthContext } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'
import { prefetchRouteForPath } from '@/lib/prefetchRoute'

import { AaSlider } from './AaSlider'
import { LanguageToggle } from './LanguageToggle'
import { INMATE_REPORTER_ALLOWED_DESTINATIONS, NAV_ITEMS } from './navItems'
import { isNavEntryAllowed } from './navCustomization'
import { ThemeToggle } from './ThemeToggle'
import { useChromePrefs } from './useChromePrefs'

interface NavDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The control that opens the drawer (the phone bar's menu button). The drawer has no Radix trigger, so
   * on close it focuses this element by reference. Reading `document.activeElement` at open time instead
   * would depend on the tap having focused the button, and Safari does not focus a button on touch.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

export function NavDrawer({ open, onOpenChange, returnFocusRef }: NavDrawerProps): React.JSX.Element {
  const { t } = useTranslation()
  const user = useContext(AuthContext)?.user ?? null
  const { has } = useCapabilities()
  const isInmateReporter = user?.role === 'inmate_reporter'
  const { fontScale, theme, setFontScale, setTheme } = useChromePrefs(isInmateReporter)
  const navItems = isInmateReporter
    ? NAV_ITEMS.filter(({ to }) => INMATE_REPORTER_ALLOWED_DESTINATIONS.includes(to as typeof INMATE_REPORTER_ALLOWED_DESTINATIONS[number]))
    : NAV_ITEMS

  const close = (): void => onOpenChange(false)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        aria-label={t('nav.menu')}
        aria-describedby={undefined}
        // Scrolls inside itself (landscape phones are shorter than the drawer), never wider than the screen
        // minus a 48px strip to tap to dismiss (w-72 is 288px at 16px text but 432px at the largest size; the
        // strip is px, not rem, so large text does not eat the screen), and clears the notch on its
        // inline-start side (the env() insets are physical, so the larger is used). scroll-pt/pb keep a control
        // that is scrolled to (focus, scrollIntoView) clear of the status bar and the home indicator, which sit
        // over the drawer's own padding.
        className="@container max-w-[calc(100%-48px)] scroll-pb-[var(--safe-bottom)] scroll-pt-[var(--safe-top)] overflow-y-auto overscroll-contain pt-[var(--safe-top)] pb-[var(--safe-bottom)] ps-[max(var(--safe-left),var(--safe-right))]"
        // Radix's focus trap wraps Tab with focus({ preventScroll: true }), so tabbing from the last control back to
        // Close left Close scrolled out of sight in a drawer that scrolls (landscape phone, large text). Reveal
        // whatever takes focus; the scroll-pt/pb above keep it clear of the status bar and the home indicator.
        // A visually hidden input (the theme switch's 0x0 checkbox) paints nothing: reveal the label that wraps it.
        onFocusCapture={(event) => {
          const target = event.target as HTMLElement
          const box = target.getBoundingClientRect()
          const painted = box.width === 0 || box.height === 0 ? (target.closest('label') ?? target) : target
          painted.scrollIntoView({ block: 'nearest' })
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current
          if (!target) return
          event.preventDefault()
          target.focus()
        }}
      >
        <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
        {/* Header: brand + close */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 @max-[200px]:px-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src="/brand/gssg-logo.png"
              alt="GSSG"
              className="aspect-square h-9 w-9 max-w-none shrink-0 rounded-full object-cover ring-1 ring-border"
            />
            <span className="text-[1.05em] font-bold tracking-tight text-primary @max-[200px]:hidden">GSSG</span>
          </div>
          <SheetClose
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <X className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          </SheetClose>
        </div>

        {/* Primary nav */}
        <nav className="flex flex-col gap-0.5 px-3 py-3 @max-[200px]:px-1.5">
          {navItems.filter((item) => isNavEntryAllowed(item, has)).map(({ to, key, Icon }) => {
            const labelKey = isInmateReporter && to === '/services' ? 'nav.inmateReport' : key
            return (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={close}
                onPointerEnter={() => prefetchRouteForPath(to)}
                onFocus={() => prefetchRouteForPath(to)}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 @max-[200px]:gap-2 @max-[200px]:px-2 text-[0.95em] font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-surface-tinted hover:text-primary'
                  }`
                }
              >
                <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t(labelKey)}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Secondary links */}
        {!isInmateReporter ? (
          <div className="flex flex-col gap-0.5 border-t border-border px-3 py-3 @max-[200px]:px-1.5">
            {has('settings.view') && (
              <NavLink
                to="/settings"
                onClick={close}
                onPointerEnter={() => prefetchRouteForPath('/settings')}
                onFocus={() => prefetchRouteForPath('/settings')}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 @max-[200px]:gap-2 @max-[200px]:px-2 text-[0.95em] font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-surface-tinted hover:text-primary'
                  }`
                }
              >
                <Settings className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t('nav.settings')}</span>
              </NavLink>
            )}
            {has('users.manage') && (
              <NavLink
                to="/access-requests"
                onClick={close}
                onPointerEnter={() => prefetchRouteForPath('/access-requests')}
                onFocus={() => prefetchRouteForPath('/access-requests')}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 @max-[200px]:gap-2 @max-[200px]:px-2 text-[0.95em] font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-surface-tinted hover:text-primary'
                  }`
                }
              >
                <ShieldCheck className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t('access.title')}</span>
              </NavLink>
            )}
            {has('system.admin') && (
              <NavLink
                to="/debug"
                onClick={close}
                onPointerEnter={() => prefetchRouteForPath('/debug')}
                onFocus={() => prefetchRouteForPath('/debug')}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 @max-[200px]:gap-2 @max-[200px]:px-2 text-[0.95em] font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-surface-tinted hover:text-primary'
                  }`
                }
              >
                <Bug className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t('debug.title')}</span>
              </NavLink>
            )}
          </div>
        ) : null}

        {/* Chrome controls at the bottom */}
        <div className="mt-auto flex flex-col gap-4 border-t border-border px-4 py-4 @max-[200px]:px-2">
          <AaSlider value={fontScale} onChange={setFontScale} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <LanguageToggle />
            <ThemeToggle value={theme} onChange={setTheme} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
