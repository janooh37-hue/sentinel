import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import type { SessionUser } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { WordReportForm } from './InmateReporterApplication'

export function FleetReporterApplication({ user, generalBookForm }: { user: SessionUser; generalBookForm: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { has, isLoading: capabilitiesLoading } = useCapabilities()
  const isMobile = useIsMobile()
  const { slug } = useParams<{ slug?: string }>()
  const navigate = useNavigate()
  const canCreate = has('documents.generate') && has('books.view')
  const canGeneralBook = canCreate && has('books.service.General Book')
  const canReport = canCreate && has('books.service.Report')
  const allowed = capabilitiesLoading || !slug || (slug === 'general_book' && canGeneralBook) || (slug === 'report' && canReport)

  useEffect(() => {
    if (!allowed) navigate('/services', { replace: true })
  }, [allowed, navigate])

  if (slug === 'general_book' && canGeneralBook) return <>{generalBookForm}</>
  if (slug === 'report' && canReport) return <WordReportForm user={user} onBack={() => navigate('/services')} />

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-10 pt-6 sm:px-8">
        <header className="mb-5">
          <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">{t('application.eyebrow')}</div>
          <h1 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">{t('application.servicesTitle')}</h1>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          {canGeneralBook && (
            <button type="button" onClick={() => navigate('/services/general_book')} className="rounded-2xl border border-hairline bg-surface p-5 text-start hover:border-primary">
              <span className="block text-lg font-semibold">{t('application.fleetReporter.generalBookTitle')}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{t('application.fleetReporter.generalBookDescription')}</span>
            </button>
          )}
          {canReport && (
            <button type="button" disabled={isMobile} onClick={() => navigate('/services/report')} className="rounded-2xl border border-hairline bg-surface p-5 text-start hover:border-primary disabled:cursor-not-allowed disabled:opacity-60">
              <span className="block text-lg font-semibold">{t('application.inmateReporter.reportTitle')}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{t(isMobile ? 'books.word.needsPc' : 'application.fleetReporter.reportDescription')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
