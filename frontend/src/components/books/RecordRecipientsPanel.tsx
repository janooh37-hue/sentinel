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
import { toast } from '@/lib/toast'
import { ChevronDown, Inbox, Send } from 'lucide-react'

import { api, apiErrorMessage, type BookRead, type BookRecipientRead, type BookDepartmentSendRead, type BookInboxRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { formatDmy } from '@/lib/formatDmy'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'
import { parseUtcMs } from '@/lib/time'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useInboxActions } from './useInboxActions'
import { useReplyActions } from './useReplyActions'

import { departmentErrorMessage, departmentName } from '@/lib/departments'
import { orderDepartmentSends } from '@/lib/departmentInbox'
const day = (iso: string): string => formatDmy(iso.slice(0, 10))

export function RecordRecipientsPanel({
  bookId,
  bookRef,
  className,
  departmentSends = [],
}: {
  bookId: number
  departmentSends?: BookDepartmentSendRead[]
  bookRef: string | null
  className?: string
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const timestamp = (iso: string): string => new Intl.DateTimeFormat(i18n.language, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(parseUtcMs(iso))
  const qc = useQueryClient()
  const [recallTarget, setRecallTarget] = useState<BookRecipientRead | null>(null)
  const [departmentRecallTarget, setDepartmentRecallTarget] = useState<BookDepartmentSendRead | null>(null)
  const { data: recipientRows = [] } = useQuery({
    queryKey: ['books', 'recipients', bookId],
    queryFn: () => api.listBookRecipients(bookId),
  })
  const recall = useMutation({
    mutationFn: (recipientId: number) => api.recallBookRecipient(bookId, recipientId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('books.send.recalled'), { reference: bookRef ?? undefined })
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const recallDepartment = useMutation({
    mutationFn: (sendId: number) => api.recallBookDepartmentSend(bookId, sendId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['notifications', 'counts'] })
      toast.success(t('books.send.recalled'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const departmentIds = new Set(departmentSends.map((send) => send.id))
  const rows = recipientRows.filter((row) => row.department_send_id == null || !departmentIds.has(row.department_send_id))
  const activeDepartments = departmentSends.filter((send) => !send.revoked_at)

  if (rows.length === 0 && departmentSends.length === 0) return null
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
        <span className="font-semibold">{t(departmentSends.length ? 'books.send.deliveryCount' : 'books.send.sentTo', { count: active.length + activeDepartments.length })}</span>
        <span className="text-muted-foreground">{t('books.send.openedCount', { count: opened + activeDepartments.filter((send) => send.heads_read > 0).length })}</span>
        <ChevronDown
          className="ms-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <ul className="divide-y divide-hairline border-t border-hairline">
        {orderDepartmentSends(departmentSends).map(({ send, depth }) => (
          <li key={`department-${send.id}`} style={{ paddingInlineStart: `${16 + depth * 20}px` }} className={cn('flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-[0.78em]', send.revoked_at && 'opacity-60')}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <bdi className="font-semibold">{departmentName({ name_en: send.department_name_en, name_ar: send.department_name_ar }, i18n.language)}</bdi>
                <span className="rounded-full bg-surface-tinted px-2 py-0.5 font-medium">{t(`books.send.purposes.${send.purpose}`)}</span>
                {send.revoked_at && <span className="font-medium text-destructive">{t('books.send.recalledChip')}</span>}
              </p>
              {send.note && <p className="mt-0.5 whitespace-pre-line" dir="auto">{send.note}</p>}
              <p className="mt-0.5 text-muted-foreground">{t('books.send.sentByOn', { name: bidi(pickEmployeeName({ name_en: send.sent_by_name ?? '', name_ar: send.sent_by_name_ar }, i18n.language)), date: bidi(day(send.created_at)) })}</p>
              <p className="mt-0.5 text-muted-foreground">{t('books.distribute.progress', { read: send.heads_read, total: send.heads_total, reached: send.members_reached, done: send.done_count })}</p>
              {send.kept_at && <p className="mt-0.5 font-medium text-foreground">{t('books.distribute.keptBy', { name: bidi(pickEmployeeName({ name_en: send.kept_by_name || '—', name_ar: send.kept_by_name_ar }, i18n.language)) })}</p>}
            </div>
            {send.can_recall && !send.revoked_at && <button type="button" disabled={recallDepartment.isPending} onClick={() => setDepartmentRecallTarget(send)} className="min-h-9 rounded-lg border border-hairline px-3 font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{t('books.send.recall')}</button>}
          </li>
        ))}
        {rows.map((r) => (
          <li
            key={r.id}
            className={cn('flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-[0.78em] sm:px-5', r.revoked_at && 'opacity-60')}
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <bdi className="font-semibold text-foreground">{pickEmployeeName({ name_en: r.user_name ?? '', name_ar: r.user_name_ar }, i18n.language)}</bdi>
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
                {t('books.send.sentByOn', { name: bidi(pickEmployeeName({ name_en: r.sent_by_name ?? '', name_ar: r.sent_by_name_ar }, i18n.language)), date: bidi(day(r.created_at)) })}
                {' · '}
                {r.read_at
                  ? t('books.send.openedOn', { date: bidi(day(r.read_at)) })
                  : t('books.send.notOpened')}
                {r.done_at && (
                  <>
                    {' · '}
                    <span className="font-medium text-success">
                      {t('books.inbox.doneOn', { date: bidi(timestamp(r.done_at)) })}
                    </span>
                  </>
                )}
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
        title={t('books.send.recallTitle', { name: bidi(pickEmployeeName({ name_en: recallTarget?.user_name ?? '', name_ar: recallTarget?.user_name_ar }, i18n.language)) })}
        description={t('books.send.recallBody')}
        confirmLabel={t('books.send.recall')}
        destructive
        onConfirm={() => {
          const target = recallTarget
          setRecallTarget(null)
          if (target) recall.mutate(target.id)
        }}
      />
      <ConfirmDialog
        open={departmentRecallTarget !== null}
        onOpenChange={(open) => { if (!open) setDepartmentRecallTarget(null) }}
        title={t('books.send.recallTitle', { name: bidi(departmentRecallTarget ? departmentName({ name_en: departmentRecallTarget.department_name_en, name_ar: departmentRecallTarget.department_name_ar }, i18n.language) : '') })}
        description={t('books.distribute.recallBody')}
        confirmLabel={t('books.send.recall')}
        destructive
        onConfirm={() => {
          if (departmentRecallTarget) recallDepartment.mutate(departmentRecallTarget.id)
          setDepartmentRecallTarget(null)
        }}
      />
    </details>
  )
}

export function RecordInboxStrip({
  book,
  className,
}: {
  book: BookRead
  className?: string
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const actions = useInboxActions(book)
  const reply = useReplyActions(book)
  const inbox = book.my_inbox
  if (!inbox) return null
  return (
    <div
      role="note"
      data-print-hide
      data-testid="record-inbox-strip"
      className={cn('flex flex-wrap items-start gap-2 border-b border-info/30 bg-info-soft/60 px-4 py-2.5 text-[0.8em] text-foreground sm:px-5', className)}
    >
      <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">
          {t('books.send.sentToYou', { name: bidi(pickEmployeeName({ name_en: inbox.sent_by_name ?? '', name_ar: inbox.sent_by_name_ar }, i18n.language)) })}
        </span>
        {' — '}
        {t(`books.send.purposes.${inbox.purpose}`)}
        {' '}<DepartmentInboxBadge inbox={inbox} />
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
        {inbox.done_at && (
          <span className="ms-2 inline-flex rounded-full bg-success-soft px-2 py-0.5 font-medium text-success">
            {t('books.inbox.doneState')}
          </span>
        )}
        {inbox.archived_at && (
          <span className="ms-2 inline-flex rounded-full bg-surface-tinted px-2 py-0.5 font-medium">
            {t('books.inbox.archivedState')}
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {actions.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={item.pending}
            aria-busy={item.pending || undefined}
            onClick={item.onSelect}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 font-medium transition-colors hover:bg-surface-tinted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.icon}{item.label}
          </button>
        ))}
        {reply.actions.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onSelect}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 font-medium transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.icon}{item.label}
          </button>
        ))}
      </div>
      {reply.dialog}
    </div>
  )
}

export function DepartmentInboxBadge({ inbox }: { inbox: BookInboxRead }): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  if (inbox.department_send_id == null) return null
  const name = departmentName({ name_en: inbox.department_name_en ?? '', name_ar: inbox.department_name_ar ?? '' }, i18n.language)
  return <span className="inline-flex rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">{t('books.distribute.forInbox', { name: bidi(name) })}</span>
}
