/**
 * Documents tab — renders recent documents as a TAMM tile grid.
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { DocumentTile, type TileAccent, type TileVariant } from '@/components/ui/document-tile'
import type { RecentDocumentRead } from '@/lib/api'

const STATE_CHIP: Record<string, string> = {
  none: 'bg-warning-soft text-warning',
  pending: 'bg-warning-soft text-warning',
  approved: 'bg-success-soft text-success',
  returned: 'bg-info-soft text-info',
  rejected: 'bg-destructive/10 text-destructive',
}
const STATE_LABEL: Record<string, string> = {
  none: 'books.approval.stateDraft',
  pending: 'books.approval.statePending',
  approved: 'books.approval.stateApproved',
  returned: 'books.approval.stateReturned',
  rejected: 'books.approval.stateRejected',
}

/**
 * Best-effort visual classification of a `template_id`. Falls back to a plain
 * paper/primary tile when nothing matches.
 */
function tileConfig(templateId: string): { variant: TileVariant; accent: TileAccent } {
  const id = templateId.toLowerCase()
  if (id.includes('emirates') || id.includes('id_card')) return { variant: 'id-card', accent: 'primary' }
  if (id.includes('resign')) return { variant: 'paper', accent: 'accent' }
  if (id.includes('violation') || id.includes('warning')) return { variant: 'letter', accent: 'accent' }
  if (id.includes('acknowledg') || id.includes('clearance')) return { variant: 'paper', accent: 'success' }
  if (id.includes('leave')) return { variant: 'letter', accent: 'warning' }
  if (id.includes('hr_request')) return { variant: 'letter', accent: 'primary' }
  return { variant: 'paper', accent: 'primary' }
}

interface Props {
  docs: RecentDocumentRead[]
  employeeName: string
  totalCount?: number
}

export function DocumentsTab({ docs, employeeName, totalCount }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
    [i18n.language],
  )

  if (docs.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">
        {t('employee.docs.empty')}
      </div>
    )
  }

  const isPartial = totalCount !== undefined && docs.length < totalCount

  return (
    <>
      <div className="mb-3.5 text-[0.92em] font-medium">
        {t('employee.docs.total', { count: docs.length, name: employeeName })}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {docs.map((d) => {
          const cfg = tileConfig(d.template_id)
          const state = d.approval_state ?? undefined
          const chip = state ? (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.68em] font-semibold ${STATE_CHIP[state] ?? 'bg-surface-tinted text-muted-foreground'}`}>
              {t(STATE_LABEL[state] ?? state)}
            </span>
          ) : undefined
          return (
            <DocumentTile
              key={d.id}
              variant={cfg.variant}
              accent={cfg.accent}
              type={d.template_id.replace(/_/g, ' ')}
              title={d.ref_number || d.template_id}
              meta={dateFmt.format(new Date(d.created_at))}
              statusChip={chip}
              onClick={d.book_id != null ? () => navigate(`/books?open=${d.book_id}`) : undefined}
            />
          )
        })}
      </div>
      {isPartial && (
        <div className="mt-3 text-center text-[0.8em] text-muted-foreground">
          {t('employee.tab.showingRecent', { shown: docs.length, total: totalCount, defaultValue: `Showing ${docs.length} of ${totalCount}` })}
        </div>
      )}
    </>
  )
}
