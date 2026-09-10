import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

import type { InmateRegisterEntry, InmateRegisterMonth } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatRegisterDate } from './registerModel'

interface WarningsStripProps {
  month: InmateRegisterMonth
  isWriting: boolean
  onDeleteManual: (rowId: number) => void
}

export function WarningsStrip({
  month,
  isWriting,
  onDeleteManual,
}: WarningsStripProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [deleteEntry, setDeleteEntry] = useState<InmateRegisterEntry | null>(null)
  const duplicates = month.entries.filter(
    (entry) => entry.origin === 'manual' && entry.duplicate_of != null,
  )
  const arrivals = month.closed ? month.arrived_after_close : []
  const count = month.uncounted.length + duplicates.length + arrivals.length
  if (count === 0) return null

  return (
    <section className="rounded-lg border border-hairline bg-surface">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          {t('inmateStats.warnings.title')}
          <Badge tone="warning" shape="pill" className="font-mono" dir="ltr">
            {count}
          </Badge>
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4" aria-hidden />
        )}
      </button>

      {expanded ? (
        <div className="space-y-4 border-t border-hairline p-3">
          {month.uncounted.length > 0 ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                {t('inmateStats.warnings.uncounted')}
              </h3>
              <div className="space-y-2">
                {month.uncounted.map((warning) => (
                  <div key={warning.book_id} className="rounded-md bg-surface-tinted p-3 text-sm">
                    <Link
                      to={`/books/${warning.book_id}`}
                      className="font-mono text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <bdi dir="ltr">{warning.ref_number}</bdi>
                    </Link>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {t('inmateStats.warnings.uncountedReason.no_violation_date')}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {duplicates.length > 0 ? (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">
                {t('inmateStats.warnings.duplicates')}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('inmateStats.warnings.duplicatesHint')}
              </p>
              <div className="mt-2 space-y-2">
                {duplicates.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-tinted p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium" dir="auto">
                        {entry.name}
                      </p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">
                        {formatRegisterDate(entry.violation_date, i18n.language)}
                      </p>
                    </div>
                    {!month.closed && entry.manual?.row_id != null ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="destructive"
                        disabled={isWriting}
                        onClick={() => setDeleteEntry(entry)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        {t('inmateStats.actions.delete')}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {arrivals.length > 0 ? (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">
                {t('inmateStats.warnings.arrivedAfterClose')}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('inmateStats.warnings.arrivedAfterCloseHint')}
              </p>
              <div className="mt-2 space-y-2">
                {arrivals.map((entry) => (
                  <div key={entry.id} className="rounded-md bg-surface-tinted p-3 text-sm">
                    <p className="font-medium" dir="auto">
                      {entry.name}
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">
                      {formatRegisterDate(entry.violation_date, i18n.language)}
                    </p>
                    {entry.source_book_id != null ? (
                      <Link
                        to={`/books/${entry.source_book_id}`}
                        className="mt-1 inline-block font-mono text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <bdi dir="ltr">{entry.ref_number ?? ''}</bdi>
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteEntry != null}
        onOpenChange={(open) => {
          if (!open) setDeleteEntry(null)
        }}
        title={t('inmateStats.manualForm.deleteTitle')}
        description={t('inmateStats.manualForm.deleteConfirm')}
        confirmLabel={t('inmateStats.actions.delete')}
        destructive
        onConfirm={() => {
          const rowId = deleteEntry?.manual?.row_id
          if (rowId != null) onDeleteManual(rowId)
          setDeleteEntry(null)
        }}
      />
    </section>
  )
}
