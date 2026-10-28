import { useTranslation } from 'react-i18next'
import type { Grade } from '@/lib/api'
import { cn } from '@/lib/utils'
import { GRADE_META } from './grades'

export function GradeChip({
  level,
  className,
}: {
  level: Grade | null | undefined
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!level || level === 'unclassified') return null
  const { icon: Icon, className: tone, label } = GRADE_META[level]
  return (
    <span
      data-testid="grade-chip"
      title={t('books.grade.chipTitle', { level: t(label) })}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em]',
        tone,
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden="true" />}
      {t(label)}
    </span>
  )
}

export function GradeMark({
  level,
  className,
}: {
  level: Grade | null | undefined
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!level || level === 'unclassified') return null
  const { icon: Icon, label } = GRADE_META[level]
  return (
    <span
      data-testid="grade-mark"
      title={t('books.grade.chipTitle', { level: t(label) })}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap font-medium',
        level === 'secret' || level === 'top_secret' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />}
      {t(label)}
    </span>
  )
}
