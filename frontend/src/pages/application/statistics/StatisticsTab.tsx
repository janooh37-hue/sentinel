import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Columns3, UserRoundPlus } from 'lucide-react'

import type { InmatePopulation, InmateRegisterEntry } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CloseControls } from './CloseControls'
import { EntryInspector, SealedStrip, type InspectorMode } from './EntryInspector'
import { ExportWorkspace } from './ExportWorkspace'
import { MonthSwitcher } from './MonthSwitcher'
import { RegisterIndex } from './RegisterIndex'
import { WarningsStrip } from './WarningsStrip'
import { groupEntries, parseMonthKey, visibleGroups } from './registerModel'
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
  const [searchParams] = useSearchParams()
  const [coordinate, setCoordinate] = useState(() =>
    initialCoordinate(searchParams.get('stats_month')),
  )
  const [view, setView] = useState<ViewMode>('register')
  const [population, setPopulation] = useState<InmatePopulation>('citizens')
  const [expandedColumns, setExpandedColumns] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('view')
  const [sheetOpen, setSheetOpen] = useState(false)
  const register = useInmateRegister(coordinate.year, coordinate.month)
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
  }

  const inspector = month ? (
    <EntryInspector
      month={month}
      entry={selectedEntry}
      mode={month.closed ? 'view' : inspectorMode}
      reportEntries={reportEntries}
      isWriting={register.isWriting}
      onModeChange={setInspectorMode}
      onCreate={(body) => {
        register.createManualRow(body)
        setInspectorMode('view')
      }}
      onUpdate={(args) => {
        register.updateManualRow(args)
        setInspectorMode('view')
      }}
      onDelete={(rowId) => {
        register.deleteManualRow(rowId)
        setSelectedId(null)
        setInspectorMode('view')
        setSheetOpen(false)
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
                onClick={() => {
                  setSheetOpen(false)
                  setView('export')
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
            {month.counts.pending > 0 ? (
              <div className="bg-warning-soft px-4 py-3 text-warning">
                <dt className="text-xs font-semibold">
                  {t('inmateStats.populations.pending')} — {t('inmateStats.counts.perTable')}
                </dt>
                <dd className="mt-1 font-mono text-2xl font-bold tabular-nums" dir="ltr">
                  {month.counts.pending}
                </dd>
              </div>
            ) : null}
            <div className="bg-primary-soft px-4 py-3 text-primary-on-soft">
              <dt className="text-xs font-semibold">{t('inmateStats.counts.monthTotal')}</dt>
              <dd className="mt-1 font-mono text-2xl font-extrabold tabular-nums" dir="ltr">
                {month.counts.total}
              </dd>
            </div>
          </dl>
        ) : null}
      </header>

      {register.isLoading ? (
        <div className="space-y-3" aria-label={t('common.loading')}>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : register.isError || !month ? (
        <div className="rounded-xl border border-hairline bg-surface p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('common.loadError')}</p>
          <Button type="button" variant="outline" className="mt-3" onClick={register.refetch}>
            {t('common.retry')}
          </Button>
        </div>
      ) : view === 'export' ? (
        <ExportWorkspace month={month} />
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
            <SheetContent className="w-[min(94vw,28rem)] overflow-y-auto p-4 lg:hidden">
              <SheetTitle className="sr-only">{t('inmateStats.inspector.title')}</SheetTitle>
              {inspector}
            </SheetContent>
          </Sheet>

          <CloseControls
            month={month}
            isWriting={register.isWriting}
            onClose={register.closeMonth}
            onReopen={register.reopenMonth}
          />
        </>
      )}
    </div>
  )
}
