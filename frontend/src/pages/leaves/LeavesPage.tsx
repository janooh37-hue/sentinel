/**
 * Leave History page — TAMM redesign.
 *
 * Layout:
 *   Page header (small eyebrow · big title · subtitle)
 *   Inner tabs (Records | Balance) with primary-color underline
 *   Tab content
 *
 * Inner-tab pattern mirrors EmployeeDetailTabs: borderless tablist with the
 * active trigger getting a navy underline + primary text.
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { PullToRefresh } from '@/components/refresh/PullToRefresh'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import { TabRecords } from './TabRecords'
import { TabBalance } from './TabBalance'

type Tab = 'records' | 'balance'
const ORDER: Tab[] = ['records', 'balance']

export function LeavesPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('records')

  // If `?open=<id>` is present in the URL, force the Records tab so the
  // detail drawer in `TabRecords` can pick the param up. We don't strip
  // the param here — TabRecords owns the consumption (it needs to read
  // the id, open the drawer, and only then remove it from the URL).
  const [searchParams] = useSearchParams()
  const hasOpenParam =
    searchParams.get('open') !== null || searchParams.get('ns') !== null
  useEffect(() => {
    if (hasOpenParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab('records')
    }
  }, [hasOpenParam])

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Page header — TAMM eyebrow + big title.
          Mobile: tighter padding, subtitle hidden to give the list room. */}
      <header className="px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {t('leaves.eyebrow', { defaultValue: t('employees.eyebrow') })}
            </div>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground md:text-[1.7em]">
              {t('leaves.title')}
            </h1>
            <div className="mt-1 hidden text-[0.86em] text-muted-foreground md:block">
              {t('leaves.subtitle')}
            </div>
          </div>
          <RefreshButton />
        </div>
      </header>

      {/* Inner tabs — primary-color underline on active */}
      <div className="flex gap-1 border-b border-border px-4 md:px-6" role="tablist">
        {ORDER.map((key) => {
          const isActive = tab === key
          return (
            <button
              key={key}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'relative px-4 py-3 text-[0.95em] font-medium transition-colors',
                isActive
                  ? 'font-semibold text-primary after:absolute after:-bottom-px after:left-3 after:right-3 after:h-[3px] after:rounded after:bg-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`leaves.tabs.${key}`)}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        <PullToRefresh>
          {tab === 'records' ? (
            <div className="h-full overflow-hidden">
              <TabRecords />
            </div>
          ) : (
            <div className="h-full">
              <TabBalance />
            </div>
          )}
        </PullToRefresh>
      </div>
    </div>
  )
}
