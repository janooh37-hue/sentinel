/**
 * RevisionAccessPanel — users.manage-only "Revision access" control.
 *
 * Lists every retained revision-access grant on a record (`GET
 * /books/{id}/revision-access`), grouped by revision then person, showing
 * responsibility (approver/reviewer), completion state, and revocation state.
 * Revoking removes EVERY retained role grant that user holds on that
 * revision (the backend's own semantics) — a reason is required and recorded.
 *
 * Mirrors RecordStateOverrideDialog's bottom-sheet/dialog shell for visual
 * consistency with the record toolbar's other admin panels.
 */
import { useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ShieldCheck, X } from 'lucide-react'

import { api, apiErrorMessage, type BookRevisionAccessRead } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  bookId: number
  onClose: () => void
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

// `BookRevisionAccess.state` (backend `ck_book_revision_access_state`) is a
// distinct enum from the book-level approval_state that the existing
// `books.approval.state*` keys were named for — reviewed/changes_requested
// have no book-level equivalent. An explicit map (not string concatenation)
// so a snake_case value like `changes_requested` can't silently miss its key.
const STATE_LABEL_KEYS: Record<string, string> = {
  approved: 'books.approval.stateApproved',
  rejected: 'books.approval.stateRejected',
  returned: 'books.approval.stateReturned',
  reviewed: 'books.approval.stateReviewed',
  changes_requested: 'books.approval.stateChangesRequested',
}

export function RevisionAccessPanel({ bookId, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [revokeTarget, setRevokeTarget] = useState<BookRevisionAccessRead | null>(null)
  const [reason, setReason] = useState('')

  const { data: grants = [], isPending } = useQuery({
    queryKey: ['books', bookId, 'revision-access'],
    queryFn: () => api.listRevisionAccess(bookId),
  })

  const revoke = useMutation({
    mutationFn: () => api.revokeRevisionAccess(bookId, revokeTarget!.id, reason.trim()),
    onSuccess: (updated) => {
      qc.setQueryData(['books', bookId, 'revision-access'], updated)
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['books', 'detail', bookId] })
      toast.success(t('books.approval.revokeAccessDone'))
      setRevokeTarget(null)
      setReason('')
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const byVersion = new Map<number, { version_no: number; grants: BookRevisionAccessRead[] }>()
  for (const grant of grants) {
    const bucket = byVersion.get(grant.version_id) ?? { version_no: grant.version_no, grants: [] }
    bucket.grants.push(grant)
    byVersion.set(grant.version_id, bucket)
  }
  const versions = [...byVersion.entries()].sort((a, b) => b[1].version_no - a[1].version_no)

  return (
    <RadixDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-300',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200',
            'motion-reduce:animate-none',
          )}
        />
        <RadixDialog.Content
          aria-describedby={undefined}
          data-testid="revision-access-dialog"
          className={cn(
            'bottom-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl',
            'focus-visible:outline-none',
            'md:inset-x-0 md:inset-y-auto md:top-1/2 md:mx-auto md:max-h-[80dvh] md:w-full md:max-w-lg',
            'md:-translate-y-1/2 md:rounded-2xl',
          )}
          aria-modal
        >
          <span
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden"
          />

          <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-3.5">
            <RadixDialog.Title className="flex items-center gap-1.5 text-[0.9em] font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
              {t('books.approval.revisionAccess')}
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </RadixDialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {isPending ? (
              <p className="text-[0.82em] text-muted-foreground">{t('common.loading')}</p>
            ) : versions.length === 0 ? (
              <p className="text-[0.82em] text-muted-foreground">
                {t('books.approval.revisionAccessEmpty')}
              </p>
            ) : (
              versions.map(([versionId, bucket]) => (
                <fieldset key={versionId}>
                  <legend className="mb-2 text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('books.versions.title')} · v{bucket.version_no}
                  </legend>
                  <div className="overflow-hidden rounded-lg border border-hairline bg-background">
                    {bucket.grants.map((grant) => (
                      <div
                        key={grant.id}
                        data-testid={`revision-access-grant-${grant.id}`}
                        className="flex items-center gap-2.5 border-b border-hairline px-3 py-2.5 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[0.82em] font-medium text-foreground">
                            <bdi>{grant.user_name ?? `#${grant.user_id}`}</bdi>
                            <span className="rounded-full bg-surface-tinted px-1.5 py-0.5 text-[0.7em] font-semibold text-muted-foreground">
                              {grant.kind === 'approver'
                                ? t('books.approvals.subTabSign')
                                : t('books.approvals.subTabReview')}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[0.72em] text-muted-foreground">
                            {t(STATE_LABEL_KEYS[grant.state] ?? '', { defaultValue: grant.state })}{' '}
                            · {formatDate(grant.decided_at)}
                          </p>
                          {grant.revoked_at && (
                            <p className="mt-0.5 text-[0.72em] text-accent">
                              {t('books.approval.revisionAccessRevoked')} · {formatDate(grant.revoked_at)}
                              {grant.revocation_reason && ` — ${grant.revocation_reason}`}
                            </p>
                          )}
                        </div>
                        {!grant.revoked_at && (
                          <button
                            type="button"
                            data-testid={`revoke-access-${grant.id}`}
                            onClick={() => {
                              setRevokeTarget(grant)
                              setReason('')
                            }}
                            className="shrink-0 rounded-lg border border-hairline px-2.5 py-1.5 text-[0.76em] font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {t('books.approval.revokeAccess')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))
            )}

            {revokeTarget && (
              <div className="rounded-lg border border-accent/40 bg-accent/5 p-3.5">
                <p className="mb-2 text-[0.82em] font-medium text-foreground">
                  {t('books.approval.revokeAccess')} — <bdi>{revokeTarget.user_name ?? `#${revokeTarget.user_id}`}</bdi>
                </p>
                <label
                  htmlFor="revoke-access-reason"
                  className="mb-1.5 block text-[0.78em] font-semibold text-muted-foreground"
                >
                  {t('books.approval.revokeAccessReasonLabel')}
                </label>
                <textarea
                  id="revoke-access-reason"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('books.approval.revokeAccessReasonPlaceholder')}
                  className="w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.84em] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="mt-2.5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRevokeTarget(null)
                      setReason('')
                    }}
                    className="rounded-lg border border-hairline px-3 py-1.5 text-[0.8em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    data-testid="revoke-access-confirm"
                    disabled={reason.trim().length === 0 || revoke.isPending}
                    onClick={() => revoke.mutate()}
                    className="rounded-lg bg-accent px-3 py-1.5 text-[0.8em] font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  >
                    {t('books.approval.revokeAccessConfirm')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
