/**
 * Warning card listing missing employee fields (profile completeness gaps).
 *
 * Renders nothing when the employee has no missing fields.
 * Each field row calls onFix(fieldKey); the "Complete now" footer calls onFix().
 */

import { useTranslation } from 'react-i18next'

interface CompletenessShape {
  filled: number
  tracked: number
}

interface Props {
  missing: string[]
  completeness: CompletenessShape
  onFix: (field?: string) => void
}

export function EmployeeGapsCard({ missing, completeness, onFix }: Props): React.JSX.Element | null {
  const { t } = useTranslation()

  if (missing.length === 0) return null

  return (
    <div
      className="rounded-[var(--r-lg,16px)] border border-[#f0ddb8] p-4"
      style={{ background: 'var(--warning-soft)' }}
    >
      <div className="mb-1 text-[0.82em] font-semibold" style={{ color: 'var(--warning)' }}>
        {t('employee.gaps.title', {
          count: missing.length,
          filled: completeness.filled,
          tracked: completeness.tracked,
        })}
      </div>
      <p className="mb-3 text-[0.78em] text-muted-foreground">{t('employee.gaps.hint')}</p>
      <ul className="space-y-1.5">
        {missing.map((f) => (
          <li key={f}>
            <button
              type="button"
              onClick={() => onFix(f)}
              className="flex w-full items-center justify-between rounded-lg bg-white/60 px-3 py-2 text-start text-[0.8em] transition-colors hover:bg-white/80"
            >
              <span>{t(`employee.field.${f}`)}</span>
              <span className="opacity-80" style={{ color: 'var(--warning)' }}>
                {t('employee.gaps.add')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onFix()}
        className="mt-3 w-full rounded-lg bg-white/60 px-3 py-2 text-[0.8em] font-semibold text-foreground transition-colors hover:bg-white/80"
      >
        {t('employee.gaps.fixAll')}
      </button>
    </div>
  )
}
