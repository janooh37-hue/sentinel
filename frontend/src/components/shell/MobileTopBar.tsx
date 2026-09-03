import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccountMenu } from '@/components/shell/AccountMenu'
import { NavBellPopover } from '@/components/shell/NavBellPopover'
import { useCapabilities } from '@/lib/useCapabilities'

interface MobileTopBarProps {
  onBurger: () => void
  onLock: () => void
  onOpenSettings?: () => void
  onSignOut?: () => void
}

export function MobileTopBar({
  onBurger,
  onLock,
  onOpenSettings,
  onSignOut,
}: MobileTopBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  return (
    <header className="flex items-center gap-3 border-b border-white/10 bg-primary px-4 pb-2 pt-[calc(var(--safe-top)+0.5rem)] text-primary-foreground [&_button:hover]:bg-white/10 md:hidden">
      <button
        type="button"
        onClick={onBurger}
        aria-label={t('nav.menu')}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-primary-foreground"
      >
        <Menu className="h-6 w-6" strokeWidth={1.8} aria-hidden />
      </button>
      <img
        src="/brand/gssg-logo.png"
        alt="GSSG"
        className="h-8 w-8 rounded-full object-cover ring-1 ring-white/25"
      />
      <span className="text-[1.05em] font-bold tracking-tight text-primary-foreground">GSSG</span>
      <div className="ms-auto flex items-center gap-1.5">
        <NavBellPopover />
        <AccountMenu
          onLock={onLock}
          onOpenSettings={has('settings.view') ? onOpenSettings : undefined}
          onSignOut={onSignOut}
        />
      </div>
    </header>
  )
}
