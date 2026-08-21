/**
 * AttendanceHeroCard — today's attendance as a live signal in the Employees hero.
 *
 * The point of this card is that you learn whether attendance needs you WITHOUT
 * opening the page: it shows seen / late / absent / unpaired and the two worst
 * names, so a clean day never costs a navigation.
 *
 * The query is capability-gated. `/workforce/attendance/day` requires
 * workforce.attendance.review AND workforce.people.view, and the role presets
 * give an operator only workforce.self.view, so an ungated fetch would 403 on
 * every visit to /employees for most users.
 */

import { useTranslation } from 'react-i18next'

import { pickEmployeeName } from '@/lib/employeeName'
import { minutesPastGrace, rowState } from '@/pages/employees/attendance/attendanceModel'

import { useAttendanceAttention } from './useAttendanceAttention'

interface Props {
  onOpen: () => void
}

export function AttendanceHeroCard({ onOpen }: Props): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const { allowed, isLoading, attention, seen, late, absent, unpaired, worst, judgedAt } =
    useAttendanceAttention()

  if (!allowed) return null

  // Before the first payload lands every count is zero, which would render as
  // a verified clean day. Claiming "everyone has been seen" while the card
  // still knows nothing is the exact lie this surface exists to prevent, so
  // loading is shown as loading.
  const pending = isLoading

  const total = attention ?? 0

  return (
    <div
      data-testid="attendance-hero-card"
      className={`rounded-2xl border p-4 backdrop-blur-sm ${
        total > 0 ? 'border-amber-400/50 bg-amber-400/[.10]' : 'border-white/[.14] bg-white/[.07]'
      }`}
    >
      <div className="mb-[11px] flex items-center gap-[9px]">
        <span
          aria-hidden
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] text-[.85rem] ${
            total > 0 ? 'bg-accent/25 text-white' : 'bg-white/[.12] text-white/85'
          }`}
        >
          🕘
        </span>
        <h4 className="text-[12px] font-bold tracking-[.08em] opacity-[.85]">
          {t('attendance.hero.title')}
        </h4>
        <span dir="rtl" className="isolate-bidi text-[11px] opacity-70">
          {t('attendance.titleAr')}
        </span>
        {total > 0 && (
          <span
            data-testid="attendance-hero-count"
            className="ms-auto rounded-full bg-accent/30 px-2 py-[1px] font-mono text-[11px] font-bold text-white"
          >
            {total}
          </span>
        )}
      </div>

      {/* Two by two, not four across: this card lives in a ~286px hero column,
        * where a fourth chip clipped its own label. */}
      <div className="grid grid-cols-2 gap-1.5">
        {(
          [
            ['seen', seen, 'text-emerald-300'],
            ['late', late, 'text-amber-300'],
            ['absent', absent, 'text-red-300'],
            ['unpaired', unpaired, 'text-rose-300'],
          ] as const
        ).map(([key, value, tone]) => (
          <div key={key} className="rounded-[9px] bg-white/[.07] px-2 py-1.5">
            <div
              data-testid={`attendance-hero-${key}`}
              className={`font-mono text-[15px] font-extrabold leading-tight ${tone}`}
            >
              {pending ? '—' : value}
            </div>
            <div className="mt-0.5 text-[9.5px] uppercase tracking-[.06em] opacity-60">
              {t(`attendance.hero.${key}`)}
            </div>
          </div>
        ))}
      </div>

      {pending ? (
        <p data-testid="attendance-hero-pending" className="mt-2 text-[12px] leading-relaxed opacity-60">
          {t('attendance.hero.pending')}
        </p>
      ) : worst.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {worst.slice(0, 2).map((row) => {
            const name = pickEmployeeName(
              { name_en: row.name_en, name_ar: row.name_ar ?? null },
              i18n.language,
            )
            return (
              <div
                key={`${row.employee_id}-${row.shift_code}`}
                className="flex w-full items-start gap-[9px] rounded-xl border border-white/[.1] bg-white/[.06] px-2.5 py-1.5"
              >
                {/* Wraps rather than clips: the family name is the discriminator. */}
                <span className="min-w-0 flex-1 text-[12px] font-semibold leading-snug">{name}</span>
                <span className="shrink-0 font-mono text-[10.5px] opacity-60">{row.employee_id}</span>
                <span
                  className={`shrink-0 text-[10.5px] font-bold ${
                    rowState(row, { now: judgedAt }) === 'late' ? 'text-amber-300' : 'text-rose-300'
                  }`}
                >
                  {/* The same ladder every other view uses, so this card cannot
                    * drift into naming a state the model no longer has. */}
                  {rowState(row, { now: judgedAt }) === 'absent'
                    ? t('attendance.state.absent')
                    : rowState(row, { now: judgedAt }) === 'unpaired'
                      ? t('attendance.state.unpaired')
                      : t('attendance.pastGrace', { minutes: minutesPastGrace(row) })}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <p data-testid="attendance-hero-clean" className="mt-2 text-[12px] leading-relaxed opacity-75">
          {t('attendance.hero.clean')}
        </p>
      )}

      <div className="mt-[9px] flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="cursor-pointer whitespace-nowrap rounded-full bg-accent px-[13px] py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-accent-hover"
        >
          {t('attendance.hero.open')}
        </button>
      </div>
    </div>
  )
}
