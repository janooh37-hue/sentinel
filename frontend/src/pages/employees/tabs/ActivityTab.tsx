/**
 * Activity tab: the employee's activity statement for a chosen period.
 * A period header, a one-sentence summary, category toggles that filter the
 * list, entries grouped by month that expand in place, and a placement rail.
 * The period lives in the URL (`period`, or `from` + `to` for a custom range).
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { siteToday } from '@/components/employees/useAttendanceAttention'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, apiErrorMessage } from '@/lib/api'
import type { PreviewDoc } from '@/lib/docPreview'
import { useCapabilities } from '@/lib/useCapabilities'
import { useServiceLabel } from '@/pages/books/serviceLabels'
import type { Tab } from '../EmployeeTabChips'
import { ActivityCategoryFilter } from '../activity/ActivityCategoryFilter'
import { ActivityEntry, type EntryActions } from '../activity/ActivityEntry'
import { ActivityPeriodHeader } from '../activity/ActivityPeriodHeader'
import { countActivity, documentName, summarySentence } from '../activity/activitySentence'
import {
  ACTIVITY_STATEMENT_QUERY,
  activityPeriod,
  activityPrintPath,
  categoryOf,
  formatStatementMonth,
  isIsoDate,
  STATEMENT_CATEGORIES,
  type ActivityPreset,
  type Period,
  type StatementCategory,
} from '../statement/statementModel'
import type { ActivityStatementItem } from '../statement/statementTypes'

const PRESETS = new Set<string>(['month', 'last3', 'year', 'all', 'custom'])

interface PeriodState {
  preset: ActivityPreset
  period: Period
  customFrom: string
  customTo: string
}

/** Read the period from the URL; anything missing or malformed falls back to this year. */
function periodFromSearch(params: URLSearchParams, today: string): PeriodState {
  const raw = params.get('period')
  const preset = (raw && PRESETS.has(raw) ? raw : 'year') as ActivityPreset
  const customFrom = params.get('from') ?? ''
  const customTo = params.get('to') ?? ''
  if (preset === 'custom') {
    // Malformed or impossible dates (2026-02-30) are not a period: use this year.
    if (!isIsoDate(customFrom) || !isIsoDate(customTo) || customFrom > customTo) return periodFromSearch(new URLSearchParams(), today)
    return { preset, period: { from: customFrom, to: customTo }, customFrom, customTo }
  }
  return { preset, period: activityPeriod(preset, today) ?? { from: null, to: today }, customFrom: '', customTo: '' }
}

interface Props {
  employeeId: string
  onPreviewDocs: (docs: PreviewDoc[], index?: number) => void
  onOpenViolation: (id: number) => void
  onOpenTab: (tab: Tab) => void
}

