import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LockKeyhole, PenLine, Trash2 } from 'lucide-react'

import type {
  InmateCompletionIn,
  InmateManualRowIn,
  InmateManualRowPatch,
  InmateRegisterEntry,
  InmateRegisterMonth,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CompletionForm } from './CompletionForm'
import { ManualEntryForm } from './ManualEntryForm'
import { formatRegisterDate, formatRegisterDateTime } from './registerModel'

export type InspectorMode = 'view' | 'create' | 'edit'

interface EntryInspectorProps {
  month: InmateRegisterMonth
  entry: InmateRegisterEntry | null
  mode: InspectorMode
  reportEntries: readonly InmateRegisterEntry[]
  isWriting: boolean
  onModeChange: (mode: InspectorMode) => void
  onCreate: (body: InmateManualRowIn) => void
  onUpdate: (args: { rowId: number; body: InmateManualRowPatch }) => void
  onDelete: (rowId: number) => void
  onComplete: (args: { bookId: number; body: InmateCompletionIn }) => void
}

interface FieldValueProps {
  label: string
  value: string | number | null | undefined
  ltr?: boolean
  incomplete?: boolean
}

function FieldValue({
  label,
  value,
  ltr = false,
  incomplete = false,
}: FieldValueProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 border-b border-hairline py-2.5 last:border-b-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground" dir={ltr ? 'ltr' : 'auto'}>
        {value ?? ''}
        {incomplete ? (
          <Badge tone="warning" className="ms-2 align-middle">
            {t('inmateStats.inspector.incompleteMark')}
          </Badge>
        ) : null}
      </dd>
    </div>
  )
}

export function SealedStrip({ month }: { month: InmateRegisterMonth }): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  if (!month.closed || !month.closed_at) return null
  return (
    <div className="rounded-lg border border-hairline bg-surface-tinted p-3">
      <div className="flex items-start gap-2">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">{t('inmateStats.sealed.strip')}</p>
          <p className="text-xs text-muted-foreground">
            {t('inmateStats.sealed.closedAt')}:{' '}
            <bdi dir="ltr">{formatRegisterDateTime(month.closed_at, i18n.language)}</bdi>
          </p>
          <p className="text-xs text-muted-foreground">
            {t('inmateStats.sealed.closedBy')}: {month.closed_by_name ?? ''}
          </p>
          {month.workflow.legacy && month.workflow.legacy_metadata?.force_closed === true ? (
            <>
              <Badge tone="warning">{t('inmateStats.sealed.forced')}</Badge>
              {typeof month.workflow.legacy_metadata?.force_reason === 'string' ? (
                <p className="text-xs text-muted-foreground" dir="auto">
                  {t('inmateStats.sealed.reason')}: {month.workflow.legacy_metadata.force_reason}
                </p>
              ) : null}
            </>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('inmateStats.inspector.closedReadOnly')}</p>
        </div>
      </div>
    </div>
  )
}

