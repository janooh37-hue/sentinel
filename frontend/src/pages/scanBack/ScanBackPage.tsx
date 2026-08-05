/**
 * /scan-back — every record whose signed copy never came back.
 *
 * Grouped by age so a 40-day item cannot hide behind a 5-day one. Reached from
 * the sidebar, the daily gate, and the dock.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { BookRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Printer } from 'lucide-react'
import { cn } from '@/lib/utils'

import { ScanBackRow } from './ScanBackRow'
import { ageDays, ageGroup, useFileSignedCopy, useScanBack, type AgeGroup } from './useScanBack'

const GROUPS: readonly AgeGroup[] = ['overMonth', 'weeks', 'recent']

export function ScanBackPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [newestFirst, setNewestFirst] = useState(false)
  const { books, isLoading } = useScanBack(scope)
  const { file, busy } = useFileSignedCopy()

  const sorted = [...books].sort((a, b) =>
    newestFirst
      ? ageDays(a.created_at) - ageDays(b.created_at)
      : ageDays(b.created_at) - ageDays(a.created_at),
  )
  const inGroup = (g: AgeGroup): BookRead[] =>
    sorted.filter((b) => ageGroup(ageDays(b.created_at)) === g)

  const chip = (on: boolean): string =>
    cn(
      'rounded-full border px-3 py-1 text-[0.74em] transition-colors',
      on
        ? 'border-primary bg-primary font-semibold text-primary-foreground'
        : 'border-border bg-surface text-muted-foreground hover:border-border-strong',
    )

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-b border-border bg-surface px-6 py-5">
        <h1 className="flex items-center gap-3 text-[1.15em] font-bold tracking-tight">
          {t('scanBack.title')}
          {books.length > 0 && (
            <span className="rounded-full bg-accent-soft px-2 py-1 font-mono text-[0.62em] font-bold text-accent">
              {books.length}
            </span>
          )}
        </h1>
        <p className="mt-1 text-[0.82em] text-muted-foreground">{t('scanBack.blurb')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={chip(scope === 'mine')} onClick={() => setScope('mine')}>
            {t('scanBack.scope.mine')}
          </button>
          {has('books.manage') && (
            <button type="button" className={chip(scope === 'all')} onClick={() => setScope('all')}>
              {t('scanBack.scope.all')}
            </button>
          )}
          <button
            type="button"
            className={chip(false)}
            onClick={() => setNewestFirst((v) => !v)}
          >
            {newestFirst ? t('scanBack.sort.newest') : t('scanBack.sort.oldest')}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : books.length === 0 ? (
          <EmptyState icon={Printer} message={t('scanBack.empty')} />
        ) : (
          GROUPS.map((g) => {
            const rows = inGroup(g)
            if (rows.length === 0) return null
            return (
              <section key={g}>
                <h2 className="mb-2 mt-4 font-mono text-[0.68em] font-bold uppercase tracking-widest text-faint first:mt-0">
                  {t(`scanBack.group.${g}`)} · {rows.length}
                </h2>
                {rows.map((b) => (
                  <ScanBackRow key={b.id} book={b} onFile={file} busy={busy} />
                ))}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
