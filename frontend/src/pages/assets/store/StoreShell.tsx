/**
 * StoreShell — the frame every Store page renders inside: the navy hero band
 * (section title + Assets tabs), the Store sub-tab bar, then the page header
 * (title, description, actions) and the page body.
 *
 * Each page wraps itself rather than nesting under a layout route, so every
 * route keeps its own lazy loader and capability gate in `App.tsx`.
 */

import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'

import { AssetsSectionTabs } from '../AssetsSectionTabs'

const STORE_TABS = [
  { to: '/holdings/store', key: 'dashboard', end: true },
  { to: '/holdings/store/movements', key: 'movements', end: false },
  { to: '/holdings/store/items', key: 'items', end: false },
  { to: '/holdings/store/deliveries', key: 'deliveries', end: false },
  { to: '/holdings/store/counts', key: 'counts', end: false },
  { to: '/holdings/store/disposals', key: 'disposals', end: false },
] as const

function subTabClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-[0.86em] font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
    isActive
      ? 'border-primary font-semibold text-primary'
      : 'border-transparent text-muted-foreground hover:text-foreground',
  )
}

export function StoreSubTabs(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('assets.store.tabs.aria')}
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 md:px-6"
    >
      {STORE_TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={subTabClass}>
          {t(`assets.store.tabs.${tab.key}`)}
        </NavLink>
      ))}
    </nav>
  )
}

interface StoreShellProps {
  title: string
  description?: string
  /** Header actions (end-aligned); pass nothing when the user cannot write. */
  actions?: React.ReactNode
  children: React.ReactNode
}

export function StoreShell({
  title,
  description,
  actions,
  children,
}: StoreShellProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <section className="shrink-0 pt-4 text-white" style={{ background: 'var(--hero-grad)' }}>
        <div className="mx-auto max-w-[1400px] px-4 pb-3 md:px-8">
          <p className="text-[0.72em] font-semibold uppercase tracking-[0.14em] rtl:tracking-normal text-white/70">
            {t('assets.title')}
          </p>
          <p className="mt-0.5 text-[0.84em] text-white/80">{t('assets.store.tagline')}</p>
        </div>
        <AssetsSectionTabs />
      </section>

      <StoreSubTabs />

      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-4 pb-2 pt-4 md:px-6">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight rtl:tracking-normal text-foreground md:text-[1.55em]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-[0.84em] text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>

      <div className="flex shrink-0 flex-col gap-4 px-4 pb-8 md:px-6">{children}</div>
    </div>
  )
}
