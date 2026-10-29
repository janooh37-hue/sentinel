/**
 * `/employees/:id/attendance/print`: print setup for the attendance statement
 * (mockup frames 4 and 5). Same access rule as the Attendance tab. The
 * attendance API caps one call at 92 days, so the range is fetched one
 * calendar month per request (`monthChunks`).
 */

import { useQueries, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { siteToday } from '@/components/employees/useAttendanceAttention'
import { Button } from '@/components/ui/button'
import { usePrintFilename } from '@/hooks/usePrintFilename'
import { api } from '@/lib/api'
import { AuthContext } from '@/lib/authContext'
import { pickEmployeeName } from '@/lib/employeeName'
import { useCapabilities } from '@/lib/useCapabilities'
import { siteTime } from '@/pages/employees/attendance/attendanceModel'

import { formatStatementMonth, formatStatementRange, monthChunks, monthPeriod, quarterPeriod } from '../statementModel'
import { AttendancePaper } from './AttendancePaper'
import { exceptionCases, paperDays } from './attendancePaperModel'
import { PrintSetupShell, SetupNotice } from './PrintSetupShell'
import {
  attendanceRange,
  attendanceSearch,
  parseAttendanceSettings,
  type AttendanceSettings,
  type Quarter,
} from './printSettings'
import { DateField, Hint, LanguageAndPaper, OptionRow, SetupFieldset } from './SetupControls'
import { usePaperIssue, useStatementPrint } from './statementPrintFlow'

/** More months than this and the setup says the paper will be long. */
const LONG_RANGE_MONTHS = 3

export function AttendancePrintPage(): React.JSX.Element {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { t, i18n } = useTranslation()
  const { has, isLoading: capsLoading } = useCapabilities()
  const user = useContext(AuthContext)?.user ?? null
  const today = siteToday()
  const ui = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const settings = useMemo(
    () => parseAttendanceSettings(params, today, i18n.language),
    [params, today, i18n.language],
  )
  const search = attendanceSearch(settings)
  const update = (patch: Partial<AttendanceSettings>): void => {
    const next = { ...settings, ...patch }
    setParams(attendanceSearch({ ...next, ...attendanceRange(next, today) }), { replace: true })
  }

  // The Attendance tab's rule, verbatim.
  const isSelf = !!user?.employee_id && user.employee_id === id
  const allowed =
    (isSelf && has('workforce.self.view')) || (has('workforce.people.view') && has('workforce.attendance.review'))
  const canViewLeaveFacts = has('employees.view') && has('leaves.view')

  const employee = useQuery({
    queryKey: ['employee-detail', id, canViewLeaveFacts],
    queryFn: () => api.getEmployeeDetail(id),
    enabled: id !== '' && allowed,
  })
  const chunks = useMemo(() => monthChunks(settings.from, settings.to), [settings.from, settings.to])
  const months = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['employee-attendance', id, chunk.from, chunk.to, canViewLeaveFacts] as const,
      queryFn: () => api.getEmployeeAttendance(id, { from_date: chunk.from, to_date: chunk.to }),
      enabled: id !== '' && allowed,
      staleTime: 60_000,
    })),
  })
  const failed = chunks.filter((_, i) => months[i]?.isError)
  const loaded = months.length > 0 && months.every((m) => m.isSuccess)
  const judgedAt = Math.max(0, ...months.map((m) => m.dataUpdatedAt))
  const raw = useMemo(() => (loaded ? months.flatMap((m) => m.data?.days ?? []) : []), [loaded, months])
  const days = useMemo(
    // `judgedAt` is 0 only before every month loads, when there are no days to judge.
    () => paperDays(raw, settings.from, settings.to, new Date(judgedAt), canViewLeaveFacts),
    [raw, settings.from, settings.to, judgedAt, canViewLeaveFacts],
  )
  const shiftWindows = useMemo(() => {
    const map = new Map<string, string>()
    for (const day of raw) {
      if (!day.shift_code || map.has(day.shift_code) || !day.scheduled_start_at || !day.scheduled_end_at) continue
      map.set(day.shift_code, `${siteTime(day.scheduled_start_at)} - ${siteTime(day.scheduled_end_at)}`)
    }
    return map
  }, [raw])
  const exceptions = exceptionCases(days).length

  const flow = useStatementPrint(id, search)
  const issue = usePaperIssue(flow.issued, settings.lang)
  const paperT = i18n.getFixedT(settings.lang)
  usePrintFilename(`${paperT('statementPrint.paper.attendanceTitle')} ${id} ${settings.from} ${settings.to}`)

  const backTo = `/employees/${encodeURIComponent(id)}?tab=attendance`
  if (!capsLoading && !allowed) {
    return (
      <div className="mx-auto grid max-w-xl gap-4 px-6 py-16">
        <h1 className="text-lg font-semibold text-primary">{t('statementPrint.attendanceTitle')}</h1>
        <p role="alert" className="text-sm text-foreground">
          {t('statementPrint.notAllowed')}
        </p>
        <Link to={backTo} className="text-sm font-medium text-primary underline underline-offset-4">
          {t('statementPrint.backToAttendance')}
        </Link>
      </div>
    )
  }

  const range = (from: string, to: string, lang: string): string =>
    formatStatementRange(from, to, lang, '')
  const thisYear = Number(today.slice(0, 4))
  const thisMonth = Number(today.slice(5, 7))
  const monthRange = monthPeriod(settings.year, settings.month)
  const atLatest = settings.year === thisYear && settings.month >= thisMonth
  const stepMonth = (delta: number): void => {
    const index = settings.year * 12 + (settings.month - 1) + delta
    update({ mode: 'month', year: Math.floor(index / 12), month: (index % 12) + 1 })
  }
  const quarters: { year: number; quarter: Quarter }[] = []
  for (let year = thisYear; year >= thisYear - 1; year -= 1) {
    for (let quarter = 4; quarter >= 1; quarter -= 1) {
      if (quarterPeriod(year, quarter as Quarter).from <= today) quarters.push({ year, quarter: quarter as Quarter })
    }
  }
  const emp = employee.data?.employee
  const ready = !!emp && loaded

  const settingsColumn = (
    <>
      <SetupFieldset legend={t('statementPrint.period')}>
        <OptionRow
          type="radio"
          name="attendance-period"
          checked={settings.mode === 'month'}
          onChange={() => update({ mode: 'month' })}
          label={t('statementPrint.month')}
          detail={range(monthRange.from, monthRange.to > today ? today : monthRange.to, ui)}
        />
        <div className="flex items-center gap-2 ps-9">
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label={t('statementPrint.prevMonth')}
            onClick={() => stepMonth(-1)}
          >
            <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </Button>
          <span className="min-w-36 text-center text-sm font-semibold text-primary">
            {formatStatementMonth(monthRange.from, ui)}
          </span>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label={t('statementPrint.nextMonth')}
            disabled={atLatest}
            onClick={() => stepMonth(1)}
          >
            <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </Button>
        </div>
        <div className="mb-1 mt-1 flex gap-1.5 ps-9">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => update({ mode: 'month', year: thisYear, month: thisMonth })}
          >
            {t('statement.period.month')}
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() =>
              update({
                mode: 'month',
                year: thisMonth === 1 ? thisYear - 1 : thisYear,
                month: thisMonth === 1 ? 12 : thisMonth - 1,
              })
            }
          >
            {t('statement.period.lastMonth')}
          </Button>
        </div>
        <OptionRow
          type="radio"
          name="attendance-period"
          checked={settings.mode === 'quarter'}
          onChange={() => update({ mode: 'quarter' })}
          label={t('statement.period.quarter')}
          detail={
            <select
              aria-label={t('statement.period.quarter')}
              value={`${settings.year}-${settings.quarter}`}
              onChange={(event) => {
                const [year, quarter] = event.target.value.split('-').map(Number)
                update({ mode: 'quarter', year, quarter: quarter as Quarter })
              }}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground"
            >
              {quarters.map((q) => (
                <option key={`${q.year}-${q.quarter}`} value={`${q.year}-${q.quarter}`}>
                  {t('statementPrint.quarterOption', { quarter: q.quarter, year: q.year })}
                </option>
              ))}
            </select>
          }
        />
        <OptionRow
          type="radio"
          name="attendance-period"
          checked={settings.mode === 'ytd'}
          onChange={() => update({ mode: 'ytd' })}
          label={t('statement.period.ytd')}
          detail={range(`${today.slice(0, 4)}-01-01`, today, ui)}
        />
        <OptionRow
          type="radio"
          name="attendance-period"
          checked={settings.mode === 'custom'}
          onChange={() => update({ mode: 'custom' })}
          label={t('statement.period.custom')}
        />
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          <DateField
            label={t('statementPrint.from')}
            value={settings.from}
            max={today}
            onChange={(from) => update({ mode: 'custom', from })}
          />
          <DateField
            label={t('statementPrint.to')}
            value={settings.to}
            max={today}
            onChange={(to) => update({ mode: 'custom', to })}
          />
        </div>
        <Hint>{t('statementPrint.futureHint')}</Hint>
      </SetupFieldset>

      <SetupFieldset legend={t('statementPrint.content')}>
        <OptionRow
          type="checkbox"
          checked={settings.summary}
          onChange={(summary) => update({ summary })}
          label={t('statementPrint.summaryTableShort')}
        />
        <OptionRow
          type="checkbox"
          checked={settings.calendar}
          onChange={(calendar) => update({ calendar })}
          label={t('statementPrint.calendar')}
        />
        <OptionRow
          type="checkbox"
          checked={settings.exceptions}
          onChange={(value) => update({ exceptions: value })}
          label={t('statementPrint.exceptionsList')}
        />
        <OptionRow
          type="checkbox"
          checked={settings.daily}
          onChange={(daily) => update({ daily, ...(daily ? {} : { dailyEx: false }) })}
          label={t('statementPrint.dailyTable')}
        />
        <div className="ps-6">
          <OptionRow
            type="checkbox"
            checked={settings.dailyEx}
            onChange={(dailyEx) => update({ dailyEx, ...(dailyEx ? { daily: true } : {}) })}
            label={t('statementPrint.dailyExceptionsOnly')}
          />
        </div>
        <OptionRow
          type="checkbox"
          checked={settings.punches}
          onChange={(punches) => update({ punches })}
          label={t('statementPrint.punchTimes')}
        />
        <Hint>{t('statementPrint.contentHint')}</Hint>
      </SetupFieldset>

      <SetupFieldset legend={t('statementPrint.signatures')}>
        <OptionRow
          type="checkbox"
          checked={settings.sign}
          onChange={(sign) => update({ sign })}
          label={t('statementPrint.signBoth')}
        />
      </SetupFieldset>

      <LanguageAndPaper
        lang={settings.lang}
        orient={settings.orient}
        languageHint={t('statementPrint.calendarHint')}
        onChange={update}
      />
    </>
  )

  const notices = (
    <>
      {chunks.length > LONG_RANGE_MONTHS && (
        <SetupNotice>{t('statementPrint.longRange', { count: chunks.length })}</SetupNotice>
      )}
      {failed.length > 0 && (
        <SetupNotice
          tone="error"
          action={
            <Button
              variant="secondary"
              size="xs"
              onClick={() => months.forEach((m) => (m.isError ? void m.refetch() : undefined))}
            >
              {t('statementPrint.retry')}
            </Button>
          }
        >
          {t('statementPrint.chunkFailed', {
            months: failed.map((c) => formatStatementMonth(c.from, ui)).join(ui === 'ar' ? '، ' : ', '),
          })}
        </SetupNotice>
      )}
      {employee.isError && <SetupNotice tone="error">{t('statementPrint.employeeFailed')}</SetupNotice>}
    </>
  )

  return (
    <PrintSetupShell
      backTo={backTo}
      backLabel={t('statementPrint.backToAttendance')}
      title={t('statementPrint.attendanceTitle')}
      employeeLine={
        emp ? (
          <>
            <bdi>{pickEmployeeName(emp, i18n.language)}</bdi> · <bdi className="font-mono">{emp.id}</bdi>
          </>
        ) : (
          <bdi className="font-mono">{id}</bdi>
        )
      }
      canPrint={ready}
      printPending={flow.pending}
      printError={flow.error}
      onPrint={() =>
        flow.print({
          kind: 'attendance',
          from_date: settings.from,
          to_date: settings.to,
          language: settings.lang,
          options: {
            summary: settings.summary,
            calendar: settings.calendar,
            exceptions: settings.exceptions,
            daily: settings.daily,
            daily_exceptions_only: settings.dailyEx,
            punches: settings.punches,
            signature: settings.sign,
            orientation: settings.orient,
          },
        })
      }
      settings={settingsColumn}
      notices={notices}
      orient={settings.orient}
      paperKey={`${search}|${judgedAt}|${loaded ? 1 : 0}|${flow.issued?.reference ?? ''}|${emp ? 1 : 0}`}
      result={(pages) => (
        <>
          <b className="text-[15px] text-primary">
            {t('statementPrint.resultDays', { count: days.length })} ·{' '}
            {t('statementPrint.resultExceptions', { count: exceptions })}
          </b>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('statementPrint.resultAttendance', {
              range: range(settings.from, settings.to, ui),
              pages,
              orientation: t(`statementPrint.${settings.orient}`),
            })}
          </p>
        </>
      )}
      paper={
        ready ? (
          <AttendancePaper
            frame={{
              employee: emp,
              issue,
              period: range(settings.from, settings.to, settings.lang),
              sourceUrl: `${window.location.origin}/employees/${emp.id}?tab=attendance`,
            }}
            settings={settings}
            days={days}
            shiftWindows={shiftWindows}
            leaveHidden={!canViewLeaveFacts}
          />
        ) : (
          <div className="grid h-[297mm] w-[210mm] place-items-center bg-white text-sm text-neutral-600">
            {failed.length > 0 || employee.isError ? t('statementPrint.notReady') : t('statementPrint.loading')}
          </div>
        )
      }
    />
  )
}
