import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { AssetsSectionTabs } from '../AssetsSectionTabs'

export type UniformTab = 'stock' | 'received' | 'returns'

interface Props {
  tab: UniformTab
  /** Only expose destinations after their body is integrated by its owning ticket. */
  tabs?: readonly UniformTab[]
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}

/** Uniform keeps the Store hero, gutters and controls, with query-driven sub-tabs. */
export function UniformShell({ tab, tabs = ['stock'], description, actions, children }: Props): React.JSX.Element {
  const { t } = useTranslation()
  return <div className="flex flex-1 flex-col overflow-auto bg-background">
    <section className="shrink-0 pt-4 text-white" style={{ background: 'var(--hero-grad)' }}>
      <div className="mx-auto max-w-[1400px] px-4 pb-3 md:px-8">
        <p className="text-[0.72em] font-semibold uppercase tracking-[0.14em] text-white/70 rtl:tracking-normal">{t('assets.title')}</p>
        <p className="mt-0.5 text-[0.84em] text-white/80">{t('assets.uniform.tagline')}</p>
      </div>
      <AssetsSectionTabs />
    </section>
    <nav aria-label={t('assets.uniform.pages')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 md:px-6">
      {tabs.map(value => <Link key={value} to={`?tab=${value}`} aria-current={tab === value ? 'page' : undefined}
        className={cn('inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-[0.86em] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-safe:transition-colors', tab === value ? 'border-primary font-semibold text-primary-text' : 'border-transparent text-muted-foreground hover:text-foreground')}>
        {t(`assets.uniform.${value === 'stock' ? 'tabStock' : value === 'received' ? 'tabReceived' : 'tabReturns'}`)}
      </Link>)}
    </nav>
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-4 pb-4 pt-4 md:px-6">
      <div className="min-w-0"><h1 id="uniform-title" tabIndex={-1} className="text-xl font-bold tracking-tight text-foreground outline-none md:text-[1.55em] rtl:tracking-normal">{t('assets.uniform.title')}</h1>
        {description && <p className="mt-1 text-[0.84em] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
    <div className="flex shrink-0 flex-col gap-4 px-4 pb-8 md:px-6">{children}</div>
  </div>
}
