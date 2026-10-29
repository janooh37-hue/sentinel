/**
 * The printed attendance statement (mockup frame 5): summary, one month
 * calendar per month in range, legend, exceptions list, optional daily table,
 * and two signature boxes (prepared by, employee acknowledgement).
 *
 * States are never signalled by colour alone: every state has a glyph and,
 * on exception days, a word. Punch direction is unknown, so the paper prints
 * the first and last punch of the day, never in/out.
 */

import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'

import { formatStatementDate, formatStatementMonth, statementLocale } from '../statementModel'
import {
  EXCEPTION_STATES,
  LEGEND_STATES,
  attendanceStats,
  calendarCells,
  exceptionCases,
  monthsIn,
  weekdayOrder,
  type PaperCase,
  type PaperDay,
  type PaperState,
} from './attendancePaperModel'
import type { AttendanceSettings } from './printSettings'
import { tableBlocks, usePaperT, type TableRow } from './paperBlocks'
import { Mono, ScopeLine, SignatureBlocks, StatementSheet, type PaperFrame } from './StatementLetterhead'

interface Props {
  frame: Omit<PaperFrame, 'title' | 'lineTotal' | 'lang' | 'orient'>
  settings: AttendanceSettings
  days: PaperDay[]
  /** Shift code -> "07:00 - 15:00", from the cases themselves. */
  shiftWindows: Map<string, string>
  /** Leave and absence verdicts were withheld for this reader. */
  leaveHidden: boolean
}

const GLYPH: Record<PaperState, ReactNode> = {
  verified: <path d="M2 6.5l2.6 2.6L10 3.2" />,
  grace: (
    <>
      <circle cx="6" cy="6" r="5" />
      <path d="M3.7 6.2l1.7 1.7 2.9-3.3" />
    </>
  ),
  late: <path d="M6 1.6 11 10.4H1z" fill="currentColor" />,
  absent: (
    <>
      <rect x="1.6" y="1.6" width="8.8" height="8.8" />
      <path d="M3.9 3.9l4.2 4.2M8.1 3.9 3.9 8.1" />
    </>
  ),
  unpaired: (
    <>
      <circle cx="6" cy="6" r="4.6" />
      <path d="M6 1.4a4.6 4.6 0 0 1 0 9.2z" fill="currentColor" />
    </>
  ),
  leave: (
    <>
      <rect x="1.6" y="1.6" width="8.8" height="8.8" />
      <path d="M2 10 10 2M2 6l4-4M6 10l4-4" />
    </>
  ),
  pending: <circle cx="6" cy="6" r="4.6" strokeDasharray="1.6 1.6" />,
  rest: <path d="M3 6h6" />,
}

function Glyph({ state }: { state: PaperState }): React.JSX.Element {
  return (
    <svg
      className={`st-gl t-${state}`}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPH[state]}
    </svg>
  )
}

function weekdayName(index: number, lang: 'ar' | 'en', style: 'short' | 'long'): string {
  // 4 Jan 1970 was a Sunday: index 0 lines up with getUTCDay().
  return new Intl.DateTimeFormat(statementLocale(lang), { weekday: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(1970, 0, 4 + index)),
  )
}

