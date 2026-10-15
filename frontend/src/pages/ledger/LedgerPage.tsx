import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'

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

/** Keep email URL state and its fixed-LTR shell confined to the Email panel. */
export function LedgerPage({ onNavigate }: LedgerPageProps = {}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has, isLoading } = useCapabilities()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const canEmail = has('ledger.view')
  const canBooks = has('books.view') && user?.role !== 'inmate_reporter'
  const requested = params.get('tab') === 'books' ? 'books' : 'email'
  const tab = requested === 'books' ? (canBooks ? 'books' : 'email') : (canEmail ? 'email' : 'books')

  useEffect(() => {
    if (isLoading || (!canEmail && !canBooks) || requested === tab) return
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (tab === 'books') {
        next.set('tab', 'books')
        next.delete('mail')
        next.delete('action')
      } else {
        next.delete('tab')
        next.delete('scope')
        next.delete('book')
      }
      return next
    }, { replace: true })
  }, [isLoading, canEmail, canBooks, requested, tab, setParams])

  function selectTab(value: string): void {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value === 'books') next.set('tab', 'books')
      else next.delete('tab')
      return next
    })
  }

  return (
    <Tabs value={tab} onValueChange={selectTab} className="flex min-h-0 flex-1 flex-col">
      <TabsList className="shrink-0 px-4" >
        {canEmail && <TabsTrigger value="email">{t('ledger.tabs.email')}</TabsTrigger>}
        {canBooks && <TabsTrigger value="books">{t('ledger.tabs.books')}</TabsTrigger>}
      </TabsList>
      {canEmail && (
        <TabsContent value="email" className="mt-0 flex min-h-0 flex-1 flex-col">
          <LedgerOutlookShell onNavigate={onNavigate} />
        </TabsContent>
      )}
      {canBooks && (
        <TabsContent value="books" className="mt-0 flex min-h-0 flex-1 flex-col">
          <section aria-label={t('ledger.tabs.books')} dir={i18n.dir()} />
        </TabsContent>
      )}
    </Tabs>
  )
}
