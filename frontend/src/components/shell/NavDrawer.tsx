/**
 * NavDrawer — mobile slide-in navigation panel.
 *
 * Slides in from the inline-start edge (respects RTL). Contains:
 *   - Brand block
 *   - 5 primary nav links (same routes as TopNav's NAV_ITEMS)
 *   - Secondary links: Settings, and admin-only Access requests
 *   - Chrome controls: AaSlider, LanguageToggle, ThemeToggle
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings, ShieldCheck, X } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { api } from '@/lib/api'
import type { Theme } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { migrateLegacyFontScale, persistFontScale, persistTheme } from '@/lib/theme'

import { AaSlider } from './AaSlider'
import { LanguageToggle } from './LanguageToggle'
import { NAV_ITEMS } from './navItems'
import { ThemeToggle } from './ThemeToggle'

interface NavDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NavDrawer({ open, onOpenChange }: NavDrawerProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { has } = useCapabilities()

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

  useEffect(() => {
    if (settings?.theme) persistTheme(settings.theme as Theme)
  }, [settings?.theme])
  useEffect(() => {
    if (typeof settings?.font_scale === 'number') persistFontScale(settings.font_scale)
  }, [settings?.font_scale])

  const close = (): void => onOpenChange(false)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-label={t('nav.menu')}>
        <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
        {/* Header: brand + close */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img
              src="/brand/gssg-logo.png"
              alt="GSSG"
              className="h-9 w-9 rounded-full object-cover ring-1 ring-border"
            />
            <span className="text-[1.05em] font-bold tracking-tight text-primary">GSSG</span>
          </div>
          <SheetClose
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <X className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          </SheetClose>
        </div>

        {/* Primary nav */}
        <nav className="flex flex-col gap-0.5 px-3 py-3">
          {NAV_ITEMS.filter((item) => !item.cap || has(item.cap)).map(({ to, key, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={close}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.95em] font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-surface-tinted hover:text-primary'
                }`
              }
            >
              <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} aria-hidden />
              {t(key)}
            </NavLink>
          ))}
        </nav>

        {/* Secondary links */}
        <div className="flex flex-col gap-0.5 border-t border-border px-3 py-3">
          <NavLink
            to="/settings"
            onClick={close}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.95em] font-medium transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-surface-tinted hover:text-primary'
              }`
            }
          >
            <Settings className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} aria-hidden />
            {t('nav.settings')}
          </NavLink>
          {has('users.manage') && (
            <NavLink
              to="/access-requests"
              onClick={close}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.95em] font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-surface-tinted hover:text-primary'
                }`
              }
            >
              <ShieldCheck className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} aria-hidden />
              {t('access.title')}
            </NavLink>
          )}
        </div>

        {/* Chrome controls at the bottom */}
        <div className="mt-auto flex flex-col gap-4 border-t border-border px-4 py-4">
          <AaSlider
            value={fontScale}
            onChange={(v) => {
              persistFontScale(v)
              update.mutate({ font_scale: v })
            }}
          />
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <ThemeToggle
              value={theme}
              onChange={(v) => {
                persistTheme(v)
                update.mutate({ theme: v })
              }}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
