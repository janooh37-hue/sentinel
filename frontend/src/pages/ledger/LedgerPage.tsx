import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'

import { BooksRoutingDesk } from './BooksRoutingDesk'
import { LedgerOutlookShell } from './outlook/LedgerOutlookShell'

interface LedgerPageProps {
  onNavigate?: (
    page:
      | 'employees'
      | 'books'
      | 'settings'
      | 'services'
      | 'leaves'
      | 'dashboard'
      | 'ledger',
    id?: string,
  ) => void
}

const switcherTabClassName =
  'h-8 flex-1 justify-center rounded-md px-3 text-xs after:hidden focus-visible:ring-offset-0 ' +
  'data-[state=inactive]:hover:bg-surface/60 ' +
  'data-[state=active]:bg-surface data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-sm'

/** Books is the landing tab; `?tab=email` and mail links (`?mail=`, `?action=`) open Email. */
export function LedgerPage({ onNavigate }: LedgerPageProps = {}): React.JSX.Element {
  const { t } = useTranslation()
  const { has, isLoading } = useCapabilities()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const canEmail = has('ledger.view')
  const canBooks = has('books.view') && user?.role !== 'inmate_reporter'
  const explicit = params.get('tab')
  const wantsEmail = explicit === 'email' || (explicit !== 'books' && (params.has('mail') || params.has('action')))
  const requested = wantsEmail ? 'email' : 'books'
  const tab = requested === 'books' ? (canBooks ? 'books' : 'email') : (canEmail ? 'email' : 'books')
  // Same guard as the desk, so a malformed `book` never strands the user without tabs.
  const bookOpen = tab === 'books' && /^0*[1-9]\d*$/.test(params.get('book') ?? '')

  useEffect(() => {
    if (isLoading || (!canEmail && !canBooks) || explicit === tab) return
    // Pin the tab in the URL so Email survives its own `mail` param being cleared.
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('tab', tab)
      if (requested !== tab && tab === 'books') {
        next.delete('mail')
        next.delete('action')
      } else if (requested !== tab) {
        next.delete('scope')
        next.delete('book')
        next.delete('view')
      }
      return next
    }, { replace: true })
  }, [isLoading, canEmail, canBooks, explicit, requested, tab, setParams])

  const rootRef = useRef<HTMLDivElement>(null)
  const switchedRef = useRef(false)
  function selectTab(value: string): void {
    switchedRef.current = true
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('tab', value)
      return next
    })
  }
  useEffect(() => {
    // Each desk mounts its own switcher, so the pressed tab unmounts: hand focus to its twin.
    if (!switchedRef.current) return
    switchedRef.current = false
    rootRef.current?.querySelector<HTMLElement>('[data-ledger-switch][data-state="active"]')?.focus()
  }, [tab])

  const switcher = canBooks && canEmail && !bookOpen ? (
    <TabsList aria-label={t('ledger.title')} className="w-full shrink-0 gap-1 rounded-lg border-0 bg-surface-tinted p-1">
      <TabsTrigger data-ledger-switch value="books" className={switcherTabClassName}>{t('ledger.tabs.books')}</TabsTrigger>
      <TabsTrigger data-ledger-switch value="email" className={switcherTabClassName}>{t('ledger.tabs.email')}</TabsTrigger>
    </TabsList>
  ) : null

  return (
    <div ref={rootRef} className="contents">
      <Tabs value={tab} onValueChange={selectTab} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {canBooks && (
          <TabsContent value="books" className="mt-0 flex min-h-0 flex-1 flex-col">
            <BooksRoutingDesk switcher={switcher} />
          </TabsContent>
        )}
        {canEmail && (
          <TabsContent value="email" className="mt-0 flex min-h-0 flex-1 flex-col">
            <LedgerOutlookShell onNavigate={onNavigate} switcher={switcher} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
