/**
 * Leave History page — TAMM redesign.
 *
 * Layout:
 *   Page header (small eyebrow · big title · subtitle)
 *   Inner tabs (Records | Balance | Notification | Email draft)
 *   Tab content
 *
 * Inner-tab pattern mirrors EmployeeDetailTabs: borderless tablist with the
 * active trigger getting a navy underline + primary text.
 */

import { useSearchParam } from '@/lib/urlState'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { PullToRefresh } from '@/components/refresh/PullToRefresh'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import { ServiceNotificationTab } from '@/components/templates/ServiceNotificationTab'
import { ServiceDraftTab } from '@/components/templates/ServiceDraftTab'
import { TabRecords } from './TabRecords'
import { TabBalance } from './TabBalance'

type Tab = 'records' | 'balance' | 'notification' | 'email-draft'
const ORDER: Tab[] = ['records', 'balance', 'notification', 'email-draft']

export function LeavesPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [requestedTab, setTab] = useSearchParam('tab', { fallback: 'records' })
  const tab = ORDER.includes(requestedTab as Tab) ? requestedTab : 'records'

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
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 md:px-6" role="tablist" data-print-hide>
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
                'relative shrink-0 whitespace-nowrap px-4 py-3 text-[0.95em] font-medium transition-colors',
                isActive
                  ? 'font-semibold text-primary after:absolute after:-bottom-px after:start-3 after:end-3 after:h-[3px] after:rounded after:bg-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(key === 'notification' ? 'msgTemplates.tabs.notification' : key === 'email-draft' ? 'msgTemplates.tabs.emailDraft' : `leaves.tabs.${key}`)}
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
          ) : tab === 'balance' ? (
            <div className="h-full">
              <TabBalance />
            </div>
          ) : (
            <div className="mx-auto w-full min-w-0 max-w-5xl p-4 md:p-6">
              {tab === 'notification' ? (
                <ServiceNotificationTab service="leaves" />
              ) : (
                <ServiceDraftTab service="leaves" />
              )}
            </div>
          )}
        </PullToRefresh>
      </div>
    </div>
  )
}
