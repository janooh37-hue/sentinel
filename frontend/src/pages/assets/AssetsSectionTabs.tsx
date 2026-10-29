/**
 * AssetsSectionTabs — the Assets section switcher, at the foot of the navy
 * band, styled like `EmployeesSectionTabs`. Store is the only tab today; a
 * site-assets tab slots in as another `NavLink` with its own capability gate.
 *
 * Active state comes from `NavLink`: the route *is* the active tab.
 */

import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { useCapabilities } from '@/lib/useCapabilities'

const BASE =
  'inline-flex min-h-11 items-center gap-2 rounded-t-xl px-4 py-2.5 text-[0.84em] font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70'

function tabClass({ isActive }: { isActive: boolean }): string {
  return `${BASE} ${
    isActive ? 'bg-background text-primary' : 'text-white/70 hover:bg-white/10 hover:text-white'
  }`
}

export function AssetsSectionTabs(): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()

  return (
    <nav
      aria-label={t('assets.sectionTabs.aria')}
      className="relative z-[3] mx-auto flex max-w-[1400px] items-end gap-1 px-4 md:px-8"
    >
      {has('store.view') && (
        <NavLink to="/assets/store" className={tabClass}>
          {t('assets.sectionTabs.store')}
        </NavLink>
      )}
    </nav>
  )
}
