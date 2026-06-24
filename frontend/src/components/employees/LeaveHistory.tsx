/**
 * Read-only leave history table for the Employees → Leaves inner tab. Phase
 * 06 owns full leave management; we render the rows in reverse chronological
 * order with numeric columns LTR-locked so Arabic mode doesn't reorder dates.
 */

import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { LeaveRead } from '@/lib/api'

export function LeaveHistory({ rows }: { rows: LeaveRead[] }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('employees.tabs.leaves')}</CardTitle>
        <span className="font-mono text-xs text-muted-foreground">{rows.length}</span>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t('leaves.empty')}
          </p>
        ) : (
          <Table className="border-0">
            <TableHeader>
              <TableRow>
                <TableHead>{t('leaves.fields.leave_type')}</TableHead>
                <TableHead className="w-[120px]">{t('leaves.fields.start_date')}</TableHead>
                <TableHead className="w-[120px]">{t('leaves.fields.end_date')}</TableHead>
                <TableHead className="w-[80px]">{t('leaves.fields.days')}</TableHead>
                <TableHead className="w-[110px]">{t('leaves.fields.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.leave_type}</TableCell>
                  <TableCell className="font-mono" dir="ltr">
                    {row.start_date}
                  </TableCell>
                  <TableCell className="font-mono" dir="ltr">
                    {row.end_date}
                  </TableCell>
                  <TableCell className="font-mono">{row.days}</TableCell>
                  <TableCell>
                    <Badge tone="neutral">{row.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
