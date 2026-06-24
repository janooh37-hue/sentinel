/**
 * ScanInboxPage — triage hub for auto-scanned incoming documents.
 *
 * Items are grouped into four sections:
 *   • Needs confirmation   (awaiting_confirmation)
 *   • Unrouted             (unrouted)
 *   • Recently auto-filed  (auto_filed)
 *   • Couldn't read        (error)
 *
 * The list auto-refreshes every 30 s so newly arrived items surface without
 * a manual reload.
 *
 * Route: /scan-inbox  (gated documents.scan — see App.tsx)
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { ScanInboxItem } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { ScanInboxCard } from './ScanInboxCard'

const SECTIONS: { key: string; states: ScanInboxItem['state'][] }[] = [
  { key: 'confirm', states: ['awaiting_confirmation'] },
  { key: 'unrouted', states: ['unrouted'] },
  { key: 'autoFiled', states: ['auto_filed'] },
  { key: 'error', states: ['error'] },
]

export function ScanInboxPage(): React.JSX.Element {
  const { t } = useTranslation()

  const query = useQuery({
    queryKey: ['scan-inbox'],
    queryFn: () => api.listScanInbox(),
    refetchInterval: 30_000,
  })

  const items = useMemo(() => query.data?.items ?? [], [query.data])

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[820px] flex-1 px-4 pb-10 pt-6 md:px-8">
        <header className="mb-6">
          <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('scanInbox.eyebrow')}
          </div>
          <h2 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
            {t('scanInbox.pageTitle')}
          </h2>
          <div className="mt-1 text-[0.86em] text-muted-foreground">
            {t('scanInbox.pageSubtitle')}
          </div>
        </header>

        {query.isError ? (
          <p className="py-12 text-center text-sm text-accent">{t('scanInbox.loadError')}</p>
        ) : query.isLoading ? (
          <Skeleton className="h-[320px] w-full rounded-2xl" />
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {t('scanInbox.empty')}
          </p>
        ) : (
          <div className="flex flex-col gap-8">
            {SECTIONS.map(({ key, states }) => {
              const group = items.filter((i) => states.includes(i.state))
              if (group.length === 0) return null
              return (
                <section key={key}>
                  <h3 className="mb-2 text-[0.8em] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(`scanInbox.sections.${key}`)} ({group.length})
                  </h3>
                  <div className="flex flex-col gap-3">
                    {group.map((i) => (
                      <ScanInboxCard key={i.id} item={i} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
