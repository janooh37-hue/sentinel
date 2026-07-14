import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { NAV_ITEMS } from './navItems'

// Leaves stays in TopNav (desktop) and the NavDrawer (mobile), but is dropped
// from the bottom bar to keep it at 5 evenly-spaced, touch-sized tabs.
// Capability-gated items (cap field set) are also excluded from the bottom bar
// to prevent overflow and avoid conditional hooks; they appear in NavDrawer only.
const BOTTOM_TAB_ITEMS = NAV_ITEMS.filter((item) => item.to !== '/leaves' && !item.cap)

export function BottomTabBar(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      {BOTTOM_TAB_ITEMS.map(({ to, key, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[0.7rem] font-medium leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${isActive ? 'text-primary' : 'text-muted-foreground'}`
          }
        >
          <Icon className="h-5 w-5 shrink-0" strokeWidth={1.8} aria-hidden />
          <span className="line-clamp-2 w-full text-center [overflow-wrap:anywhere]">{t(key)}</span>
        </NavLink>
      ))}
    </nav>
  )
}
