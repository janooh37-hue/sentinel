/**
 * RecordStateOverrideDialog — admin "set this record to any state".
 *
 * The escape hatch for records the approval flow has stranded: the assigned
 * signer left, a paper scan that will never arrive, a form approved on the wrong
 * record, a draft discarded by mistake. Backed by `PUT /books/{id}/state` and
 * gated on `books.override_state` (admin-only by default) — the caller gates the
 * trigger, the backend gates the request.
 *
 * The picker lists every state in one place, including `voided`, which the
 * backend stores on a separate column but which reads as a state everywhere in
 * the register (see `recordStateOf`). The current state is shown and disabled.
 *
 * `reason` is required for `returned` / `rejected` (same contract as the normal
 * decision path); it is always recorded in the audit log.
 */

import { useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ShieldAlert, X } from 'lucide-react'

import { api, apiErrorMessage, type BookOverridableState, type BookRead } from '@/lib/api'
import { RECORD_STATES, recordStateOf, sealDescriptor } from '@/pages/books/bookStateLabel'
import { cn } from '@/lib/utils'

interface Props {
  book: BookRead
  onClose: () => void
}

/** Targets whose meaning is worth spelling out before the operator commits. */
const CONSEQUENCE_KEY: Partial<Record<BookOverridableState, string>> = {
  approved: 'books.stateOverride.warnApproved',
  voided: 'books.stateOverride.warnVoided',
}

export function RecordStateOverrideDialog({ book, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const current = recordStateOf(book)
  const [target, setTarget] = useState<BookOverridableState | null>(null)
  const [reason, setReason] = useState('')

  const reasonRequired = target === 'returned' || target === 'rejected'
  const canSubmit = target !== null && (!reasonRequired || reason.trim().length > 0)

  const override = useMutation({
    mutationFn: () => api.overrideBookState(book.id, target!, reason.trim() || null),
    onSuccess: (updated) => {
      // The flip moves the register rows, the awaiting queue, the spine counts
      // and the dashboard tiles — invalidate the same set the decision path does.
      qc.setQueryData(['books', 'detail', book.id], updated)
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(
        t('books.stateOverride.done', {
          state: t(sealDescriptor(recordStateOf(updated)).labelKey),
        }),
      )
      onClose()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

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
          data-testid="state-override-dialog"
          className={cn(
            'bottom-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl',
            'focus-visible:outline-none',
            'md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[80dvh] md:w-full md:max-w-md',
            'md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
          )}
          aria-modal
        >
          <span
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden"
          />

          <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-3.5">
            <div className="min-w-0">
              <RadixDialog.Title className="flex items-center gap-1.5 text-[0.9em] font-semibold text-foreground">
                <ShieldAlert className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
                {t('books.stateOverride.title')}
              </RadixDialog.Title>
              <RadixDialog.Description className="mt-1 text-[0.76em] leading-snug text-muted-foreground">
                {t('books.stateOverride.blurb')}
              </RadixDialog.Description>
            </div>
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
            <fieldset>
              <legend className="mb-2 text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('books.stateOverride.pickState')}
              </legend>
              <div className="overflow-hidden rounded-lg border border-hairline bg-background">
                {RECORD_STATES.map((state) => {
                  const seal = sealDescriptor(state)
                  const isCurrent = state === current
                  return (
                    <label
                      key={state}
                      data-testid={`state-option-${state}`}
                      aria-current={isCurrent || undefined}
                      className={cn(
                        'flex items-center gap-2.5 border-b border-hairline px-3 py-2.5 last:border-b-0',
                        isCurrent
                          ? 'cursor-default bg-surface-tinted'
                          : 'cursor-pointer hover:bg-surface-tinted',
                      )}
                    >
                      <input
                        type="radio"
                        name="record-state"
                        value={state}
                        checked={target === state}
                        disabled={isCurrent}
                        onChange={() => setTarget(state)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.74em] font-semibold',
                          seal.toneClasses,
                        )}
                      >
                        <seal.Icon className="h-3 w-3" />
                        {t(seal.labelKey)}
                      </span>
                      {isCurrent && (
                        <span className="ms-auto text-[0.72em] font-medium text-muted-foreground">
                          {t('books.stateOverride.currentBadge')}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </fieldset>

            {target && CONSEQUENCE_KEY[target] && (
              <p
                data-testid="state-override-consequence"
                className="rounded-lg border border-warning/40 bg-warning-soft/50 px-3 py-2 text-[0.8em] leading-snug text-foreground"
              >
                {t(CONSEQUENCE_KEY[target])}
              </p>
            )}
            {/* A signed copy survives the flip (the backend never deletes it) — it
                just stops being served while the state says otherwise. */}
            {current === 'approved' && target !== null && (
              <p className="text-[0.78em] leading-snug text-muted-foreground">
                {t('books.stateOverride.warnLeaveApproved')}
              </p>
            )}

            <div>
              <label
                htmlFor="state-override-reason"
                className="mb-1.5 block text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t('books.stateOverride.reasonLabel')}
                {reasonRequired && <span className="ms-1 text-accent">*</span>}
              </label>
              <textarea
                id="state-override-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('books.stateOverride.reasonPlaceholder')}
                className="w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.84em] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="mt-1 text-[0.72em] text-muted-foreground">
                {t('books.stateOverride.reasonHint')}
              </p>
            </div>
          </div>

          <footer className="border-t border-hairline px-5 py-4">
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-hairline px-4 py-2 text-[0.84em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="state-override-confirm"
                disabled={!canSubmit || override.isPending}
                onClick={() => override.mutate()}
                className="rounded-lg bg-accent px-4 py-2 text-[0.84em] font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              >
                {t('books.stateOverride.confirm')}
              </button>
            </div>
          </footer>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
