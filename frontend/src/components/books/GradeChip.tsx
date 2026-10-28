import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Grade } from '@/lib/api'
import { cn } from '@/lib/utils'
import { GRADE_META } from './grades'
import { MARK_ICON_CLASS, MARK_STROKE_WIDTH } from './markSize'

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

/**
 * GradeMark — the record grade as a bare glyph (unclassified shows nothing).
 * By default icon only: `role="img"` named "Record grade: <level>" (the name
 * joins a row button's accessible name) with a hover tooltip, never focusable,
 * since it sits inside row `<button>`s. `showLabel` adds the visible level for
 * the record header line and metadata-only rows.
 */
export function GradeMark({
  level,
  showLabel = false,
  className,
}: {
  level: Grade | null | undefined
  showLabel?: boolean
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!level || level === 'unclassified') return null
  const { icon: Icon, label } = GRADE_META[level]
  const name = t('books.grade.chipTitle', { level: t(label) })
  const tone = level === 'secret' || level === 'top_secret' ? 'text-destructive' : 'text-muted-foreground'
  const glyph = <Icon className={MARK_ICON_CLASS} strokeWidth={MARK_STROKE_WIDTH} aria-hidden="true" />
  if (showLabel) {
    return (
      <span data-testid="grade-mark" title={name} className={cn('inline-flex items-center gap-1 whitespace-nowrap font-medium', tone, className)}>
        {glyph}
        {t(label)}
      </span>
    )
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span role="img" data-testid="grade-mark" data-grade={level} aria-label={name} className={cn('inline-flex shrink-0 items-center', tone, className)}>{glyph}</span>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
