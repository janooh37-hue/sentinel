import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface DecisionReasonFormProps {
  act: 'return' | 'reject'
  reason: string
  reasonValid: boolean
  busy: boolean
  allowMarks?: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onReasonChange: (reason: string) => void
  onCancel: (act: 'return' | 'reject') => void
  onConfirm: (act: 'return' | 'reject') => void
}

export function DecisionReasonForm({
  act,
  reason,
  reasonValid,
  busy,
  allowMarks = true,
  inputRef,
  onReasonChange,
  onCancel,
  onConfirm,
}: DecisionReasonFormProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <label
        htmlFor="rec-reason"
        className="mb-1.5 block text-[0.78em] font-semibold text-foreground"
      >
        {act === 'return'
          ? t('books.approval.return')
          : t('books.approval.reject')}{' '}
        · {t('books.approval.reasonLabel')}
      </label>
      <textarea
        ref={inputRef}
        id="rec-reason"
        rows={2}
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        placeholder={t('books.approval.reasonPlaceholder')}
        dir="auto"
        className="w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.88em] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
      <div className="mt-2 flex items-center justify-end gap-2.5">
        {!reasonValid && (
          <span className="me-auto text-[0.74em] text-muted-foreground">
            {t(allowMarks ? 'books.approval.reasonOrMark' : 'books.approval.reasonRequired')}
          </span>
        )}
        <button
          type="button"
          onClick={() => onCancel(act)}
          className="rounded-lg border border-hairline px-3 py-1.5 text-[0.8em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('books.approval.cancelDecision')}
        </button>
        <button
          type="button"
          disabled={!reasonValid || busy}
          onClick={() => onConfirm(act)}
          className={cn(
            'rounded-lg border border-transparent px-4 py-1.5 text-[0.8em] font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            act === 'return' ? 'bg-warning hover:bg-warning/90' : 'bg-accent hover:bg-accent/90',
          )}
        >
          {act === 'return' ? t('books.approval.return') : t('books.approval.reject')}
        </button>
      </div>
    </>
  )
}
