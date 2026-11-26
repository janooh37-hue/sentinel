import { Search } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { NATIVE_SELECT } from '@/components/ui/native-select'
import type { ArmorySafeRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AssetsSectionTabs } from '../AssetsSectionTabs'
import { useArmoryLocale } from './armoryFormat'
import { ARMORY_DETAIL_KEYS, ARMORY_TABS, type ArmoryTab } from './armoryUrl'

const TAB_LABELS = {
  shift: 'shift', items: 'itemsTab', custody: 'custody', guards: 'guardsTab', audit: 'audit',
} as const satisfies Record<ArmoryTab, string>

const PAGE_TITLES = {
  shift: 'shiftDesk', items: 'catalogueTitle', custody: 'custodyLedger', guards: 'guards', audit: 'audit',
} as const satisfies Record<ArmoryTab, string>

interface Props {
  tab: ArmoryTab
  params: URLSearchParams
  safes: ArmorySafeRead[]
  safeId: number | null
  onScopeChange(safeId: number | null): void
  onFind(): void
  findButtonRef: RefObject<HTMLButtonElement | null>
  scopeRef: RefObject<HTMLSelectElement | null>
  status: string | null
  actions?: ReactNode
  children: ReactNode
}

export function ArmoryShell({ tab, params, safes, safeId, onScopeChange, onFind, findButtonRef, scopeRef, status, actions, children }: Props): React.JSX.Element {
  const { t, name } = useArmoryLocale()
  const next = new URLSearchParams(params)
  for (const key of ARMORY_DETAIL_KEYS) next.delete(key)
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto bg-background">
      <section className="shrink-0 pt-4 text-white print:hidden" style={{ background: 'var(--hero-grad)' }}>
        <div className="mx-auto max-w-[1400px] px-4 pb-3 md:px-8">
          <p className="text-[0.72em] font-semibold uppercase tracking-[0.14em] text-white/70 rtl:tracking-normal">{t('assets.title')}</p>
          <p className="mt-0.5 text-[0.84em] text-white/80">{t('assets.armory.tagline')}</p>
        </div>
        <AssetsSectionTabs />
      </section>

      <div className="shrink-0 border-b border-border bg-surface print:hidden">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-4 px-4 md:px-8">
          <nav aria-label={t('assets.armory.armoryPages')} className="grid w-full grid-cols-5 sm:w-auto sm:gap-1">
            {ARMORY_TABS.map(value => {
              const active = value === tab
              if (!active) next.set('tab', value)
              const search = active ? params.toString() : next.toString()
              return (
                <Link
                  key={value}
                  to={{ search: search ? `?${search}` : '' }}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 min-w-0 items-center justify-center px-0.5 text-center text-[0.82em] leading-snug motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-3',
                    active ? 'font-semibold text-primary-text shadow-[inset_0_-2px_0_var(--primary)]' : 'font-medium text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">{t(`assets.armory.${TAB_LABELS[value]}`)}</span>
                </Link>
              )
            })}
          </nav>
          {safes.length > 0 && (
            <Button ref={findButtonRef} type="button" variant="secondary" aria-keyshortcuts="/" className="my-2 min-h-11 gap-2" onClick={onFind}>
              <Search className="size-4" aria-hidden />
              {t('assets.armory.find')}
              <kbd dir="ltr" aria-hidden className="ms-2 hidden rounded border border-border px-1.5 text-xs text-muted-foreground md:inline">/</kbd>
            </Button>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1400px] px-4 pb-8 md:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 py-4 md:py-5 print:hidden">
          <div className="min-w-0 space-y-2">
            <h1 id="armory-title" tabIndex={-1} className="text-xl font-bold tracking-tight text-foreground md:text-[1.55em] rtl:tracking-normal">
              {t(`assets.armory.${PAGE_TITLES[tab]}`)}
            </h1>
            {safes.length > 0 && (
              <select
                ref={scopeRef}
                value={safeId ?? 'all'}
                aria-label={t('assets.armory.scopeLabel')}
                className={`${NATIVE_SELECT} min-h-11 max-w-full`}
                onChange={event => onScopeChange(event.target.value === 'all' ? null : Number(event.target.value))}
              >
                <option value="all">{t('assets.armory.allSafes')}</option>
                {safes.map(safe => <option key={safe.id} value={safe.id} dir="auto">{name(safe)}</option>)}
              </select>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
        <div role="status" aria-live="polite" className={cn('print:hidden', status && 'rounded-md bg-surface-tinted px-3 py-2 text-sm text-foreground')}>
          {status}
        </div>
        <div className={cn('flex min-w-0 flex-col gap-4', status && 'mt-3')}>{children}</div>
      </div>
    </div>
  )
}
