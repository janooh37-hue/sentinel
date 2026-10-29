import { AlertTriangle, ArrowLeftRight, Check, FileText, MailIcon, Plane, UserX } from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { STATEMENT_CATEGORIES, type StatementCategory } from '../statement/statementModel'

const ICONS: Record<StatementCategory, ComponentType<{ className?: string }>> = {
  leave: Plane,
  violation: AlertTriangle,
  absence: UserX,
  document: FileText,
  ledger: MailIcon,
  placement: ArrowLeftRight,
}

interface Props {
  counts: Record<StatementCategory, number>
  hidden: ReadonlySet<StatementCategory>
  /** Categories the caller may not see at all; they are not drawn. */
  unavailable: ReadonlySet<StatementCategory>
  shown: number
  total: number
  onToggle: (category: StatementCategory) => void
}

export function ActivityCategoryFilter({ counts, hidden, unavailable, shown, total, onToggle }: Props): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <div role="group" aria-label={t('activityStatement.filterLabel')} className="flex flex-wrap gap-2">
        {STATEMENT_CATEGORIES.filter((category) => !unavailable.has(category)).map((category) => {
          const on = !hidden.has(category)
          const Icon = ICONS[category]
          return (
            <button
              key={category}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(category)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-surface text-muted-foreground hover:bg-surface-tinted',
              )}
            >
              {on ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Icon className="h-3.5 w-3.5" aria-hidden />}
              <span>{t(`statement.category.${category}`)}</span>
              <span className="tabular-nums text-muted-foreground">{counts[category]}</span>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="activity-showing">
        {t('activityStatement.showing', { shown, count: total })}
      </p>
    </div>
  )
}
