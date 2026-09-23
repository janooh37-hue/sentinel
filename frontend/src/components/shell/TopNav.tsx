/**
 * TopNav — TAMM-style top chrome that replaces the legacy left Sidebar and
 * top AppBar. Five primary nav items powered by react-router, plus a
 * right cluster of operator-level utilities (font scale, language, theme,
 * notifications, account menu).
 *
 * Settings flow through TanStack Query just like every other consumer:
 * read the AppSettings, write back through `api.updateSettings`, and let
 * the rest of the app react to the cache invalidation.
 */

import { Settings } from 'lucide-react'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { AccountMenu } from '@/components/shell/AccountMenu'
import { IntakeLauncher } from '@/components/intake/IntakeLauncher'
import { AuthContext } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'
import { prefetchRouteForPath } from '@/lib/prefetchRoute'

import { AaSlider } from './AaSlider'
import { EmailBasketTray } from './EmailBasketTray'
import { GatewayIndicator } from './GatewayIndicator'
import { LanguageToggle } from './LanguageToggle'
import { NavBellPopover } from './NavBellPopover'
import { INMATE_REPORTER_ALLOWED_DESTINATIONS, NAV_ITEMS } from './navItems'
import { isNavEntryAllowed } from './navCustomization'
import { ThemeToggle } from './ThemeToggle'
import { useChromePrefs } from './useChromePrefs'

interface TopNavProps {
  onLock: () => void
  onOpenSettings?: () => void
  onSignOut?: () => void
}

export function TopNav({ onLock, onOpenSettings, onSignOut }: TopNavProps): React.JSX.Element {
  const { t } = useTranslation()
  const user = useContext(AuthContext)?.user ?? null
  const { has } = useCapabilities()
  const isInmateReporter = user?.role === 'inmate_reporter'
  const { fontScale, theme, setFontScale, setTheme } = useChromePrefs(isInmateReporter)
  const navItems = isInmateReporter
    ? NAV_ITEMS.filter(({ to }) => INMATE_REPORTER_ALLOWED_DESTINATIONS.includes(to as typeof INMATE_REPORTER_ALLOWED_DESTINATIONS[number]))
    : NAV_ITEMS

  return (
    <header
      data-topnav
      className="flex flex-nowrap items-center gap-7 border-b border-border bg-surface px-8 py-3.5"
    >
      <NavLink
        to="/"
        end
        aria-label={t('nav.dashboard')}
        onPointerEnter={() => prefetchRouteForPath('/')}
        onFocus={() => prefetchRouteForPath('/')}
        className="flex items-center gap-7 rounded-md transition-transform duration-200 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <img
          src="/brand/gssg-logo.png"
          alt="GSSG"
          className="h-10 w-10 rounded-full object-cover ring-1 ring-border"
        />
        <div className="topnav-brand-copy text-[1.15em] font-bold leading-tight tracking-tight text-primary">
          GSSG
          <span className="mt-0.5 block whitespace-nowrap text-[0.72em] font-normal tracking-wider text-muted-foreground">
            {t('branding.tagline')}
          </span>
        </div>
      </NavLink>
      <nav
        aria-label={t('nav.menu')}
        className="topnav-destinations ms-5 flex min-w-0 gap-1 text-[0.95em]"
      >
        {navItems.filter((item) => isNavEntryAllowed(item, has)).map(({ to, key, Icon }) => {
          const labelKey = isInmateReporter && to === '/application' ? 'nav.inmateReport' : key
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={t(labelKey)}
              aria-label={t(labelKey)}
              onPointerEnter={() => prefetchRouteForPath(to)}
              onFocus={() => prefetchRouteForPath(to)}
              className={({ isActive }) =>
                `topnav-link relative flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 font-medium transition-all duration-200 motion-reduce:!transition-none ${
                  isActive
                    ? 'font-semibold text-primary after:absolute after:-bottom-[14px] after:left-0 after:right-0 after:h-[3px] after:rounded after:bg-primary'
                    : 'text-foreground hover:-translate-y-0.5 hover:bg-surface-tinted hover:text-primary motion-reduce:!transform-none'
                }`
              }
            >
              {/* Kept in the DOM at every width; CSS reveals it only in the
                  collapsed tier, where the label is hidden. */}
              <Icon className="topnav-link-icon h-[1.15em] w-[1.15em] shrink-0" strokeWidth={1.8} aria-hidden />
              <span className="topnav-link-label whitespace-nowrap">{t(labelKey)}</span>
            </NavLink>
          )
        })}
      </nav>
      <div className="topnav-utilities ms-auto flex shrink-0 items-center gap-3.5">
        <AaSlider
          value={fontScale}
          onChange={setFontScale}
        />
        <LanguageToggle />
        <ThemeToggle value={theme} onChange={setTheme} />
        {!isInmateReporter ? (
          <>
            <IntakeLauncher />
            <EmailBasketTray />
            <GatewayIndicator />
            <NavBellPopover />
          </>
        ) : null}
        {!isInmateReporter && has('settings.view') ? (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t('nav.settings')}
            title={t('nav.settings')}
            className="rounded-lg p-2 text-foreground transition-colors hover:bg-surface-tinted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <Settings className="h-[1.15em] w-[1.15em]" strokeWidth={1.8} aria-hidden />
          </button>
        ) : null}
        <AccountMenu
          onLock={onLock}
          onOpenSettings={!isInmateReporter && has('settings.view') ? onOpenSettings : undefined}
          onSignOut={onSignOut}
        />
      </div>
    </header>
  )
}
