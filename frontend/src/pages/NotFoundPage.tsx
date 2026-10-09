/**
 * Shown in place for any unknown path and for a record the API reports as 404.
 * The URL is kept (no redirect) so the user can see and report what they followed.
 */
import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useCapabilities } from '@/lib/useCapabilities'

export function NotFoundPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-hairline bg-surface p-8 text-center shadow-sm">
        <SearchX className="h-8 w-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold text-foreground">{t('notFound.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('notFound.body')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            to="/"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('nav.dashboard')}
          </Link>
          {has('documents.generate') ? (
            <Link
              to="/services"
              className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('nav.services')}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}
