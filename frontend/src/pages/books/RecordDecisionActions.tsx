import { CornerUpLeft, PenLine, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface RecordDecisionActionsProps {
  busy: boolean
  onReturn: () => void
  onReject: () => void
  onSign: () => void
  returnButtonRef?: React.Ref<HTMLButtonElement>
  rejectButtonRef?: React.Ref<HTMLButtonElement>
  signButtonRef?: React.Ref<HTMLButtonElement>
}

export function RecordDecisionActions({
  busy,
  onReturn,
  onReject,
  onSign,
  returnButtonRef,
  rejectButtonRef,
  signButtonRef,
}: RecordDecisionActionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const buttonClass =
    'flex min-h-[46px] min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-center text-[0.75em] font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

  return (
    <div className="grid grid-cols-3 gap-2">
      <button
        ref={returnButtonRef}
        type="button"
        disabled={busy}
        onClick={onReturn}
        className={`${buttonClass} border-warning/40 bg-warning/10 text-warning hover:bg-warning/15`}
      >
        <CornerUpLeft className="h-4 w-4 shrink-0" aria-hidden />
        <span>{t('books.approval.return')}</span>
      </button>
      <button
        ref={rejectButtonRef}
        type="button"
        disabled={busy}
        onClick={onReject}
        className={`${buttonClass} border-accent/40 bg-accent/10 text-accent hover:bg-accent/15`}
      >
        <X className="h-4 w-4 shrink-0" strokeWidth={2.4} aria-hidden />
        <span>{t('books.approval.reject')}</span>
      </button>
      <button
        ref={signButtonRef}
        type="button"
        disabled={busy}
        onClick={onSign}
        className={`${buttonClass} border-success bg-success text-background hover:bg-success/90`}
      >
        <PenLine className="h-4 w-4 shrink-0" aria-hidden />
        <span>{t('books.approval.signApprove')}</span>
      </button>
    </div>
  )
}