export function EntryInspector({
  month,
  entry,
  mode,
  reportEntries,
  isWriting,
  onModeChange,
  onCreate,
  onUpdate,
  onDelete,
  onComplete,
}: EntryInspectorProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [deleteOpen, setDeleteOpen] = useState(false)

  if (!month.closed && mode === 'create') {
    return (
      <ManualEntryForm
        entry={null}
        wings={month.wing_summary.counts.map((item) => item.wing)}
        year={month.year}
        month={month.month}
        isWriting={isWriting}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onCancel={() => onModeChange('view')}
      />
    )
  }

  if (!entry) {
    return (
      <div className="flex min-h-52 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {t('inmateStats.inspector.empty')}
      </div>
    )
  }

  if (!month.closed && entry.origin === 'manual' && entry.missing.length > 0) {
    return (
      <ManualEntryForm
        entry={entry}
        wings={month.wing_summary.counts.map((item) => item.wing)}
        year={month.year}
        month={month.month}
        isWriting={isWriting}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={() => {
          const rowId = entry.manual?.row_id
          if (rowId != null) onDelete(rowId)
        }}
      />
    )
  }

  if (!month.closed && mode === 'edit' && entry.origin === 'manual') {
    return (
      <ManualEntryForm
        entry={entry}
        wings={month.wing_summary.counts.map((item) => item.wing)}
        year={month.year}
        month={month.month}
        isWriting={isWriting}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={() => {
          const rowId = entry.manual?.row_id
          if (rowId != null) onDelete(rowId)
        }}
        onCancel={() => onModeChange('view')}
      />
    )
  }

  if (!month.closed && entry.missing.length > 0 && entry.completion_book_id != null) {
    return (
      <CompletionForm
        key={entry.completion_book_id}
        sourceEntry={entry}
        wings={month.wing_summary.counts.map((item) => item.wing)}
        reportEntries={reportEntries}
        isWriting={isWriting}
        onComplete={onComplete}
      />
    )
  }

  const marked = new Set(entry.incomplete_marks)
  const sourcePath = entry.source_book_id == null ? null : `/books/${entry.source_book_id}`
  const createdAt =
    entry.manual?.created_at != null
      ? formatRegisterDateTime(entry.manual.created_at, i18n.language)
      : ''
  const createdAtToken = '__REGISTER_CREATED_AT__'
  const [createdBefore, createdAfter = ''] = entry.manual
    ? t('inmateStats.inspector.createdBy', {
        name: entry.manual.created_by_name ?? '',
        date: createdAtToken,
      }).split(createdAtToken)
    : ['', '']

  return (
    <div className="space-y-5">

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {t('inmateStats.inspector.title')}
          </p>
          <h3 className="mt-1 truncate text-base font-semibold" dir="auto">
            {entry.name}
          </h3>
        </div>
        {entry.manual ? <Badge tone="info">{t('inmateStats.inspector.manualBadge')}</Badge> : null}
      </div>

      <dl className="rounded-lg border border-hairline bg-surface px-3">
        <FieldValue label={t('inmateStats.columns.no')} value={entry.row_no} ltr />
        <FieldValue label={t('inmateStats.columns.name')} value={entry.name} />
        <FieldValue label={t('inmateStats.columns.uid')} value={entry.uid} ltr />
        {entry.population !== 'citizens' ? (
          <FieldValue
            label={t('inmateStats.columns.nationality')}
            value={entry.nationality_label}
            incomplete={marked.has('nationality')}
          />
        ) : null}
        <FieldValue
          label={t('inmateStats.columns.date')}
          value={formatRegisterDate(entry.violation_date, i18n.language)}
          ltr
        />
        <FieldValue
          label={t('inmateStats.columns.dutyUnit')}
          value={entry.duty_unit}
          incomplete={marked.has('duty_unit')}
        />
      </dl>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t('inmateStats.columns.details')}
        </h4>
        <p
          className="mt-2 whitespace-pre-line rounded-lg border border-hairline bg-surface-tinted p-3 text-sm leading-7"
          dir="auto"
        >
          {entry.details_text}
          {marked.has('details') ? (
            <Badge tone="warning" className="ms-2 align-middle">
              {t('inmateStats.inspector.incompleteMark')}
            </Badge>
          ) : null}
        </p>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t('inmateStats.inspector.record')}
        </h4>
        {entry.origin === 'derived' && sourcePath ? (
          <div className="mt-2 rounded-lg border border-hairline p-3">
            <Link
              to={sourcePath}
              className="font-mono text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <bdi dir="ltr">{entry.source_ref_number ?? ''}</bdi>
            </Link>
          </div>
        ) : entry.manual ? (
          <div className="mt-2 space-y-2 rounded-lg border border-hairline p-3">
            <Badge tone="info">{t('inmateStats.inspector.manualBadge')}</Badge>
            <p className="text-xs font-medium text-muted-foreground">
              {t('inmateStats.inspector.manualReason')}
            </p>
            <p className="text-sm leading-relaxed" dir="auto">
              {entry.manual.reason ?? ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {createdBefore}
              <bdi dir="ltr">{createdAt}</bdi>
              {createdAfter}
            </p>
          </div>
        ) : null}
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t('inmateStats.inspector.reporter')}
        </h4>
        <dl className="mt-2 rounded-lg border border-hairline bg-surface px-3">
          <FieldValue label={t('inmateStats.inspector.reporter')} value={entry.reporter_name} />
          <FieldValue label={t('inmateStats.inspector.wing')} value={entry.wing} ltr incomplete={entry.missing.includes('wing')} />
          <FieldValue label={t('inmateStats.inspector.holdingNo')} value={entry.holding_no} ltr />
        </dl>
      </section>

      {!month.closed && entry.origin === 'derived' ? (
        <div className="rounded-lg border border-hairline bg-surface-tinted p-3 text-xs leading-relaxed text-muted-foreground">
          <p>{t('inmateStats.inspector.derivedReadOnly')}</p>
          {sourcePath ? (
            <Link
              to={sourcePath}
              className="mt-2 inline-block font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('inmateStats.inspector.openRecord')} <bdi dir="ltr">{entry.source_ref_number ?? ''}</bdi>
            </Link>
          ) : null}
        </div>
      ) : null}

      {!month.closed && entry.origin === 'manual' && entry.manual?.row_id != null ? (
        <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
          <Button type="button" size="sm" variant="secondary" onClick={() => onModeChange('edit')}>
            <PenLine className="h-4 w-4" aria-hidden />
            {t('inmateStats.actions.edit')}
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" aria-hidden />
            {t('inmateStats.actions.delete')}
          </Button>
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={t('inmateStats.manualForm.deleteTitle')}
            description={t('inmateStats.manualForm.deleteConfirm')}
            confirmLabel={t('inmateStats.actions.delete')}
            destructive
            onConfirm={() => onDelete(entry.manual?.row_id as number)}
          />
        </div>
      ) : null}
    </div>
  )
}
