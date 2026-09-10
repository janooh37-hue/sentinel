import { useTranslation } from 'react-i18next'

import type { InmatePopulation, InmateRegisterEntry } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatRegisterDate } from './registerModel'

interface RegisterIndexProps {
  entries: readonly InmateRegisterEntry[]
  population: InmatePopulation
  expanded: boolean
  selectedId: string | null
  onSelect: (entry: InmateRegisterEntry) => void
}

export function RegisterIndex({
  entries,
  population,
  expanded,
  selectedId,
  onSelect,
}: RegisterIndexProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isExpat = population === 'expats'
  const columnCount = isExpat ? (expanded ? 7 : 6) : expanded ? 6 : 5

  return (
    <div className="max-h-[62vh] overflow-auto rounded-md [&>div]:overflow-visible">
      <Table className={isExpat ? 'min-w-[760px]' : 'min-w-[680px]'}>
        <TableHeader className="sticky top-0 z-10 border-b border-hairline bg-surface-raised">
          <TableRow className="hover:bg-surface-raised">
            <TableHead className="w-12">{t('inmateStats.columns.no')}</TableHead>
            <TableHead className="min-w-48">{t('inmateStats.columns.name')}</TableHead>
            <TableHead className="min-w-36">{t('inmateStats.columns.uid')}</TableHead>
            {isExpat ? (
              <TableHead className="min-w-32">{t('inmateStats.columns.nationality')}</TableHead>
            ) : null}
            <TableHead className="min-w-32">{t('inmateStats.columns.date')}</TableHead>
            <TableHead className="min-w-36">{t('inmateStats.columns.dutyUnit')}</TableHead>
            {expanded ? (
              <TableHead className="max-w-[28rem]">{t('inmateStats.columns.details')}</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-10 text-center text-muted-foreground">
                {t('inmateStats.index.emptyPopulation')}
              </TableCell>
            </TableRow>
          ) : null}
          {entries.map((entry) => {
            const selected = entry.id === selectedId
            return (
              <TableRow
                key={entry.id}
                aria-selected={selected}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(entry)}
                className={selected ? 'bg-primary-soft hover:bg-primary-soft' : 'cursor-pointer'}
              >
                <TableCell className="font-mono text-xs tabular-nums text-muted-foreground" dir="ltr">
                  {entry.row_no}
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelect(entry)
                    }}
                    className="w-full rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label={t('inmateStats.index.selectRow')}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium" dir="auto">
                        {entry.name}
                      </span>
                      {entry.manual ? (
                        <Badge tone="info">{t('inmateStats.inspector.manualBadge')}</Badge>
                      ) : null}
                      {entry.missing.length > 0 ? (
                        <Badge tone="warning">{t('inmateStats.inspector.pendingCompletion')}</Badge>
                      ) : null}
                    </span>
                  </button>
                </TableCell>
                <TableCell className="font-mono text-xs" dir="ltr">
                  {entry.uid}
                </TableCell>
                {isExpat ? <TableCell dir="auto">{entry.nationality_label}</TableCell> : null}
                <TableCell className="whitespace-nowrap font-mono text-xs" dir="ltr">
                  {formatRegisterDate(entry.violation_date, i18n.language)}
                </TableCell>
                <TableCell dir="auto">{entry.duty_unit}</TableCell>
                {expanded ? (
                  <TableCell className="max-w-[28rem]">
                    <span className="block max-w-[28rem] truncate text-muted-foreground" dir="auto">
                      {entry.details_text}
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
