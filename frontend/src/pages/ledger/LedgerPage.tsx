import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useSearchParams } from 'react-router-dom'

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

/** Books is the landing tab; mail links, compose hand-offs and `?tab=email` open Email. */
export function LedgerPage({ onNavigate }: LedgerPageProps = {}): React.JSX.Element {
  const { t } = useTranslation()
  const { has, isLoading } = useCapabilities()
  const { user } = useAuth()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const canEmail = has('ledger.view')
  const canBooks = has('books.view') && user?.role !== 'inmate_reporter'
  const explicit = params.get('tab')
  const navState = location.state as { composePrefill?: unknown; ledgerView?: unknown } | null
  const wantsEmail = explicit === 'email' || (explicit !== 'books'
    && (params.has('mail') || params.has('action') || !!navState?.composePrefill || !!navState?.ledgerView))
  const requested = wantsEmail ? 'email' : 'books'
  const tab = requested === 'books' ? (canBooks ? 'books' : 'email') : (canEmail ? 'email' : 'books')

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
    }, { replace: true, state: location.state })
  }, [isLoading, canEmail, canBooks, explicit, requested, tab, setParams, location.state])

  function selectTab(value: string): void {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('tab', value)
      return next
    })
  }

  return (
    <Tabs value={tab} onValueChange={selectTab} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* An open book takes the whole page; its toolbar carries Back. */}
      {!(tab === 'books' && params.has('book')) && (
        <TabsList className="shrink-0 px-4">
          {canBooks && <TabsTrigger value="books">{t('ledger.tabs.books')}</TabsTrigger>}
          {canEmail && <TabsTrigger value="email">{t('ledger.tabs.email')}</TabsTrigger>}
        </TabsList>
      )}
      {canBooks && (
        <TabsContent value="books" className="mt-0 flex min-h-0 flex-1 flex-col">
          <BooksRoutingDesk />
        </TabsContent>
      )}
      {canEmail && (
        <TabsContent value="email" className="mt-0 flex min-h-0 flex-1 flex-col">
          <LedgerOutlookShell onNavigate={onNavigate} />
        </TabsContent>
      )}
    </Tabs>
  )
}