function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function AttendancePaper({ frame, settings, days, shiftWindows, leaveHidden }: Props): React.JSX.Element {
  const lang = settings.lang
  const t = usePaperT(lang)
  const stats = attendanceStats(days)
  const exceptions = exceptionCases(days)
  const letter = (code: string | null): string =>
    code ? t(`statementPrint.paper.shiftLetter.${code}`, { defaultValue: code.slice(0, 1).toUpperCase() }) : ''
  const stateLabel = (state: PaperState): string => t(`statementPrint.paper.state.${state}`)
  const punch = (time: string | null, nextDay = false): ReactNode =>
    time ? <Mono>{nextDay ? `${time} +1` : time}</Mono> : '-'
  const shiftCell = (code: string | null): ReactNode =>
    code ? (
      <>
        <span className="st-shl">{letter(code)}</span> {t(`attendance.shift.${code}`, { defaultValue: code })}
      </>
    ) : (
      '-'
    )

  const blocks: ReactNode[] = []
  if (leaveHidden) {
    blocks.push(
      <p className="st-scope" key="privacy">
        {t('statementPrint.paper.leaveHidden')}
      </p>,
    )
  }
  if (days.every((day) => day.cases.length === 0)) {
    blocks.push(
      <p className="st-scope" key="nodata">
        {t('statementPrint.paper.noData')}
      </p>,
    )
  }

  if (settings.summary) {
    const pairs: [string, ReactNode][] = [
      [t('statementPrint.paper.sum.scheduled'), String(stats.scheduled)],
      [t('statementPrint.paper.sum.onTime'), String(stats.onTime)],
      [t('statementPrint.paper.sum.grace'), String(stats.grace)],
      [
        t('statementPrint.paper.sum.late'),
        <>
          {String(stats.late)} <small>{t('statementPrint.paper.sum.lateMinutes', { minutes: stats.lateMinutes })}</small>
        </>,
      ],
      [t('statementPrint.paper.sum.absent'), String(stats.absent)],
      [t('statementPrint.paper.sum.single'), String(stats.single)],
      [t('statementPrint.paper.sum.rest'), String(stats.restDays)],
      [
        t('statementPrint.paper.sum.punctuality'),
        <>
          {stats.punctuality === null ? '-' : `${stats.punctuality}%`}{' '}
          <small>{t('statementPrint.paper.sum.punctualityHint')}</small>
        </>,
      ],
    ]
    if (stats.leaveDays > 0) pairs.push([t('statementPrint.paper.sum.leave'), String(stats.leaveDays)])
    if (stats.pending > 0) pairs.push([t('statementPrint.paper.sum.pending'), String(stats.pending)])
    if (pairs.length % 2) pairs.push(['', ''])
    const rows: [string, ReactNode][][] = []
    for (let i = 0; i < pairs.length; i += 2) rows.push([pairs[i], pairs[i + 1]])
    blocks.push(
      <section className="st-sec" key="summary" data-section="summary">
        <h2>{t('statementPrint.paper.summary')}</h2>
        <table className="st-sum">
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map(([k, v], j) => (
                  <Pair key={j} k={k} v={v} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>,
    )
  }

  if (settings.calendar) {
    const byDate = new Map(days.map((day) => [day.date, day]))
    const order = weekdayOrder(lang)
    for (const month of monthsIn(settings.from, settings.to)) {
      blocks.push(
        <section className="st-calwrap" key={`cal-${month}`} data-section="calendar" data-month={month}>
          <h2>{formatStatementMonth(`${month}-01`, lang)}</h2>
          <div className="st-cal">
            {order.map((wd) => (
              <div className="wd" key={`wd-${wd}`} data-testid="calendar-weekday">
                {weekdayName(wd, lang, 'short')}
              </div>
            ))}
            {calendarCells(month, lang).map((date, index) => {
              if (date === null) return <div className="c blank" key={`b-${index}`} data-testid="calendar-blank" />
              const day = byDate.get(date)
              const dn = <span className="dn">{String(Number(date.slice(8)))}</span>
              if (!day) {
                return (
                  <div className="c out" key={date} data-testid="calendar-day">
                    {dn}
                  </div>
                )
              }
              return <CalendarCell key={date} day={day} dn={dn} t={t} letter={letter} punches={settings.punches} />
            })}
          </div>
        </section>,
      )
    }
  }

  if (settings.calendar || settings.daily) {
    const codes = [...shiftWindows.keys()]
    blocks.push(
      <section className="st-leg" key="legend">
        <h3>{t('statementPrint.paper.legend')}</h3>
        {LEGEND_STATES.map((state) => (
          <div key={state}>
            <Glyph state={state} />
            {stateLabel(state)}
          </div>
        ))}
        {codes.map((code) => (
          <div key={code}>
            <span className="st-shl">{letter(code)}</span>
            {t(`attendance.shift.${code}`, { defaultValue: code })} <Mono>{shiftWindows.get(code)}</Mono>
          </div>
        ))}
        <p className="wide">{t('statementPrint.paper.noDirection')}</p>
      </section>,
    )
  }

  if (settings.exceptions) {
    const columns = [
      { label: t('statementPrint.paper.col.date') },
      { label: t('statementPrint.paper.col.shift') },
      { label: t('statementPrint.paper.col.exception') },
      ...(settings.punches
        ? [{ label: t('statementPrint.paper.col.firstPunch') }, { label: t('statementPrint.paper.col.lastPunch') }]
        : []),
      { label: t('statementPrint.paper.col.punches'), num: true },
      { label: t('statementPrint.paper.col.pastGrace'), num: true },
    ]
    const rows: TableRow[] = exceptions.map((c, i) => ({
      key: `${c.date}-${c.shiftCode}-${i}`,
      cells: [
        <>
          {formatStatementDate(c.date, lang)}
          <span className="st-sub">{weekdayName(weekdayOf(c.date), lang, 'long')}</span>
        </>,
        shiftCell(c.shiftCode),
        <>
          <Glyph state={c.state} />
          {stateLabel(c.state)}
        </>,
        ...(settings.punches ? [punch(c.firstPunch), punch(c.lastPunch, c.lastNextDay)] : []),
        String(c.punchCount),
        c.state === 'late' ? String(c.pastGrace) : '-',
      ],
    }))
    blocks.push(
      ...tableBlocks({
        id: 'exceptions',
        heading: t('statementPrint.paper.exceptions'),
        count: t('statementPrint.paper.exceptionsCount', { count: exceptions.length }),
        columns,
        rows,
        emptyText: t('statementPrint.paper.noExceptions'),
      }),
    )
  }

  if (settings.daily) {
    const shown = settings.dailyEx
      ? days.filter((day) => day.cases.some((c) => EXCEPTION_STATES.includes(c.state)))
      : days
    const left = days.length - shown.length
    if (settings.dailyEx && left > 0) {
      blocks.push(
        <ScopeLine key="daily-scope" t={t} items={[t('statementPrint.paper.daysWithoutExceptions', { count: left })]} />,
      )
    }
    const columns = [
      { label: t('statementPrint.paper.col.date') },
      { label: t('statementPrint.paper.col.day') },
      { label: t('statementPrint.paper.col.shift') },
      { label: t('statementPrint.paper.col.state') },
      ...(settings.punches
        ? [{ label: t('statementPrint.paper.col.firstPunch') }, { label: t('statementPrint.paper.col.lastPunch') }]
        : []),
      { label: t('statementPrint.paper.col.punches'), num: true },
      { label: t('statementPrint.paper.col.pastGrace'), num: true },
    ]
    const rows: TableRow[] = shown.flatMap((day) => {
      const cases: (PaperCase | null)[] = day.cases.length > 0 ? day.cases : [null]
      return cases.map((c, i) => ({
        key: `${day.date}-${i}`,
        cells: [
          formatStatementDate(day.date, lang),
          weekdayName(weekdayOf(day.date), lang, 'long'),
          c ? shiftCell(c.shiftCode) : '-',
          <>
            <Glyph state={c ? c.state : 'rest'} />
            {stateLabel(c ? c.state : 'rest')}
          </>,
          ...(settings.punches ? [punch(c?.firstPunch ?? null), punch(c?.lastPunch ?? null, c?.lastNextDay)] : []),
          c ? String(c.punchCount) : '-',
          c?.state === 'late' ? String(c.pastGrace) : '-',
        ],
      }))
    })
    blocks.push(
      ...tableBlocks({
        id: 'daily',
        heading: t('statementPrint.paper.daily'),
        columns,
        rows,
        emptyText: t('statementPrint.paper.noExceptions'),
      }),
    )
  }

  if (settings.sign) {
    const e = frame.employee
    blocks.push(
      <SignatureBlocks
        key="sign"
        t={t}
        boxes={[
          { role: t('statementPrint.paper.preparedBy'), name: frame.issue.byline },
          {
            role: t('statementPrint.paper.employeeAck'),
            name: lang === 'ar' ? (e.name_ar ?? e.name_en) : e.name_en,
          },
        ]}
      />,
    )
  }

  return (
    <StatementSheet
      frame={{
        ...frame,
        lang,
        orient: settings.orient,
        title: t('statementPrint.paper.attendanceTitle'),
        lineTotal: t('statementPrint.paper.lineTotalAttendance', {
          days: days.length,
          exceptions: exceptions.length,
        }),
      }}
      blocks={blocks}
    />
  )
}

function Pair({ k, v }: { k: string; v: ReactNode }): React.JSX.Element {
  return (
    <>
      <td className="k">{k}</td>
      <td className="v">{v}</td>
    </>
  )
}

function CalendarCell({
  day,
  dn,
  t,
  letter,
  punches,
}: {
  day: PaperDay
  dn: ReactNode
  t: TFunction
  letter: (code: string | null) => string
  punches: boolean
}): React.JSX.Element {
  const s = day.state
  const lead = day.cases.find((c) => c.state === s) ?? day.cases[0]
  // On-time and inside-grace days carry only their glyph; everything else says what it is.
  const tag =
    s === 'late'
      ? t('statementPrint.paper.tag.late', { minutes: lead?.pastGrace ?? 0 })
      : s === 'verified' || s === 'grace'
        ? ''
        : t(`statementPrint.paper.tag.${s}`)
  const letters = day.cases.map((c) => letter(c.shiftCode)).filter(Boolean)
  const first = day.cases.find((c) => c.firstPunch)
  return (
    <div className={`c s-${s}`} data-testid="calendar-day" data-state={s}>
      {dn}
      <span className="sh">{letters.length > 0 ? letters.join(' ') : ''}</span>
      <span className="gx">
        <Glyph state={s} />
        {tag && <span>{tag}</span>}
      </span>
      {punches && first && (
        <span className="pn">
          {first.firstPunch}
          <br />
          {first.lastPunch ? `${first.lastPunch}${first.lastNextDay ? ' +1' : ''}` : '-'}
        </span>
      )}
    </div>
  )
}
