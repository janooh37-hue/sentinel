/**
 * Compact navy ID card for the Employee Detail sidebar.
 *
 * Prototype `.idcard`: 80px rounded-[14px] photo, bilingual name, mono G-number,
 * status pill, 2-column facts grid (position / department / duty_unit / doj),
 * action buttons (createDoc primary-white, addLeave ghost, timeSheet ghost,
 * edit ghost).
 *
 * Photo upload button (camera icon) is copied from the old EmployeeHero pattern.
 * Gate: edit & camera are hidden when the operator lacks `employees.edit`; the
 * time sheet is hidden without `timesheet.view`.
 *
 * This card is the record's ONLY action surface — `EmployeeDetailPage` has no
 * `isMobile`, no `DropdownMenu` and no `md:hidden` / `hidden md:` pair — and the
 * action row is one responsive flex row inside a sidebar that stacks below
 * `md`, so a single button serves both viewports (`AGENTS.md:44` says record
 * actions *often* split; on this page they do not).
 */

import { Camera, Pencil } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { EmployeeRead, EmployeeStatus } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { useCapabilities } from '@/lib/useCapabilities'
import { PendingDepartureBadge } from '@/components/employees/PendingDepartureBadge'
import { useEmployeePhoto } from '@/components/employees/useEmployeePhoto'
import { lastCompletedMonth, spanMonthLabels } from '@/pages/timesheet/useTimesheet'

const STATUS_DOT_CLS: Record<EmployeeStatus, string> = {
  Active: 'bg-success',
  Resigned: 'bg-warning',
  Terminated: 'bg-destructive',
}

/** First letters of the first two space-separated name parts — avatar fallback. */
function cardInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Which month the record offers, and how many sheets of it.
 *
 * A departure whose month has ENDED is the handover HR asked for: the month of
 * departure and the one before it, which the server returns as ONE workbook of
 * two sheets, earlier first, named for the later month. Everything else gets
 * the month that just ended, the same month the time-sheet page opens on.
 *
 * The `end_date` in hand is not enough on its own. A resignation dated ahead is
 * a first-class LIVE state here, not a departure: `employee_service` keeps
 * `status` Active and parks the target in `pending_status` until the date
 * arrives, and the Pending Departures widget exists to list exactly those rows.
 * Nothing downstream would refuse the export either — a live row is seeded
 * `P` on every day of the month, and the span renderer only 404s when the
 * employee is on neither month — so the operator would be handed a real `.xlsx`
 * named for a future month asserting a manned post on days that have not
 * happened, and would lose the ordinary export for that employee until the
 * nightly flip. So the departure month has to be at or before the last
 * completed month.
 *
 * `end_date` is split as a STRING. `new Date('2026-01-15').getMonth()` is UTC
 * midnight, so west of Greenwich it reads December and a January departure
 * would silently fetch the wrong two months.
 */
function sheetSpanOf(employee: EmployeeRead): { year: number; month: number; months: 1 | 2 } {
  const latest = lastCompletedMonth()
  const end = employee.end_date
  if (!end) return { ...latest, months: 1 }
  const [year, month] = end.slice(0, 7).split('-').map(Number)
  // An unparseable date is not evidence of a departure either.
  if (!year || !month) return { ...latest, months: 1 }
  const ended = year < latest.year || (year === latest.year && month <= latest.month)
  return ended ? { year, month, months: 2 } : { ...latest, months: 1 }
}

interface Props {
  employee: EmployeeRead
  onEdit: () => void
  onAddLeave: () => void
  onGenerate: () => void
  /** One employee's own sheet. `timesheet.view` — it freezes nothing. */
  onTimesheet: (args: { year: number; month: number; months: 1 | 2 }) => void
  onChangeStatus?: () => void
}

