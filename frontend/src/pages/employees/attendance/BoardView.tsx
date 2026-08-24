/**
 * BoardView — the duty-room wall (design 7).
 *
 * A person costs a tile, not a row, so ~150 people fit in one panel. Tiles carry
 * the last three digits of the G-number rather than initials: at this headcount
 * initials collide, and the number is what a supervisor reads out. The full name
 * is in the tooltip and in the attention queue.
 *
 * Colour is spent only on trouble. Verified tiles stay near-monochrome navy so
 * the eye lands on the exceptions without scanning.
 */

import { useTranslation } from 'react-i18next'

import { pickEmployeeName } from '@/lib/employeeName'

import type { AttendanceRow, RowState } from './attendanceModel'
import { groupByUnitAndPost, postSummary, rowState, siteTime, splitByShift } from './attendanceModel'

interface Props {
  rows: readonly AttendanceRow[]
  now: Date
  graceMinutes?: number
  onOpenEmployee: (employeeId: string) => void
}

const TILE: Record<RowState, string> = {
  verified: 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/40',
  grace: 'bg-yellow-400/15 text-yellow-100 ring-1 ring-yellow-300/60',
  late: 'bg-amber-400/20 text-amber-100 ring-[1.5px] ring-amber-300',
  unpaired: 'bg-rose-500/20 text-rose-100 ring-[1.5px] ring-rose-400',
  absent: 'bg-accent text-white ring-2 ring-accent/40',
  leave: 'bg-blue-500/20 text-blue-100 ring-1 ring-blue-300/50',
  pending: 'bg-white/5 text-rail-faint ring-1 ring-white/10',
}

export function BoardView({ rows, now, graceMinutes, onOpenEmployee }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const input = { now, graceMinutes }
  // Shift first: one company can work two windows on the same day.
  const sections = splitByShift(rows).flatMap(([shiftCode, shiftRows]) =>
    [...groupByUnitAndPost(shiftRows).entries()].map(([unit, posts]) => ({ shiftCode, unit, posts })),
  )

  return (
    <div
      data-testid="attendance-board"
      className="mt-3 rounded-2xl p-4"
      style={{
        background:
          'radial-gradient(1100px 340px at 12% -8%, rgba(52,211,153,.10), transparent 60%), radial-gradient(900px 320px at 88% -10%, rgba(200,16,46,.14), transparent 62%), var(--rail)',
      }}
    >
      {sections.map(({ shiftCode, unit, posts }) => {
        const unitRows = [...posts.values()].flat()
        const shift = shiftCode
        const summary = postSummary(unitRows, input)
        return (
          <section key={`${unit}-${shift}`} className="mb-4 last:mb-0">
            <header className="flex flex-wrap items-center gap-2.5 text-white">
              <h3 className="text-[0.82em] font-extrabold">
                {t(`attendance.shift.${shift}`, shift)}
              </h3>
              <span dir="rtl" className="isolate-bidi text-[0.76em] text-rail-faint">
                {unit}
              </span>
              <span className="ms-auto font-mono text-[0.76em] text-rail-text">
                {t('attendance.board.seenOf', { seen: summary.seen, due: summary.due })}
                {' · '}
                {t('attendance.register.posts', { count: posts.size })}
              </span>
            </header>

            <div className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(196px,1fr))]">
              {[...posts.entries()].map(([post, postRows]) => {
                const stats = postSummary(postRows, input)
                return (
                  <div
                    key={post}
                    data-testid="attendance-board-post"
                    className={`rounded-xl border p-2.5 ${
                      stats.exceptions > 0
                        ? 'border-rose-800/70 bg-accent/10'
                        : 'border-rail-line bg-white/[.035]'
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-1.5 text-white">
                      <b className="text-[0.72em]">{post}</b>
                      <span
                        className={`ms-auto font-mono text-[0.7em] ${
                          stats.exceptions > 0 ? 'font-bold text-rose-200' : 'text-rail-text'
                        }`}
                      >
                        {stats.seen}/{stats.due}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {postRows.map((row) => {
                        const state = rowState(row, input)
                        const name = pickEmployeeName(
                          { name_en: row.name_en, name_ar: row.name_ar ?? null },
                          i18n.language,
                        )
                        return (
                          <button
                            key={`${row.employee_id}-${row.shift_code}`}
                            type="button"
                            onClick={() => onOpenEmployee(row.employee_id)}
                            title={`${name} · ${row.employee_id} · ${t(`attendance.state.${state}`)}${
                              row.first_punch_at ? ` · ${siteTime(row.first_punch_at)}` : ''
                            }`}
                            className={`grid h-[26px] w-[26px] place-items-center rounded-lg font-mono text-[0.62em] font-bold ${TILE[state]}`}
                          >
                            {row.employee_id.slice(-3)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      <p className="mt-3 text-[0.7em] text-rail-faint">{t('attendance.board.legend')}</p>
    </div>
  )
}