export function ActivityTab({
  employeeId,
  onPreviewDocs,
  onOpenViolation,
  onOpenTab,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const language = i18n.language
  const navigate = useNavigate()
  const serviceLabel = useServiceLabel()
  const { has } = useCapabilities()
  const [searchParams, setSearchParams] = useSearchParams()
  const [hidden, setHidden] = useState<ReadonlySet<StatementCategory>>(new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const canViewEmployee = has('employees.view')
  const canViewLeaves = canViewEmployee && has('leaves.view')
  const unavailable = useMemo<ReadonlySet<StatementCategory>>(
    () => (canViewLeaves ? new Set() : new Set<StatementCategory>(['leave', 'absence'])),
    [canViewLeaves],
  )

  const today = siteToday()
  const { preset, period, customFrom, customTo } = periodFromSearch(searchParams, today)
  const fromDate = period.from
  const toDate = period.to

  const statement = useQuery({
    queryKey: [ACTIVITY_STATEMENT_QUERY, employeeId, fromDate, toDate],
    queryFn: () =>
      api.getActivityStatement(employeeId, { ...(fromDate ? { from_date: fromDate } : {}), to_date: toDate }),
    enabled: canViewEmployee,
  })

  const items = useMemo(() => statement.data?.items ?? [], [statement.data])
  const counts = useMemo(() => {
    const byCategory = Object.fromEntries(STATEMENT_CATEGORIES.map((c) => [c, 0])) as Record<StatementCategory, number>
    for (const item of items) byCategory[categoryOf(item.kind)] += 1
    return byCategory
  }, [items])
  const visible = useMemo(() => items.filter((item) => !hidden.has(categoryOf(item.kind))), [items, hidden])
  const months = useMemo(() => {
    const groups: { key: string; first: string; entries: ActivityStatementItem[] }[] = []
    for (const item of visible) {
      const key = item.occurred_at.slice(0, 7)
      const last = groups[groups.length - 1]
      if (last?.key === key) last.entries.push(item)
      else groups.push({ key, first: item.occurred_at, entries: [item] })
    }
    return groups
  }, [visible])

  const writePeriod = (next: { period: ActivityPreset; from?: string; to?: string }): void => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous)
        params.set('period', next.period)
        if (next.period === 'custom') {
          params.set('from', next.from ?? '')
          params.set('to', next.to ?? '')
        } else {
          params.delete('from')
          params.delete('to')
        }
        return params
      },
      { replace: true },
    )
  }

  const printSearch = new URLSearchParams({ period: preset })
  if (preset === 'custom') {
    printSearch.set('from', period.from ?? '')
    printSearch.set('to', period.to)
  }

  const toggleCategory = (category: StatementCategory): void =>
    setHidden((previous) => {
      const next = new Set(previous)
      if (!next.delete(category)) next.add(category)
      return next
    })
  const toggleEntry = (key: string): void =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const actionsFor = (item: ActivityStatementItem): EntryActions => {
    const linked = item.linked_documents.map((doc) => ({ id: doc.id, name: serviceLabel(doc.template_id) }))
    const previewLinked = (index: number): void => onPreviewDocs(linked, index)
    const none = { action: null, linkedDocuments: linked, previewLinked }
    switch (item.kind) {
      case 'document':
        return {
          ...none,
          action: {
            label: 'previewDocument',
            run: () =>
              onPreviewDocs([{ id: item.source_id, name: documentName(item, language) }]),
          },
        }
      case 'leave':
        return linked.length > 0
          ? none
          : { ...none, action: { label: 'openLeaves', run: () => onOpenTab('leaves') } }
      case 'violation':
        return linked.length > 0
          ? none
          : { ...none, action: { label: 'openViolation', run: () => onOpenViolation(item.source_id) } }
      case 'ledger':
        return { ...none, action: { label: 'openLedger', run: () => navigate(`/ledger?mail=${item.source_id}`) } }
      case 'absence':
        return { ...none, action: { label: 'openAbsences', run: () => onOpenTab('absences') } }
      case 'duty_location':
      case 'status':
        return none
    }
  }

  if (!canViewEmployee) return <p role="alert">{t('common.forbidden')}</p>

  const summary = summarySentence(countActivity(items), t, language)

  return (
    <div className="min-w-0">
      <div className="min-w-0 space-y-5">
        <ActivityPeriodHeader
          period={period}
          preset={preset}
          customFrom={customFrom}
          customTo={customTo}
          language={language}
          onPrint={() => navigate(activityPrintPath(employeeId, printSearch.toString()))}
          onPreset={(next) =>
            writePeriod(next === 'custom' ? { period: next, from: period.from ?? '', to: period.to } : { period: next })
          }
          onCustom={(from, to) => writePeriod({ period: 'custom', from, to })}
        />

        {statement.isPending ? (
          <div className="space-y-3" data-testid="activity-loading" aria-busy="true">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-14 w-full" />
            ))}
          </div>
        ) : statement.isError ? (
          <div role="alert" className="space-y-3 rounded-2xl border border-hairline bg-surface p-6">
            <p className="text-sm text-foreground">{apiErrorMessage(statement.error)}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => void statement.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-base leading-relaxed text-foreground" data-testid="activity-summary">
              {summary}
            </p>
            {statement.data.truncated ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('activityStatement.truncated')}
              </p>
            ) : null}
            {items.length > 0 ? (
              <>
                <ActivityCategoryFilter
                  counts={counts}
                  hidden={hidden}
                  unavailable={unavailable}
                  shown={visible.length}
                  total={items.length}
                  onToggle={toggleCategory}
                />
                {months.map((month) => (
                  <section key={month.key} aria-label={formatStatementMonth(month.first, language)} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-sm font-semibold text-foreground">{formatStatementMonth(month.first, language)}</h3>
                      <span className="text-xs text-muted-foreground">
                        {t('activityStatement.entries', { count: month.entries.length })}
                      </span>
                    </div>
                    <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface">
                      {month.entries.map((item) => {
                        const key = `${item.kind}-${item.source_id}`
                        return (
                          <ActivityEntry
                            key={key}
                            item={item}
                            language={language}
                            expanded={expanded.has(key)}
                            onToggle={() => toggleEntry(key)}
                            actions={actionsFor(item)}
                          />
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
