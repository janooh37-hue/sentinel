/**
 * AttendancePage — `/employees/attendance`.
 *
 * One day, one toolbar, three views. Register, Board and Timeline are
 * projections of a single `GET /workforce/attendance/day` payload, which is why
 * switching them costs no request and needs no route.
 *
 * Keyboard: ← / → change day, 1–4 pick a shift, `/` focuses search.
 */

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { EmployeesSectionTabs } from '@/components/employees/EmployeesSectionTabs'
import { siteToday } from '@/components/employees/useAttendanceAttention'
import { api } from '@/lib/api'
import { UNASSIGNED } from '@/lib/dutyUnits'
import { useCapabilities } from '@/lib/useCapabilities'
import { pickEmployeeName } from '@/lib/employeeName'
import { canViewAttendanceRoster } from '@/lib/workforceAttendance'

import { AttentionQueue } from './AttentionQueue'
import { AttendanceCorrectionProvider } from './AttendanceCorrectionEntry'
import { useAttendanceCorrection } from './attendanceCorrectionContext'
import { AttendanceStateFilter } from './AttendanceStateFilter'
import type { PrintLayout } from './AttendancePrintSheet'
import { AttendancePrintSheet } from './AttendancePrintSheet'
import type { AttendanceView } from './AttendanceToolbar'
import { AttendanceToolbar } from './AttendanceToolbar'
import type { DayStripEntry } from './AttendanceToolbar'
import { BoardView } from './BoardView'
import { OnSiteNowSummary } from './OnSiteNowSummary'
import { RegisterView } from './RegisterView'
import { TimelineView } from './TimelineView'
import type { AttendanceFilter, AttendanceRow } from './attendanceModel'
import {
  applyAttendanceFilter,
  EMPTY_FILTER,
  isFilterActive,
  isWindowOpen,
  matchesCompany,
  needsDecision,
  parseAttendanceFilter,
  parseCompany,
  rowState,
  shiftIsoDate,
  stateCounts,
  writeAttendanceFilter,
} from './attendanceModel'

const VIEWS: readonly AttendanceView[] = ['register', 'board', 'timeline']
const SHIFT_KEYS: readonly string[] = ['morning', 'noon', 'night', 'office_day']
const STRIP_DAYS = 7

function isView(value: string | null): value is AttendanceView {
  return value !== null && (VIEWS as readonly string[]).includes(value)
}

export function AttendancePage(): React.JSX.Element {
  return (
    <AttendanceCorrectionProvider>
      <AttendancePageBody />
    </AttendanceCorrectionProvider>
  )
}

