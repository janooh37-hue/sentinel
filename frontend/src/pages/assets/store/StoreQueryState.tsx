/**
 * The loading / error / empty frame every Store list shares, so each page only
 * renders its data. Loading shows skeletons in the shape of the list (cards on
 * phones, rows above), errors offer a retry, and the empty state says what to
 * do next.
 */

import { AlertTriangle, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonCard, SkeletonRow } from '@/components/ui/skeleton'
import { useIsMobile } from '@/lib/useIsMobile'

import { storeErrorMessage } from './storeUtils'

interface Props {
  isPending: boolean
  error: unknown
  onRetry: () => void
  isEmpty: boolean
  emptyIcon?: LucideIcon
  emptyMessage: string
  emptyDescription: string
  children: React.ReactNode
}

export function StoreQueryState({
  isPending,
  error,
  onRetry,
  isEmpty,
  emptyIcon,
  emptyMessage,
  emptyDescription,
  children,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const mobile = useIsMobile()

  if (isPending) {
    return (
      <div aria-busy="true" aria-label={t('assets.store.state.loading')} className="flex flex-col gap-2">
        {mobile
          ? Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} rows={2} />)
          : Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} cols={5} />)}
      </div>
    )
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
      >
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle aria-hidden strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">{t('assets.store.state.error')}</span>{' '}
            <span dir="auto">{storeErrorMessage(error)}</span>
          </span>
        </p>
        <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={onRetry}>
          {t('assets.store.state.retry')}
        </Button>
      </div>
    )
  }

  if (isEmpty) {
    return (
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage}
        description={emptyDescription}
        className="rounded-xl border border-dashed border-border"
      />
    )
  }

  return <>{children}</>
}
