/**
 * RecordRecipientsPanel — who a record was sent to (purpose, note, sender,
 * sent/opened dates), with Recall on the rows the backend marks `can_recall`.
 * Renders nothing when the caller can see no recipient rows.
 *
 * RecordInboxStrip — "Sent to you by X — purpose — note" for a recipient.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, Inbox, Send } from 'lucide-react'

import { api, apiErrorMessage, type BookInboxRead, type BookRecipientRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { formatDmy } from '@/lib/formatDmy'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const day = (iso: string): string => formatDmy(iso.slice(0, 10))

export function RecordRecipientsPanel({
  bookId,
  className,
}: {
  bookId: number
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [recallTarget, setRecallTarget] = useState<BookRecipientRead | null>(null)
  const { data: rows = [] } = useQuery({
    queryKey: ['books', 'recipients', bookId],
    queryFn: () => api.listBookRecipients(bookId),
  })
  const recall = useMutation({
    mutationFn: (recipientId: number) => api.recallBookRecipient(bookId, recipientId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('books.send.recalled'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  if (rows.length === 0) return null
  const active = rows.filter((r) => !r.revoked_at)
  const opened = active.filter((r) => r.read_at).length

  return (
    <details
      data-print-hide
      data-testid="record-recipients"
      className={cn('group border-b border-hairline bg-surface', className)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-[0.8em] text-foreground marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
        <Send className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-semibold">{t('books.send.sentTo', { count: active.length })}</span>
        <span className="text-muted-foreground">{t('books.send.openedCount', { count: opened })}</span>
        <ChevronDown
          className="ms-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <ul className="divide-y divide-hairline border-t border-hairline">
        {rows.map((r) => (
          <li
            key={r.id}
            className={cn('flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-[0.78em] sm:px-5', r.revoked_at && 'opacity-60')}
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <bdi className="font-semibold text-foreground">{r.user_name}</bdi>
                <span className="rounded-full bg-surface-tinted px-2 py-0.5 text-[0.9em] font-medium text-foreground">
                  {t(`books.send.purposes.${r.purpose}`)}
                </span>
                {r.revoked_at && (
                  <span className="text-[0.9em] font-medium text-destructive">{t('books.send.recalledChip')}</span>
                )}
              </p>
              {r.note && (
                <p className="mt-0.5 whitespace-pre-line text-foreground" dir="auto">
                  {r.note}
                </p>
              )}
              <p className="mt-0.5 text-muted-foreground">
                {t('books.send.sentByOn', { name: bidi(r.sent_by_name ?? ''), date: bidi(day(r.created_at)) })}
                {' · '}
                {r.read_at
                  ? t('books.send.openedOn', { date: bidi(day(r.read_at)) })
                  : t('books.send.notOpened')}
              </p>
            </div>
            {r.can_recall && !r.revoked_at && (
              <button
                type="button"
                onClick={() => setRecallTarget(r)}
                disabled={recall.isPending}
                className="min-h-9 shrink-0 rounded-lg border border-hairline px-3 text-[0.95em] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('books.send.recall')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={recallTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRecallTarget(null)
        }}
        title={t('books.send.recallTitle', { name: bidi(recallTarget?.user_name ?? '') })}
        description={t('books.send.recallBody')}
        confirmLabel={t('books.send.recall')}
        destructive
        onConfirm={() => {
          const target = recallTarget
          setRecallTarget(null)
          if (target) recall.mutate(target.id)
        }}
      />
    </details>
  )
}

export function RecordInboxStrip({
  inbox,
  className,
}: {
  inbox: BookInboxRead | null | undefined
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!inbox) return null
  return (
    <div
      role="note"
      data-print-hide
      data-testid="record-inbox-strip"
      className={cn('flex items-start gap-2 border-b border-info/30 bg-info-soft/60 px-4 py-2.5 text-[0.8em] text-foreground sm:px-5', className)}
    >
      <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
      <p className="min-w-0">
        <span className="font-semibold">
          {t('books.send.sentToYou', { name: bidi(inbox.sent_by_name ?? '') })}
        </span>
        {' — '}
        {t(`books.send.purposes.${inbox.purpose}`)}
        {inbox.note && (
          <>
            {' — '}
            <span className="whitespace-pre-line" dir="auto">{inbox.note}</span>
          </>
        )}
        <span className="text-muted-foreground">
          {' · '}
          <bdi dir="ltr" className="tabular-nums">{day(inbox.sent_at)}</bdi>
        </span>
      </p>
    </div>
  )
}