function AttendancePageBody(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const today = siteToday()
  const operationalDate = params.get('date') ?? today
  const shiftCode = params.get('shift')
  const view: AttendanceView = isView(params.get('view')) ? (params.get('view') as AttendanceView) : 'register'
  const filter = useMemo(() => parseAttendanceFilter(params, { isToday: operationalDate === today }), [params, operationalDate, today])
  const company = parseCompany(params)
  const filterActive = isFilterActive(filter)
  const attentionAnchorId = useId()
  const attentionTargetId = useId()
  const [search, setSearch] = useState('')
  // Which sheet the operator asked for. Held in state rather than the URL: it
  // describes one print run, not a view of the day worth linking to. Rendering
  // is switched BEFORE the dialog opens, so React has committed the right
  // layout by the time the browser paints the preview.
  const [printLayout, setPrintLayout] = useState<PrintLayout>('sheet')
  const { viewEvidence, overlayOpen } = useAttendanceCorrection()
  const { has } = useCapabilities()
  const hasIntegrationView = has('workforce.integration.manage')
  const canReview = canViewAttendanceRoster(has)
  // The router commits search-param updates in a transition, so its updater
  // receives the params of the last render: a second change made before that
  // render lands (Absent, then a company) would overwrite the first. Chain
  // updates on the newest params until the router has committed them.
  const pendingParams = useRef<URLSearchParams | null>(null)
  useEffect(() => {
    pendingParams.current = null
  }, [params])
  const updateParams = useCallback(
    (update: (base: URLSearchParams) => URLSearchParams) => {
      setParams(
        (previous) => {
          const next = update(new URLSearchParams(pendingParams.current ?? previous))
          pendingParams.current = next
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
  const setParam = useCallback(
    (key: string, value: string | null) => {
      updateParams((next) => {
        if (value === null) next.delete(key)
        else next.set(key, value)
        return next
      })
    },
    [updateParams],
  )
  // A patch, not a whole filter: merged onto the newest params, a tier change
  // cannot resurrect another tier's previous value.
  const patchFilter = useCallback((patch: Partial<AttendanceFilter>) => {
    updateParams((base) => writeAttendanceFilter(base, {
      ...parseAttendanceFilter(base, { isToday: operationalDate === today }),
      ...patch,
    }))
  }, [operationalDate, today, updateParams])
  const clearFilters = useCallback(() => patchFilter(EMPTY_FILTER), [patchFilter])

  // Drop unsupported URL values, including today's on-site bucket on a past day.
  useEffect(() => {
    const canonical = writeAttendanceFilter(params, filter)
    if (canonical.toString() !== params.toString()) setParams(canonical, { replace: true })
  }, [filter, params, setParams])

  // Provenance for the register's source line: how far the mirror is trusted.
  // Gated by its own capability, and a failure here must never hide the register.
  const integrationQuery = useQuery({
    queryKey: ['workforce-integration-status'] as const,
    queryFn: () => api.getWorkforceIntegrationStatus(),
    enabled: canReview && hasIntegrationView,
    staleTime: 60_000,
    retry: false,
  })

  const dayQuery = useQuery({
    queryKey: ['attendance-day', operationalDate] as const,
    queryFn: () => api.listAttendanceDay({ operational_date: operationalDate, limit: 500 }),
    enabled: canReview,
    staleTime: 30_000,
  })

  const exceptionsQuery = useQuery({
    queryKey: ['attendance-exceptions', operationalDate, shiftCode] as const,
    queryFn: () => api.listAttendanceExceptions({ operational_date: operationalDate, limit: 500 }),
    enabled: canReview,
  })

  const allRows = useMemo<AttendanceRow[]>(() => dayQuery.data?.items ?? [], [dayQuery.data])
  // Judge against the instant the payload was produced: counts and rows must
  // never disagree about whether a window had opened.
  // `dataUpdatedAt` is 0 until the first payload arrives, and the page renders
  // its loading state in that window, so this value is never read early.
  const now = useMemo(() => new Date(dayQuery.dataUpdatedAt), [dayQuery.dataUpdatedAt])
  const anyWindowOpen = useMemo(() => isWindowOpen(allRows, now), [allRows, now])

  const companies = useMemo(() => {
    const units = new Set<string>()
    for (const row of allRows) {
      if (row.duty_unit?.trim()) units.add(row.duty_unit)
    }
    if (company && company !== UNASSIGNED) units.add(company)
    return [...units].sort((a, b) => a.localeCompare(b, i18n.language))
  }, [allRows, company, i18n.language])

  const scopedRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allRows.filter((row) => {
      if (shiftCode && row.shift_code !== shiftCode) return false
      if (!matchesCompany(row, company)) return false
      if (!needle) return true
      const name = pickEmployeeName(
        { name_en: row.name_en, name_ar: row.name_ar ?? null },
        i18n.language,
      )
      return (
        name.toLowerCase().includes(needle) ||
        row.employee_id.toLowerCase().includes(needle) ||
        (row.duty_post ?? '').toLowerCase().includes(needle)
      )
    })
  }, [allRows, company, i18n.language, search, shiftCode])
  const filteredRows = useMemo(() => applyAttendanceFilter(scopedRows, filter, { now }), [scopedRows, filter, now])
  const counts = useMemo(() => stateCounts(scopedRows, filter, { now }), [scopedRows, filter, now])
  const peopleShown = useMemo(() => new Set(filteredRows.map((row) => row.employee_id)).size, [filteredRows])
  const searchEmptiedScope = scopedRows.length === 0 && search.trim().length > 0 &&
    allRows.some((row) => (!shiftCode || row.shift_code === shiftCode) && matchesCompany(row, company))

  const attention = exceptionsQuery.isSuccess
    ? exceptionsQuery.data.items.length
    : allRows.filter((row) => needsDecision(rowState(row, { now }))).length

  const dayStrip = useMemo<DayStripEntry[]>(() => {
    const entries: DayStripEntry[] = []
    for (let offset = STRIP_DAYS - 1; offset >= 0; offset -= 1) {
      const iso = shiftIsoDate(today, -offset)
      const [year, month, day] = iso.split('-').map(Number)
      const at = new Date(year, (month ?? 1) - 1, day ?? 1)
      entries.push({
        iso,
        weekday: at.toLocaleDateString(i18n.language, { weekday: 'short' }),
        label: at.toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' }),
        // Only the loaded day knows its own exception count; the rest render as
        // a neutral bar rather than a number this page has not fetched.
        exceptions: iso === operationalDate ? attention : null,
        total: iso === operationalDate ? allRows.length : 0,
      })
    }
    return entries
  }, [allRows.length, attention, i18n.language, operationalDate, today])

  const openEmployee = useCallback(
    (employeeId: string) => {
      navigate(`/employees/${encodeURIComponent(employeeId)}?tab=attendance`)
    },
    [navigate],
  )

  // `window.print()` blocks the thread, so the layout it is meant to print has
  // to be in the DOM before the call — a plain setState would still be pending
  // and the dialog would preview the previous sheet. `flushSync` commits first,
  // which is precisely what it exists for; an effect would only turn the same
  // ordering into a cascading render.
  const requestPrint = useCallback((layout: PrintLayout) => {
    flushSync(() => setPrintLayout(layout))
    window.print()
  }, [])

  // ← / → change the day, 1–4 pick a shift, `/` searches, Esc clears attendance filters.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !canReview || overlayOpen ||
        document.querySelector('[role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden])')) return
      const target = event.target as HTMLElement | null
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable ||
        target.closest('[contenteditable]:not([contenteditable="false"])'))) return
      if (event.key === 'ArrowLeft') setParam('date', shiftIsoDate(operationalDate, -1))
      else if (event.key === 'ArrowRight') setParam('date', shiftIsoDate(operationalDate, 1))
      else if (['1', '2', '3', '4'].includes(event.key)) {
        const code = SHIFT_KEYS[Number(event.key) - 1]
        setParam('shift', shiftCode === code ? null : code)
      } else if (event.key === '/') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
      } else if (event.key === 'Escape' && filterActive) {
        event.preventDefault()
        clearFilters()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canReview, clearFilters, filterActive, operationalDate, overlayOpen, setParam, shiftCode])

  const body = (): React.JSX.Element => {
    if (dayQuery.isPending) {
      return (
        <p role="status" className="mt-6 text-center text-[0.85em] text-muted-foreground">
          {t('common.loading', 'Loading…')}
        </p>
      )
    }
    if (dayQuery.isError) {
      return (
        <p role="alert" className="mt-6 rounded-2xl border border-accent-soft bg-accent-soft p-4 text-[0.85em] text-accent">
          {t('attendance.loadFailed')}
        </p>
      )
    }
    if (filteredRows.length === 0) {
      const noFilterMatches = scopedRows.length > 0
      return (
        <div className="mt-4 flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-hairline bg-surface p-6 text-center">
          <p className="text-[0.85em] text-muted-foreground">
            {t(noFilterMatches ? 'attendance.results.empty' : 'attendance.empty')}
          </p>
          {noFilterMatches ? (
            <button
              type="button"
              onClick={clearFilters}
              className="min-h-[44px] rounded-md border border-border-strong px-3 text-[0.8em] font-medium hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t('attendance.filter.clear')}
            </button>
          ) : searchEmptiedScope ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="min-h-[44px] rounded-md border border-border-strong px-3 text-[0.8em] font-medium hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t('attendance.results.clearSearch')}
            </button>
          ) : !anyWindowOpen && allRows.length > 0 ? (
            <p className="text-[0.78em] text-faint">{t('attendance.notStartedHint')}</p>
          ) : null}
        </div>
      )
    }
    if (view === 'board') {
      return <BoardView rows={filteredRows} now={now} operationalDate={operationalDate} onOpenEmployee={openEmployee} />
    }
    if (view === 'timeline') {
      return <TimelineView rows={filteredRows} now={now} operationalDate={operationalDate} onOpenEmployee={openEmployee} />
    }
    return (
      <RegisterView
        rows={filteredRows}
        now={now}
        operationalDate={operationalDate}
        freshThrough={integrationQuery.data?.streams?.punches?.fresh_through ?? null}
        onOpenEmployee={openEmployee}
      />
    )
  }

  if (!canReview) return null

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      {/* shrink-0: this is a flex item in a column whose sibling is tall, and
          without it the band collapses to a few pixels and swallows the page
          title, the Arabic label and the section tabs. */}
      {/* The whole screen tree is print-hidden: the paper is the dedicated
          sheet below, not this layout. A named `@page` forces a break, so any
          in-flow box left visible beside it costs a blank sheet — the same
          hazard documented in index.css and guarded for the Toaster in App. */}
      <section
        data-print-hide
        className="relative shrink-0 overflow-hidden pt-[18px] text-white"
        style={{ background: 'var(--hero-grad)' }}
      >
        <div aria-hidden className="absolute -end-[60px] -top-[130px] h-[300px] w-[300px] rounded-full bg-white/[.05]" />
        <div className="relative mx-auto max-w-[1400px] px-8">
          <div className="text-[0.7em] font-semibold uppercase tracking-[.2em] opacity-[.62]">
            {t('employees.lookup.eyebrow')}
          </div>
          <h1 className="mt-1.5 flex items-baseline gap-2.5 text-[1.45em] font-bold tracking-[-0.01em]">
            {t('attendance.title')}
            {/* The Arabic echo serves English readers; in Arabic it would
                repeat the title word for word. */}
            {i18n.language.startsWith('ar') ? null : (
              <span dir="rtl" className="isolate-bidi text-[0.74em] font-normal opacity-[.72]">
                {t('attendance.titleAr')}
              </span>
            )}
          </h1>
          <p className="mt-1 text-[0.8em] opacity-[.76]">
            {t('attendance.subtitle', { date: operationalDate })}
          </p>
        </div>
        <div className="mt-3.5">
          <EmployeesSectionTabs attentionCount={attention} />
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1400px] px-8 pb-10 pt-4" data-print-hide>
        <AttendanceToolbar
          operationalDate={operationalDate}
          dayStrip={dayStrip}
          rows={allRows}
          now={now}
          shiftCode={shiftCode}
          company={company}
          companies={companies}
          view={view}
          search={search}
          onDateChange={(iso) => setParam('date', iso === today ? null : iso)}
          onShiftChange={(code) => setParam('shift', code)}
          onCompanyChange={(next) => setParam('company', next)}
          onViewChange={(next) => setParam('view', next === 'register' ? null : next)}
          onSearchChange={setSearch}
          onPrint={requestPrint}
        />

        {dayQuery.isSuccess && (
          <OnSiteNowSummary
            rows={scopedRows}
            now={now}
            operationalDate={operationalDate}
            who={filter.who}
            onWhoChange={(who) => patchFilter({ who })}
            attentionCount={attention}
            attentionAnchorId={attentionAnchorId}
            attentionTargetId={attentionTargetId}
          />
        )}

        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 pt-3">
            <AttendanceStateFilter
              counts={counts}
              states={filter.states}
              corrected={filter.corrected}
              onStatesChange={(states) => patchFilter({ states })}
              onCorrectedChange={(corrected) => patchFilter({ corrected })}
              onClear={clearFilters}
            />
            <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
              <div role="status" aria-label={t('attendance.results.label')} aria-live="polite" aria-atomic="true">
                {dayQuery.isSuccess && (
                  <>
                    <Trans
                      i18nKey="attendance.results.people"
                      count={peopleShown}
                      components={[<bdi dir="ltr" key="people" className="font-mono tabular-nums" />]}
                    />
                    {' · '}
                    <Trans
                      i18nKey="attendance.results.rows"
                      count={filteredRows.length}
                      components={[<bdi dir="ltr" key="rows" className="font-mono tabular-nums" />]}
                    />
                  </>
                )}
              </div>
              {filterActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="min-h-[44px] rounded-sm text-primary-text underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {t('attendance.filter.clear')}
                </button>
              )}
            </div>
            {body()}
          </div>
          <div className="mt-3 lg:mt-3">
            {exceptionsQuery.isError && (
              <p role="alert" className="mb-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[0.75em] text-warning">
                {t('attendance.review.exceptionsFailed')}
              </p>
            )}
            <AttentionQueue
              id={attentionTargetId}
              labelledBy={attentionAnchorId}
              rows={allRows}
              exceptionRows={exceptionsQuery.isSuccess ? exceptionsQuery.data.items : undefined}
              now={now}
              operationalDate={operationalDate}
              onOpenEmployee={openEmployee}
              onReviewCase={exceptionsQuery.isSuccess ? viewEvidence : undefined}
            />
          </div>
        </div>
      </div>

      {/* Paper uses the same rows and declares both attendance and scope filters. */}
      <AttendancePrintSheet
        layout={printLayout}
        rows={filteredRows}
        now={now}
        operationalDate={operationalDate}
        shiftCode={shiftCode}
        search={search}
        filter={filter}
        company={company}
        totalRows={allRows.length}
      />
    </div>
  )
}
