/**
 * LedgerDraftsList — the signed-in writer's private Ledger Book drafts, newest
 * first: "DRAFT / مسودة {n}", first subject and last change. Each opens in
 * the composer; delete asks first. Meant for a "Drafts" place in the rail.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api, apiErrorMessage, type LedgerDraftRead } from '@/lib/api'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { LEDGER_DRAFTS_KEY, ledgerDraftKey } from './ledgerBookKeys'

export function LedgerDraftsList({ className }: { className?: string }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const drafts = useQuery({ queryKey: LEDGER_DRAFTS_KEY, queryFn: () => api.listLedgerDrafts() })
  const [pending, setPending] = useState<LedgerDraftRead | null>(null)
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }), [i18n.language])
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteLedgerDraft(id),
    onSuccess: (_void, id) => {
      qc.removeQueries({ queryKey: ledgerDraftKey(id) })
      void qc.invalidateQueries({ queryKey: LEDGER_DRAFTS_KEY, exact: true })
      toast.success(t('ledgerBook.composer.delete.deleted'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  if (drafts.isError) {
    return (
      <div className={cn('flex flex-col items-start gap-2 p-3', className)}>
        <p role="alert" className="text-[0.84em]">{t('ledgerBook.composer.loadFailed')}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void drafts.refetch()}>{t('ledgerBook.composer.retry')}</Button>
      </div>
    )
  }
  if (!drafts.data) return <p role="status" className={cn('p-3 text-[0.84em] text-muted-foreground', className)}>{t('ledgerBook.composer.loading')}</p>
  if (drafts.data.length === 0) return <p className={cn('p-3 text-[0.84em] text-muted-foreground', className)}>{t('ledgerBook.composer.drafts.empty')}</p>

  return (
    <section aria-label={t('ledgerBook.composer.drafts.title')} className={className}>
      <ul className="flex flex-col divide-y divide-hairline">
        {drafts.data.map((draft) => {
          const label = t('ledgerBook.composer.draftLabel', { number: draft.draft_number })
          const subject = draft.subjects.find((s) => s.trim() !== '')
          return (
            <li key={draft.id} className="flex items-center gap-1 py-1">
              <Link
                to={`/ledger/compose/${draft.id}`}
                className="flex min-h-12 min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[0.72em] font-semibold tracking-wide text-muted-foreground"><bdi>{label}</bdi></span>
                  <span className={cn('truncate text-[0.88em]', !subject && 'italic text-muted-foreground')}>
                    {subject ?? t('ledgerBook.composer.drafts.noSubject')}
                  </span>
                  <span className="text-[0.72em] text-muted-foreground">
                    {t('ledgerBook.composer.drafts.updated', { date: dateFmt.format(new Date(draft.updated_at)) })}
                  </span>
                </span>
              </Link>
              <Button
                type="button" variant="ghost" size="icon" className="size-10 shrink-0"
                aria-label={t('ledgerBook.composer.drafts.delete', { label })}
                disabled={remove.isPending && remove.variables === draft.id}
                onClick={() => setPending(draft)}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </li>
          )
        })}
      </ul>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('ledgerBook.composer.delete.confirmTitle')}
        description={t('ledgerBook.composer.delete.confirmBody')}
        confirmLabel={t('ledgerBook.composer.delete.button')}
        destructive
        onConfirm={() => pending && remove.mutate(pending.id)}
      />
    </section>
  )
}
