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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { EmployeesSectionTabs } from '@/components/employees/EmployeesSectionTabs'
import { siteToday } from '@/components/employees/useAttendanceAttention'
import { api } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

import { AttentionQueue } from './AttentionQueue'
import type { AttendanceView } from './AttendanceToolbar'
import { AttendanceToolbar } from './AttendanceToolbar'
import type { DayStripEntry } from './AttendanceToolbar'
import { BoardView } from './BoardView'
import { RegisterView } from './RegisterView'
import { TimelineView } from './TimelineView'
import type { AttendanceRow } from './attendanceModel'
import {
  isWindowOpen,
  needsDecision,
  rowState,
  shiftIsoDate,
} from './attendanceModel'

const VIEWS: readonly AttendanceView[] = ['register', 'board', 'timeline']
const SHIFT_KEYS: readonly string[] = ['morning', 'noon', 'night', 'office_day']
const STRIP_DAYS = 7

function isView(value: string | null): value is AttendanceView {
  return value !== null && (VIEWS as readonly string[]).includes(value)
}

export function AttendancePage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const today = siteToday()
  const operationalDate = params.get('date') ?? today
  const shiftCode = params.get('shift')
  const view: AttendanceView = isView(params.get('view')) ? (params.get('view') as AttendanceView) : 'register'
  const [search, setSearch] = useState('')

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          if (value === null) next.delete(key)
          else next.set(key, value)
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const dayQuery = useQuery({
    queryKey: ['attendance-day', operationalDate] as const,
    queryFn: () => api.listAttendanceDay({ operational_date: operationalDate, limit: 500 }),
    staleTime: 30_000,
  })

  const allRows = useMemo<AttendanceRow[]>(() => dayQuery.data?.items ?? [], [dayQuery.data])
  // Judge against the instant the payload was produced: counts and rows must
  // never disagree about whether a window had opened.
  // `dataUpdatedAt` is 0 until the first payload arrives, and the page renders
  // its loading state in that window, so this value is never read early.
  const now = useMemo(() => new Date(dayQuery.dataUpdatedAt), [dayQuery.dataUpdatedAt])
  const anyWindowOpen = useMemo(() => isWindowOpen(allRows, now), [allRows, now])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allRows.filter((row) => {
      if (shiftCode && row.shift_code !== shiftCode) return false
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
  }, [allRows, i18n.language, search, shiftCode])

  const attention = useMemo(
    () => allRows.filter((row) => needsDecision(rowState(row, { now }))).length,
    [allRows, now],
  )

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

  // ← / → change the day, 1–4 pick a shift, `/` focuses the search field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'ArrowLeft') setParam('date', shiftIsoDate(operationalDate, -1))
      else if (event.key === 'ArrowRight') setParam('date', shiftIsoDate(operationalDate, 1))
      else if (['1', '2', '3', '4'].includes(event.key)) {
        const code = SHIFT_KEYS[Number(event.key) - 1]
        setParam('shift', shiftCode === code ? null : code)
      } else if (event.key === '/') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [operationalDate, setParam, shiftCode])

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
    if (rows.length === 0) {
      return (
        <div className="mt-6 rounded-2xl border border-hairline bg-surface p-6 text-center">
          <p className="text-[0.85em] text-muted-foreground">{t('attendance.empty')}</p>
          {!anyWindowOpen && allRows.length > 0 && (
            <p className="mt-1.5 text-[0.78em] text-faint">{t('attendance.notStartedHint')}</p>
          )}
        </div>
      )
    }
    if (view === 'board') {
      return <BoardView rows={rows} now={now} onOpenEmployee={openEmployee} />
    }
    if (view === 'timeline') {
      return <TimelineView rows={rows} now={now} onOpenEmployee={openEmployee} />
    }
    return (
      <RegisterView
        rows={rows}
        now={now}
        onOpenEmployee={openEmployee}
      />
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <section
        className="relative overflow-hidden pt-[18px] text-white"
        style={{ background: 'var(--hero-grad)' }}
      >
        <div aria-hidden className="absolute -end-[60px] -top-[130px] h-[300px] w-[300px] rounded-full bg-white/[.05]" />
        <div className="relative mx-auto max-w-[1400px] px-8">
          <div className="text-[0.7em] font-semibold uppercase tracking-[.2em] opacity-[.62]">
            {t('employees.lookup.eyebrow')}
          </div>
          <h1 className="mt-1.5 flex items-baseline gap-2.5 text-[1.45em] font-bold tracking-[-0.01em]">
            {t('attendance.title')}
            <span dir="rtl" className="isolate-bidi text-[0.74em] font-normal opacity-[.72]">
              {t('attendance.titleAr')}
            </span>
          </h1>
          <p className="mt-1 text-[0.8em] opacity-[.76]">
            {t('attendance.subtitle', { date: operationalDate })}
          </p>
        </div>
        <div className="mt-3.5">
          <EmployeesSectionTabs attentionCount={attention} />
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1400px] px-8 pb-10 pt-4">
        <AttendanceToolbar
          operationalDate={operationalDate}
          dayStrip={dayStrip}
          rows={allRows}
          now={now}
          shiftCode={shiftCode}
          view={view}
          search={search}
          onDateChange={(iso) => setParam('date', iso === today ? null : iso)}
          onShiftChange={(code) => setParam('shift', code)}
          onViewChange={(next) => setParam('view', next === 'register' ? null : next)}
          onSearchChange={setSearch}
          onPrint={() => window.print()}
        />

        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">{body()}</div>
          <div className="mt-3 lg:mt-3" data-print-hide>
            <AttentionQueue
              rows={allRows}
              now={now}
              onOpenEmployee={openEmployee}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
