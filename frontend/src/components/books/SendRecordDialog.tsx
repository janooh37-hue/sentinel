/**
 * SendRecordDialog — send (or forward) a record to people.
 *
 * Recipients come from listRecipientCandidates (the backend returns only
 * cleared users for a Secret record). A Personal record has to become
 * Directed to be sent; the dialog says so and the send button carries the
 * switch (`make_directed`). Callers show the trigger only when `book.can_send`.
 */
import { useId, useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Search, X } from 'lucide-react'

import {
  api,
  ApiError,
  apiErrorMessage,
  SEND_PURPOSES,
  type BookRead,
  type BookSendResult,
  type RecipientCandidateRead,
  type SendPurpose,
} from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'

const MAX_RECIPIENTS = 50
const MAX_NOTE = 500
const SEND_ERROR_KEYS: Record<string, string | undefined> = {
  RECIPIENT_NOT_CLEARED: 'books.send.errors.notCleared',
  RECIPIENT_INVALID: 'books.send.errors.invalid',
  PERSONAL_REQUIRES_DIRECTED: 'books.send.errors.personal',
}

interface Props {
  book: BookRead
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SendRecordDialog({ book, open, onOpenChange }: Props): React.JSX.Element | null {
  const thread = useQuery({
    queryKey: ['books', 'thread', book.id],
    queryFn: () => api.getBookThread(book.id),
    enabled: open,
  })
  const candidatesQuery = useQuery({
    queryKey: ['books', 'recipient-candidates', book.confidentiality],
    queryFn: () => api.listRecipientCandidates(book.confidentiality),
    staleTime: 5 * 60_000,
    enabled: open,
  })
  // Resolve reply defaults before mounting; every opening starts clean.
  if (!open || thread.isPending || candidatesQuery.isPending) return null
  const replyTo = thread.data?.find((item) => item.direction === 'outgoing' && item.kind === 'reply')?.addressee_user_id
  const referenceCount = thread.data?.filter((item) => item.direction === 'outgoing' && item.attached).length ?? 0
  return <SendBody key={book.id} book={book} replyTo={replyTo} referenceCount={referenceCount} candidatesQuery={candidatesQuery} close={() => onOpenChange(false)} />
}

function SendBody({ book, close, replyTo, referenceCount, candidatesQuery }: Pick<Props, 'book'> & { close: () => void; replyTo?: number | null; referenceCount: number; candidatesQuery: UseQueryResult<RecipientCandidateRead[]> }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const qc = useQueryClient()
  const noteId = useId()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<number[]>(() =>
    replyTo != null && candidatesQuery.data?.some((candidate) =>
      candidate.id === replyTo && (book.confidentiality !== 'secret' || candidate.has_secret_clearance),
    ) ? [replyTo] : [],
  )
  const [purpose, setPurpose] = useState<SendPurpose>(replyTo != null ? 'reply' : 'info')
  const [note, setNote] = useState('')
  const isPersonal = book.confidentiality === 'personal'
  const isSecret = book.confidentiality === 'secret'
  const [includeReferences, setIncludeReferences] = useState(true)

  const candidates = (candidatesQuery.data ?? []).filter((c) => !isSecret || c.has_secret_clearance)
  const nameOf = (c: RecipientCandidateRead): string => pickEmployeeName({ name_en: c.name, name_ar: c.name_ar }, i18n.language)
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? candidates.filter((c) =>
        [c.name, c.name_ar, c.g_number].some((v) => v?.toLowerCase().includes(needle)),
      )
    : candidates

  const toggle = (id: number): void =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const mutation = useMutation({
    mutationFn: () =>
      api.sendBook(book.id, {
        user_ids: picked,
        purpose,
        note: note.trim() || null,
        make_directed: isPersonal,
        include_references: includeReferences,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      reportResult(res)
      close()
    },
    onError: (err) => {
      const key = err instanceof ApiError ? SEND_ERROR_KEYS[err.code] : undefined
      toast.error(key ? t(key) : apiErrorMessage(err))
    },
  })

  function reportResult(res: BookSendResult): void {
    const byId = new Map(candidates.map((c) => [c.id, nameOf(c)]))
    const skipped = res.skipped
      .map((s) =>
        s.reason === 'self'
          ? t('books.send.skippedSelf')
          : t('books.send.skippedAlready', { name: bidi(byId.get(s.user_id) ?? `#${s.user_id}`) }),
      )
      .join(isAr ? '، ' : ', ')
    const references = res.references ?? []
    const referenceSent = references.reduce((count, item) => count + item.sent_user_ids.length, 0)
    const referenceSkipped = references.flatMap((item) => item.skipped.map((skip) =>
      t(`books.thread.skipped.${skip.reason}`, { ref: bidi(item.ref_number), name: bidi(byId.get(skip.user_id) ?? `#${skip.user_id}`) }),
    ))
    const description = [
      skipped ? t('books.send.skipped', { list: skipped }) : '',
      references.length ? t('books.thread.sendSummary', { sent: referenceSent, skipped: referenceSkipped.length }) : '',
      referenceSkipped.join(isAr ? '، ' : ', '),
    ].filter(Boolean).join(' · ') || undefined
    if (res.sent.length > 0) toast.success(t('books.send.sent', { count: res.sent.length }), { description })
    else toast.info(t('books.send.nothingSent'), { description })
  }

  const canSend = picked.length > 0 && !mutation.isPending
  const sendLabel = isPersonal ? t('books.send.switchAndSend') : t('books.send.send')

  return (
    <RadixDialog.Root open onOpenChange={(o) => { if (!o) close() }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-300',
            'motion-reduce:animate-none',
          )}
        />
        <RadixDialog.Content
          data-print-hide
          className={cn(
            'bottom-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl',
            'focus-visible:outline-none',
            'md:inset-auto md:start-1/2 md:top-1/2 md:max-h-[80dvh] md:w-full md:max-w-lg',
            'md:-translate-x-1/2 rtl:md:translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
          )}
        >
          <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden" />

          <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
            <div className="min-w-0">
              <RadixDialog.Title className="text-[0.9em] font-semibold text-foreground">
                {t('books.send.title')}
              </RadixDialog.Title>
              <RadixDialog.Description className="truncate text-[0.76em] text-muted-foreground">
                <bdi dir="ltr" className="font-mono">{book.ref_number}</bdi>
                {book.subject ? <> · <bdi>{book.subject}</bdi></> : null}
              </RadixDialog.Description>
            </div>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            </RadixDialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {isPersonal && (
              <p
                role="note"
                data-testid="send-personal-notice"
                className="rounded-lg border border-warning/40 bg-warning-soft/50 px-3 py-2 text-[0.8em] text-foreground"
              >
                {t('books.send.personalNotice')}
              </p>
            )}
            {isSecret && (
              <p className="text-[0.78em] text-muted-foreground">{t('books.send.secretNotice')}</p>
            )}
            {referenceCount > 0 && (
              <label className="flex min-h-10 items-center gap-2 text-[0.84em]">
                <input type="checkbox" checked={includeReferences} disabled={mutation.isPending} onChange={(e) => setIncludeReferences(e.target.checked)} className="h-4 w-4 accent-primary" />
                {t('books.thread.alsoSend', { count: referenceCount })}
              </label>
            )}

            {/* Recipients */}
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <label htmlFor={searchId} className="text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('books.send.recipients')}
                </label>
                {picked.length > 0 && (
                  <span className="text-[0.76em] text-muted-foreground" aria-live="polite">
                    {t('books.send.selected', { count: picked.length })}
                  </span>
                )}
              </div>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('books.send.searchPlaceholder')}
                  className="min-h-10 w-full rounded-lg border border-hairline bg-background py-2 pe-3 ps-9 text-[0.84em] text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </div>
              {candidatesQuery.isError ? (
                <p className="text-[0.8em] text-destructive">{apiErrorMessage(candidatesQuery.error)}</p>
              ) : shown.length === 0 ? (
                <p className="rounded-lg border border-hairline px-3 py-4 text-center text-[0.8em] text-muted-foreground">
                  {candidates.length === 0 ? t('books.send.noCandidates') : t('books.send.noMatches')}
                </p>
              ) : (
                <div
                  className="max-h-56 overflow-y-auto rounded-lg border border-hairline bg-background"
                  data-testid="send-candidate-list"
                >
                  {shown.map((c) => {
                    const checked = picked.includes(c.id)
                    const full = !checked && picked.length >= MAX_RECIPIENTS
                    return (
                      <label
                        key={c.id}
                        className={cn(
                          'flex min-h-11 cursor-pointer items-center gap-2.5 border-b border-hairline px-3 py-2 last:border-b-0 hover:bg-surface-tinted',
                          full && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={full}
                          onChange={() => toggle(c.id)}
                          className="h-4 w-4 rounded border-hairline accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate text-[0.84em] text-foreground">
                          <bdi>{nameOf(c)}</bdi>
                        </span>
                        {c.g_number && (
                          <bdi dir="ltr" className="shrink-0 font-mono text-[0.72em] tabular-nums text-muted-foreground">
                            {c.g_number}
                          </bdi>
                        )}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Purpose */}
            <fieldset>
              <legend className="mb-2 text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('books.send.purpose')}
              </legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {SEND_PURPOSES.map((p) => (
                  <label
                    key={p}
                    className={cn(
                      'flex min-h-10 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-[0.82em] font-medium transition-colors',
                      'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                      purpose === p
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-hairline text-foreground hover:bg-surface-tinted',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${noteId}-purpose`}
                      value={p}
                      checked={purpose === p}
                      onChange={() => setPurpose(p)}
                      className="sr-only"
                    />
                    {t(`books.send.purposes.${p}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Note */}
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <label htmlFor={noteId} className="text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('books.send.note')}
                </label>
                <span className="text-[0.72em] tabular-nums text-muted-foreground">
                  <bdi dir="ltr">{note.length}/{MAX_NOTE}</bdi>
                </span>
              </div>
              <textarea
                id={noteId}
                value={note}
                maxLength={MAX_NOTE}
                rows={3}
                dir="auto"
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('books.send.notePlaceholder')}
                className="w-full resize-y rounded-lg border border-hairline bg-background px-3 py-2 text-[0.84em] text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
          </div>

          <footer className="border-t border-hairline px-5 py-4">
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={close}
                className="min-h-10 rounded-lg border border-hairline px-4 py-2 text-[0.84em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="send-record-submit"
                aria-disabled={canSend ? undefined : true}
                aria-busy={mutation.isPending ? true : undefined}
                onClick={() => {
                  if (canSend) mutation.mutate()
                }}
                className="min-h-10 rounded-lg bg-primary px-4 py-2 text-[0.84em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-40"
              >
                {sendLabel}
              </button>
            </div>
          </footer>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