export function EmployeeIdCard({
  employee,
  onEdit,
  onAddLeave,
  onGenerate,
  onTimesheet,
  onChangeStatus,
}: Props): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const name = pickEmployeeName(employee, i18n.language)
  // Alt-language name for bilingual subtitle
  const altName = i18n.language === 'ar' ? employee.name_en : (employee.name_ar ?? null)
  const positionLabel = pickPosition(employee, i18n.language)
  const { has } = useCapabilities()
  const canEdit = has('employees.edit')
  // The per-employee export freezes nothing, so an operator holding only
  // `timesheet.view` may take it (amendment A3, and the route agrees).
  const canSeeTimesheet = has('timesheet.view')
  const { upload } = useEmployeePhoto(employee.id)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoSrc = `/api/v1/employees/${encodeURIComponent(employee.id)}/photo?v=${employee.photo_version ?? ''}`

  const span = sheetSpanOf(employee)
  const monthName = (year: number, month: number): string =>
    new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(year, month - 1, 1))
  /** The earlier/later naming rule, from the one declaration the dock shares. */
  const spanNames = spanMonthLabels(span.year, span.month, i18n.language)
  /**
   * "2 months" does not say WHICH two, and a `title` is mouse-hover only — it
   * is exposed as a description, so a keyboard or touch operator never reads
   * it. The two months are therefore visible copy, with the title supplying
   * what the sentence adds: one workbook, two sheets, earlier first.
   */
  const timesheetSpanLine =
    span.months === 2 ? t('timesheet.record.bothMonths', spanNames) : null
  const timesheetTitle =
    span.months === 2
      ? t('timesheet.employee.spanMonths', spanNames)
      : t('timesheet.record.oneMonth', {
          month: `${monthName(span.year, span.month)} ${span.year}`,
        })

  return (
    <div
      className="rounded-[18px] p-[22px_24px_20px] text-white"
      style={{ background: 'var(--hero-grad)' }}
    >
      {/* ── Card header (label + EMP FILE) ────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between text-[0.65em] uppercase tracking-[0.2em] opacity-60">
        <span>{t('employee.card.label')}</span>
        <span className="font-mono">EMP FILE</span>
      </div>

      {/* ── Photo + identity row ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        {/* Photo tile */}
        <div className="relative shrink-0">
          {employee.has_photo ? (
            <img
              src={photoSrc}
              alt={name}
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
              }}
              className="h-20 w-20 rounded-[14px] object-cover ring-2 ring-white/20"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-20 w-20 items-center justify-center rounded-[14px] bg-white/15 text-[1.5em] font-bold ring-2 ring-white/20"
            >
              {cardInitials(name)}
            </div>
          )}
          {canEdit && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) upload.mutate(f)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={upload.isPending}
                aria-label={t('employees.photo.change')}
                className="absolute -bottom-0.5 -end-0.5 grid h-7 w-7 place-items-center rounded-full bg-white text-foreground shadow ring-1 ring-black/10 transition hover:bg-white/90 disabled:opacity-60 motion-reduce:transition-none"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>

        {/* Name + ID (status moved to facts grid) */}
        <div className="min-w-0 flex-1">
          {/* Long compound names are the norm — wrap to two lines, never ellipsize
              the primary name (QA fix). */}
          <div className="line-clamp-2 text-[1.05em] font-bold leading-snug">{name}</div>
          {altName && <div className="truncate text-[0.82em] opacity-70">{altName}</div>}
          <div className="mt-0.5 font-mono text-[0.8em] opacity-75">{employee.id}</div>
        </div>
      </div>

      {/* ── Facts grid (2-column): position / status / department / duty_unit ─── */}
      {(positionLabel ?? employee.status ?? employee.department ?? employee.duty_unit) && (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-white/14 pt-3 text-[0.78em]">
          <div>
            <div className="mb-0.5 text-[0.78em] uppercase tracking-wide opacity-55">
              {t('employee.field.position')}
            </div>
            <div className="truncate font-medium leading-snug">
              {positionLabel || <span className="opacity-40">—</span>}
            </div>
          </div>
          {/* Status cell */}
          <div>
            <div className="mb-0.5 text-[0.78em] uppercase tracking-wide opacity-55">
              {t('employees.fields.status')}
            </div>
            <div className="mt-1">
              {canEdit && onChangeStatus ? (
                <button
                  type="button"
                  onClick={onChangeStatus}
                  aria-label={t('employees.statusDialog.title')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[0.75em] font-semibold transition-colors hover:bg-white/25"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLS[employee.status] ?? 'bg-muted'}`}
                    aria-hidden
                  />
                  {t(`employees.status.${employee.status}`, employee.status)}
                  <Pencil className="h-2.5 w-2.5 opacity-70" aria-hidden />
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[0.75em] font-semibold">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLS[employee.status] ?? 'bg-muted'}`}
                    aria-hidden
                  />
                  {t(`employees.status.${employee.status}`, employee.status)}
                </span>
              )}
              <PendingDepartureBadge
                status={employee.status}
                pendingStatus={employee.pending_status}
                endDate={employee.end_date}
              />
            </div>
          </div>
          <div>
            <div className="mb-0.5 text-[0.78em] uppercase tracking-wide opacity-55">
              {t('employee.field.department')}
            </div>
            <div className="truncate font-medium leading-snug">
              {employee.department || <span className="opacity-40">—</span>}
            </div>
          </div>
          <div>
            <div className="mb-0.5 text-[0.78em] uppercase tracking-wide opacity-55">
              {t('employee.field.duty_unit')}
            </div>
            <div className="truncate font-medium leading-snug">
              {employee.duty_unit || <span className="opacity-40">—</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Action buttons — prototype .id-actions: compact single-line pills,
             no icons (they force mid-word wraps in the 350px sidebar). ───────── */}
      {/* `flex-wrap`: four `whitespace-nowrap` pills cannot shrink below their
          own text (`min-width: auto` is min-content), so in a 350px sidebar the
          fourth has to be allowed onto a second line instead of overflowing. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onGenerate}
          className="flex flex-1 items-center justify-center whitespace-nowrap rounded-full bg-white px-2 py-2 text-[0.75em] font-semibold shadow-sm transition-colors hover:bg-white/90"
          style={{ color: 'var(--primary)' }}
        >
          {t('employee.card.createDoc')}
        </button>
        <button
          type="button"
          onClick={onAddLeave}
          className="flex flex-1 items-center justify-center whitespace-nowrap rounded-full border border-white/25 bg-white/15 px-2 py-2 text-[0.75em] font-medium transition-colors hover:bg-white/25"
        >
          {t('employee.card.addLeave')}
        </button>
        {canSeeTimesheet && (
          <button
            type="button"
            onClick={() => onTimesheet(span)}
            title={timesheetTitle}
            className="flex flex-1 items-center justify-center whitespace-nowrap rounded-full border border-white/25 bg-white/15 px-2 py-2 text-[0.75em] font-medium transition-colors hover:bg-white/25"
          >
            {span.months === 2
              ? t('timesheet.record.actionTwo')
              : t('timesheet.record.action', { month: monthName(span.year, span.month) })}
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex flex-1 items-center justify-center whitespace-nowrap rounded-full border border-white/25 bg-white/15 px-2 py-2 text-[0.75em] font-medium transition-colors hover:bg-white/25"
          >
            {t('employee.card.edit')}
          </button>
        )}
      </div>
      {canSeeTimesheet && timesheetSpanLine && (
        <p className="mt-2 text-[0.72em] leading-snug opacity-70">{timesheetSpanLine}</p>
      )}
    </div>
  )
}
