import { CheckCheck, CornerUpLeft, Loader2, PenLine, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type DecisionPending = 'sign' | 'return' | 'reject'

export interface RecordDecisionActionsProps {
  busy: boolean
  /** The act whose request is in flight: that button swaps to its pending
   *  label ("Signing…" / "Returning…" / "Rejecting…") with a spinner. */
  pending?: DecisionPending | null
  /** A Report: the primary records the manager's review instead of signing. */
  review?: boolean
  onReturn: () => void
  onReject: () => void
  onSign: () => void
  returnButtonRef?: React.Ref<HTMLButtonElement>
  rejectButtonRef?: React.Ref<HTMLButtonElement>
  signButtonRef?: React.Ref<HTMLButtonElement>
}

export function RecordDecisionActions({
  busy,
  pending = null,
  review = false,
  onReturn,
  onReject,
  onSign,
  returnButtonRef,
  rejectButtonRef,
  signButtonRef,
}: RecordDecisionActionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const buttonClass =
    'flex min-h-[46px] min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-center text-[0.75em] font-semibold leading-tight transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
  const spinner = (
    <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
  )

  return (
    <div className="grid grid-cols-3 gap-2">
      <button
        ref={returnButtonRef}
        type="button"
        disabled={busy}
        aria-busy={pending === 'return' ? true : undefined}
        onClick={onReturn}
        className={`${buttonClass} border-warning/40 bg-warning/10 text-warning hover:bg-warning/15`}
      >
        {pending === 'return' ? spinner : <CornerUpLeft className="h-4 w-4 shrink-0" aria-hidden />}
        <span>{pending === 'return' ? t('books.approval.returning') : t('books.approval.return')}</span>
      </button>
      <button
        ref={rejectButtonRef}
        type="button"
        disabled={busy}
        aria-busy={pending === 'reject' ? true : undefined}
        onClick={onReject}
        className={`${buttonClass} border-accent/40 bg-accent/10 text-accent hover:bg-accent/15`}
      >
        {pending === 'reject' ? spinner : <X className="h-4 w-4 shrink-0" strokeWidth={2.4} aria-hidden />}
        <span>{pending === 'reject' ? t('books.approval.rejecting') : t('books.approval.reject')}</span>
      </button>
      <button
        ref={signButtonRef}
        type="button"
        disabled={busy}
        aria-busy={pending === 'sign' ? true : undefined}
        onClick={onSign}
        className={`${buttonClass} border-success bg-success text-background hover:bg-success/90`}
      >
        {pending === 'sign' ? spinner : review ? <CheckCheck className="h-4 w-4 shrink-0" aria-hidden /> : <PenLine className="h-4 w-4 shrink-0" aria-hidden />}
        <span>
          {pending === 'sign'
            ? t(review ? 'books.approval.markingReviewed' : 'books.approval.signing')
            : t(review ? 'books.approval.markReviewed' : 'books.approval.signApprove')}
        </span>
      </button>
    </div>
  )
}
