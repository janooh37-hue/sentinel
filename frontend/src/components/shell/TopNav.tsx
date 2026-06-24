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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { AccountMenu } from '@/components/shell/AccountMenu'
import { api } from '@/lib/api'
import type { Theme } from '@/lib/api'
import { migrateLegacyFontScale, persistFontScale, persistTheme } from '@/lib/theme'

import { AaSlider } from './AaSlider'
import { IntakeLauncher } from '@/components/intake/IntakeLauncher'
import { LanguageToggle } from './LanguageToggle'
import { EmailBasketTray } from './EmailBasketTray'
import { NavBellPopover } from './NavBellPopover'
import { NAV_ITEMS } from './navItems'
import { ThemeToggle } from './ThemeToggle'

interface TopNavProps {
  onLock: () => void
  onOpenSettings?: () => void
  onSignOut?: () => void
}

export function TopNav({ onLock, onOpenSettings, onSignOut }: TopNavProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  })
  const update = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  const fontScale = migrateLegacyFontScale(settings?.font_scale)
  const theme = (settings?.theme ?? 'light') as Theme

  // Keep the document attributes in sync with server-side settings on every
  // mount, so navigating to a fresh route doesn't lose the theme/font-scale
  // applied by the operator on a previous page. `persistTheme` also writes to
  // localStorage so the no-flash bootstrap in main.tsx sees the latest value.
  useEffect(() => {
    if (settings?.theme) persistTheme(settings.theme as Theme)
  }, [settings?.theme])
  useEffect(() => {
    if (typeof settings?.font_scale === 'number') persistFontScale(settings.font_scale)
  }, [settings?.font_scale])

  return (
    <header
      data-topnav
      className="flex items-center gap-7 border-b border-border bg-surface px-8 py-3.5"
    >
      <NavLink
        to="/"
        end
        aria-label={t('nav.dashboard')}
        className="flex items-center gap-7 rounded-md transition-transform duration-200 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <img
          src="/brand/gssg-logo.png"
          alt="GSSG"
          className="h-10 w-10 rounded-full object-cover ring-1 ring-border"
        />
        <div className="text-[1.15em] font-bold leading-tight tracking-tight text-primary">
          GSSG
          <span className="mt-0.5 block text-[0.72em] font-normal tracking-wider text-muted-foreground">
            {t('branding.tagline')}
          </span>
        </div>
      </NavLink>
      <nav className="ms-5 flex gap-1 text-[0.95em]">
        {NAV_ITEMS.map(({ to, key }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `relative rounded-lg px-3.5 py-2 font-medium transition-all duration-200 motion-reduce:!transition-none ${
                isActive
                  ? 'font-semibold text-primary after:absolute after:-bottom-[14px] after:left-0 after:right-0 after:h-[3px] after:rounded after:bg-primary'
                  : 'text-foreground hover:-translate-y-0.5 hover:bg-surface-tinted hover:text-primary motion-reduce:!transform-none'
              }`
            }
          >
            {t(key)}
          </NavLink>
        ))}
      </nav>
      <div className="ms-auto flex shrink-0 items-center gap-3.5">
        <AaSlider
          value={fontScale}
          onChange={(v) => {
            persistFontScale(v)
            update.mutate({ font_scale: v })
          }}
        />
        <LanguageToggle />
        <ThemeToggle
          value={theme}
          onChange={(v) => {
            persistTheme(v)
            update.mutate({ theme: v })
          }}
        />
        <IntakeLauncher />
        <EmailBasketTray />
        <NavBellPopover />
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t('nav.settings')}
          title={t('nav.settings')}
          className="rounded-lg p-2 text-foreground transition-colors hover:bg-surface-tinted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <Settings className="h-[1.15em] w-[1.15em]" strokeWidth={1.8} aria-hidden />
        </button>
        <AccountMenu onLock={onLock} onOpenSettings={onOpenSettings} onSignOut={onSignOut} />
      </div>
    </header>
  )
}
