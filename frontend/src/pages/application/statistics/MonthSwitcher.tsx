import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRegisterMonth, shiftMonth } from './registerModel'

interface MonthSwitcherProps {
  year: number
  month: number
  closed: boolean
  onChange: (coordinate: { year: number; month: number }) => void
}

export function MonthSwitcher({
  year,
  month,
  closed,
  onChange,
}: MonthSwitcherProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={t('inmateStats.month.previous')}
        onClick={() => onChange(shiftMonth(year, month, -1))}
      >
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
      </Button>
      <div className="min-w-44 rounded-lg border border-hairline bg-surface-tinted px-3 py-2 text-center">
        <span className="block text-[0.68rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {t('inmateStats.month.label')}
        </span>
        <bdi dir="ltr" className="mt-0.5 block text-sm font-semibold">
          {formatRegisterMonth(year, month, i18n.language)}
        </bdi>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={t('inmateStats.month.next')}
        onClick={() => onChange(shiftMonth(year, month, 1))}
      >
        <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
      </Button>
      <Badge tone={closed ? 'neutral' : 'active'} withDot>
        {t(closed ? 'inmateStats.month.closed' : 'inmateStats.month.open')}
      </Badge>
    </div>
  )
}
