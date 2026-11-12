/**
 * GradeSelect — pick a record's grade. Secret is offered only to
 * users with Secret clearance (`books.secret`), or when it is already the value.
 */
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { Grade } from '@/lib/api'
import { GRADES, GRADE_META } from './grades'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'

interface Props {
  value: Grade
  onChange: (value: Grade) => void
  disabled?: boolean
  className?: string
  allowedLevels?: readonly Grade[]
}

export function GradeSelect({ value, onChange, disabled, className, allowedLevels }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const id = useId()
  const levels = GRADES.filter(
    (level) => (allowedLevels == null || allowedLevels.includes(level))
      && (level !== 'secret' || value === 'secret' || has('books.secret')),
  )
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[0.78em] font-semibold text-muted-foreground">
        {t('books.grade.label')}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value as Grade)}
        className="min-h-10 w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.84em] text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
      >
        {levels.map((level) => (
          <option key={level} value={level}>
            {t(GRADE_META[level].label)}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="text-[0.76em] text-muted-foreground">
        {t(`books.grade.hints.${value}`)}
      </p>
    </div>
  )
}
