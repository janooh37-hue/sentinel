import { useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Columns3, UserRoundPlus } from 'lucide-react'

import { ApiError, type InmatePopulation, type InmateRegisterEntry } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WorkflowControls } from './WorkflowControls'
import { ViolationMonthsWidget } from '@/pages/dashboard/widgets/ViolationMonthsWidget'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EntryInspector, SealedStrip, type InspectorMode } from './EntryInspector'
import { ExportWorkspace } from './ExportWorkspace'
import { MonthSwitcher } from './MonthSwitcher'
import { RegisterIndex } from './RegisterIndex'
import { WarningsStrip } from './WarningsStrip'
import { formatRegisterDateTime, groupEntries, parseMonthKey, parseSubmissionId, visibleGroups } from './registerModel'
import { useInmateRegister } from './useInmateRegister'

type ViewMode = 'register' | 'export'

function initialCoordinate(raw: string | null): { year: number; month: number } {
  const parsed = raw ? parseMonthKey(raw) : null
  if (parsed) return parsed
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export function StatisticsTab(): React.JSX.Element {
  const { t } = useTranslation()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const rawMonth = searchParams.get('stats_month')
  const rawSubmission = searchParams.get('stats_submission')
  if ((rawMonth !== null && !parseMonthKey(rawMonth)) ||
    (rawSubmission !== null && (!parseSubmissionId(rawSubmission) || !rawMonth))) {
    return <p role="alert" className="p-4 text-accent">{t('inmateStats.workflow.invalidLink')}</p>
  }
  // A task may navigate to the same URL after a local history/month choice.
  // Every navigation must consume its exact coordinate and submission again.
  return <StatisticsMonth key={`${location.key}:${rawMonth}:${rawSubmission}`} />
}

function StatisticsMonth(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [searchParams] = useSearchParams()
  const [coordinate, setCoordinate] = useState(() =>
    initialCoordinate(searchParams.get('stats_month')),
  )
  const [view, setView] = useState<ViewMode>(searchParams.has('stats_submission') ? 'export' : 'register')
  const [submissionId, setSubmissionId] = useState(() => parseSubmissionId(searchParams.get('stats_submission')))
  const [selectionMade, setSelectionMade] = useState(searchParams.has('stats_submission'))
  const [population, setPopulation] = useState<InmatePopulation>('citizens')
  const [expandedColumns, setExpandedColumns] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('view')
  const [sheetOpen, setSheetOpen] = useState(false)
  const register = useInmateRegister(coordinate.year, coordinate.month, submissionId)
  const month = register.month
  const groups = groupEntries(month)
  const shownGroups = visibleGroups(groups)
  const activeGroup =
    shownGroups.find((group) => group.key === population) ?? shownGroups[0] ?? null
  const selectedEntry =
    activeGroup?.entries.find((entry) => entry.id === selectedId) ??
    activeGroup?.entries[0] ??
    null
  const reportEntries =
    selectedEntry?.completion_book_id == null || !month
      ? []
      : month.entries.filter(
          (entry) => entry.completion_book_id === selectedEntry.completion_book_id,
        )

  const openMobileInspector = (): void => {
    if (window.matchMedia('(max-width: 1023px)').matches) setSheetOpen(true)
  }

  const selectEntry = (entry: InmateRegisterEntry): void => {
    setSelectedId(entry.id)
    setInspectorMode('view')
    openMobileInspector()
  }

  const selectPopulation = (value: string): void => {
    const next = shownGroups.find((group) => group.key === value)
    if (!next) return
    setPopulation(next.key)
    setSelectedId(next.entries[0]?.id ?? null)
    setInspectorMode('view')
    setSheetOpen(false)
  }

  const changeMonth = (next: { year: number; month: number }): void => {
    setCoordinate(next)
    setPopulation('citizens')
    setSelectedId(null)
    setInspectorMode('view')
    setSheetOpen(false)
    setView('register')
    setSubmissionId(null)
    setSelectionMade(false)
  }

  const openReport = (id: number | null): void => {
    setSubmissionId(id)
    setSelectionMade(true)
    setSheetOpen(false)
    setView('export')
    register.refreshReport()
  }

  const correctEntry = (id: string): void => {
    const entry = month?.entries.find((item) => item.id === id)
    if (!entry) return
    setView('register')
    setPopulation(entry.population as InmatePopulation)
    selectEntry(entry)
  }

  const inspector = month ? (
    <EntryInspector
      key={`${coordinate.year}-${coordinate.month}-${selectedEntry?.id ?? 'new'}-${inspectorMode}`}
      month={month}
      entry={selectedEntry}
      mode={month.closed ? 'view' : inspectorMode}
      reportEntries={reportEntries}
      isWriting={register.isWriting}
      onModeChange={setInspectorMode}
      onCreate={(body) => {
        register.createManualRow(body, { onSuccess: () => setInspectorMode('view') })
      }}
      onUpdate={(args) => {
        register.updateManualRow(args, { onSuccess: () => setInspectorMode('view') })
      }}
      onDelete={(rowId) => {
        register.deleteManualRow(rowId, { onSuccess: () => {
          setSelectedId(null)
          setInspectorMode('view')
          setSheetOpen(false)
        } })
      }}
      onComplete={register.completeImport}
    />
  ) : null

  return (
    <div className="w-full space-y-4 bg-background pb-10 text-foreground">
      <header className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{t('inmateStats.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('inmateStats.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MonthSwitcher
              year={coordinate.year}
              month={coordinate.month}
              closed={month?.closed ?? false}
              onChange={changeMonth}
            />
            <div
              className="inline-flex items-center rounded-lg border border-hairline bg-surface-tinted p-1"
              role="group"
              aria-label={t('inmateStats.title')}
            >
              <Button
                type="button"
                size="xs"
                variant={view === 'register' ? 'secondary' : 'ghost'}
                aria-pressed={view === 'register'}
                onClick={() => setView('register')}
              >
                {t('inmateStats.views.register')}
              </Button>
              <Button
                type="button"
                size="xs"
                variant={view === 'export' ? 'secondary' : 'ghost'}
                aria-pressed={view === 'export'}
                disabled={!month || register.isLoading || register.isError}
                onClick={() => {
                  openReport(selectionMade ? submissionId : month?.workflow.active_submission_id ?? null)
                }}
              >
                {t('inmateStats.views.export')}
              </Button>
            </div>
          </div>
        </div>

        {month ? (
          <dl className="mt-4 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-surface-raised px-4 py-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t('inmateStats.populations.citizens')} — {t('inmateStats.counts.perTable')}
              </dt>
              <dd className="mt-1 font-mono text-2xl font-bold tabular-nums" dir="ltr">
                {month.counts.citizens}
              </dd>
            </div>
            <div className="bg-surface-raised px-4 py-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t('inmateStats.populations.expats')} — {t('inmateStats.counts.perTable')}
              </dt>
              <dd className="mt-1 font-mono text-2xl font-bold tabular-nums" dir="ltr">
                {month.counts.expats}
              </dd>
            </div>
            <div className="bg-primary-soft px-4 py-3 text-primary-on-soft">
              <dt className="text-xs font-semibold">{t('inmateStats.counts.monthTotal')}</dt>
              <dd className="mt-1 font-mono text-2xl font-extrabold tabular-nums" dir="ltr">
                {month.counts.total}
              </dd>
              {month.counts.pending > 0 ? <dd className="mt-1 text-sm">{t('inmateStats.populations.pending')}: <bdi dir="ltr">{month.counts.pending}</bdi></dd> : null}
            </div>
            <div className="min-w-0 bg-surface-raised px-4 py-3">
              <dt className="text-xs font-semibold">{t('inmateStats.counts.mostWing')}</dt>
              <dd className="mt-1 flex flex-wrap gap-x-2 font-mono text-xl font-bold">{month.wing_summary.most.length ? month.wing_summary.most.map((wing) => <bdi dir="ltr" key={wing}>{wing}</bdi>) : '—'}</dd>
              <dd className="mt-1 text-sm">{t('inmateStats.counts.perTable')}: <bdi dir="ltr">{month.wing_summary.most_count}</bdi></dd>
              {month.wing_summary.unassigned_count > 0 ? <dd className="mt-1 text-sm text-warning">{t('inmateStats.workflow.provisionalWings', { count: month.wing_summary.unassigned_count })}</dd> : null}
            </div>
          </dl>
        ) : null}
      </header>

      <div id="monthly-tasks" data-print-hide className="scroll-mt-4"><ViolationMonthsWidget compact={false} /></div>

      {month ? <div data-print-hide><WorkflowControls key={`${coordinate.year}-${coordinate.month}-${month.workflow.version}`} month={month} register={register}
        viewedSubmissionId={view === 'export' ? submissionId : null} viewedDraftFingerprint={view === 'register' || submissionId === null ? month.projection_fingerprint : null} onOpenReport={openReport} onCorrectEntry={correctEntry} /></div> : null}

      {register.isLoading ? (
        <div className="space-y-3" aria-label={t('common.loading')}>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : register.isError || !month ? (
        <div className="rounded-xl border border-hairline bg-surface p-8 text-center">
          <p role="alert" className="text-sm text-muted-foreground">{t(register.error instanceof ApiError && register.error.status === 403 ? 'inmateStats.workflow.reportForbidden' : 'common.loadError')}</p>
          <Button type="button" variant="outline" className="mt-3" onClick={register.refetch}>
            {t('common.retry')}
          </Button>
        </div>
      ) : view === 'export' ? (
        <div className="space-y-4">
          <div data-print-hide className="space-y-2 rounded-xl border border-hairline bg-surface p-4">
            <Label htmlFor="register-report-selection">{t('inmateStats.workflow.reportSelection')}</Label>
            <Select value={submissionId === null ? 'draft' : String(submissionId)} onValueChange={(value) => openReport(value === 'draft' ? null : Number(value))}>
              <SelectTrigger id="register-report-selection" className="h-auto min-h-10 max-w-xl text-start"><SelectValue /></SelectTrigger>
              <SelectContent>
                {!month.closed ? <SelectItem value="draft">{t('inmateStats.workflow.currentDraft')}</SelectItem> : null}
                {register.history.map((item) => <SelectItem key={item.id} value={String(item.id)}>
                  {t('inmateStats.workflow.revision', { sequence: item.sequence })}{' · '}{t(`inmateStats.workflow.reportStates.${item.report_state}`)}{item.stale ? ` · ${t('inmateStats.workflow.stale')}` : ''}{item.current ? ` · ${t('inmateStats.workflow.active')}` : ''}
                </SelectItem>)}
              </SelectContent>
            </Select>
            {register.historyError ? <p role="alert" className="text-sm text-accent">{t('inmateStats.workflow.historyError')} <Button type="button" variant="link" onClick={register.refetch}>{t('common.retry')}</Button></p> : null}
            <p role="status" className="text-sm text-muted-foreground">
              {submissionId === null ? t('inmateStats.workflow.currentDraft') : register.selectedReport ? `${t('inmateStats.workflow.revision', { sequence: register.selectedReport.sequence })} · ${t(`inmateStats.workflow.reportStates.${register.selectedReport.report_state}`)}${register.selectedReport.stale ? ` · ${t('inmateStats.workflow.stale')}` : ''}${!register.selectedReport.current ? ` · ${t('inmateStats.workflow.history')}` : ''}` : t('common.loading')}
            </p>
          </div>
          {submissionId !== null && (register.reportError || (!register.reportLoading && !register.selectedReport)) ? <div role="alert" className="space-y-2 rounded-xl border border-hairline bg-surface p-4">
            <p>{t(register.reportError instanceof ApiError ? register.reportError.status === 403 ? 'inmateStats.workflow.reportForbidden' : register.reportError.status === 404 ? 'inmateStats.workflow.reportNotFound' : 'common.loadError' : register.reportError ? 'common.loadError' : 'inmateStats.workflow.reportNotFound')}</p>
            <Button type="button" variant="outline" onClick={register.refreshReport}>{t('common.retry')}</Button>
          </div> : submissionId !== null && register.reportLoading ? <Skeleton aria-label={t('common.loading')} className="h-80 w-full" /> : (
            <ExportWorkspace month={submissionId === null ? month : register.selectedReport!} submissionId={submissionId ?? undefined} />
          )}
          {register.selectedReport && submissionId !== null ? <details data-print-hide className="rounded-xl border border-hairline bg-surface p-4">
            <summary className="cursor-pointer font-semibold">{t('inmateStats.workflow.actionHistory')}</summary>
            <ol className="mt-3 space-y-3 text-sm">{register.selectedReport.actions.map((action, index) => <li key={`${action.action}-${index}`}>
              <p>{t(`inmateStats.workflow.events.${action.action}`)} · <bdi dir="ltr">{formatRegisterDateTime(action.occurred_at, i18n.language)}</bdi></p>
              <p><bdi>{action.actor_name_ar}</bdi> · <bdi dir="ltr">{action.actor_employee_id}</bdi></p>
              {action.reason ? <p dir="auto" className="mt-1 whitespace-pre-wrap">{action.reason}</p> : null}
            </li>)}</ol>
          </details> : null}
        </div>
      ) : (
        <>
          <SealedStrip month={month} />

          <WarningsStrip
            month={month}
            isWriting={register.isWriting}
            onDeleteManual={register.deleteManualRow}
          />

          <Tabs
            value={activeGroup?.key ?? 'citizens'}
            onValueChange={selectPopulation}
            className="rounded-xl border border-hairline bg-surface"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-2">
              <TabsList className="min-w-0 flex-1">
                {shownGroups.map((group) => (
                  <TabsTrigger key={group.key} value={group.key} className="gap-2">
                    {t(`inmateStats.populations.${group.key}`)}
                    <Badge tone="neutral" shape="pill" className="font-mono" dir="ltr">
                      {group.count}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
              <p className="text-sm font-semibold">
                {t('inmateStats.counts.perTable')}:{' '}
                <bdi dir="ltr" className="font-mono">
                  {activeGroup?.count ?? 0}
                </bdi>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setExpandedColumns((value) => !value)}
                >
                  <Columns3 className="h-4 w-4" aria-hidden />
                  {t(
                    expandedColumns
                      ? 'inmateStats.index.collapseColumns'
                      : 'inmateStats.index.expandColumns',
                  )}
                </Button>
                {!month.closed ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setInspectorMode('create')
                      openMobileInspector()
                    }}
                  >
                    <UserRoundPlus className="h-4 w-4" aria-hidden />
                    {t('inmateStats.actions.addManual')}
                  </Button>
                ) : null}
              </div>
            </div>

            {shownGroups.map((group) => (
              <TabsContent key={group.key} value={group.key} className="m-0">
                <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
                  <div className="min-w-0 p-4">
                    <RegisterIndex
                      entries={group.entries}
                      population={group.key}
                      expanded={expandedColumns}
                      selectedId={selectedEntry?.id ?? null}
                      onSelect={selectEntry}
                    />
                  </div>
                  <aside className="hidden border-s border-hairline bg-surface-tinted/40 p-4 lg:block">
                    <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pe-1">
                      {inspector}
                    </div>
                  </aside>
                </div>
              </TabsContent>
            ))}
          </Tabs>

          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent aria-describedby={undefined} className="w-[min(94vw,28rem)] overflow-y-auto p-4 lg:hidden">
              <SheetTitle className="sr-only">{t('inmateStats.inspector.title')}</SheetTitle>
              {inspector}
            </SheetContent>
          </Sheet>

        </>
      )}
    </div>
  )
}
