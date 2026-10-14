/**
 * ReportPaper — the leave report as A4 sheets, in the UI language: one sheet
 * (or run of pages) per month, each a single table whose `thead` carries the
 * letterhead + month and whose `tfoot` carries the footer, because a table's
 * header and footer groups are what a browser repeats on every printed page.
 *
 * Two hosts: the Report view shows it on screen as a 1:1 preview (`onScreen`),
 * and the Register view mounts it paper-only while the browser prints
 * (Ctrl+P). `print-leave-report` takes its own named @page (index.css) with
 * the page counter; everything around it carries `data-print-hide`.
 *
 * The sheet pins its own ink and paper (not theme tokens): a dark-theme
 * operator still previews and prints dark text on a light sheet. Graph bars
 * are SVG fills, which the print stylesheet's background flattening can't
 * strip.
 */
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { leaveEmployeeName } from '../leaveEmployeeName'
import { dateLocale, fmtDayMonthYear, fmtMonthYear } from './fmt'
import type { ReportSection } from './reportData'

const INK = '#1c1f24'
const NAVY = '#0d2845'
const CELL = 'border border-neutral-400 px-2 py-1 text-start align-middle'
const SHEET = cn(
  'w-full border-collapse',
  'mx-auto max-w-[210mm] bg-[#fffdf8] shadow-sm ring-1 ring-border',
  'print:max-w-none print:shadow-none print:ring-0 print:break-after-page last:print:break-after-auto',
)

interface ReportPaperProps {
  sections: ReportSection[]
  /** "Leave report: Sick Leave". */
  title: string
  /** Already-translated scope lines (period, staff, status, employee). */
  facts: string[]
  /** Heading of the single empty sheet when nothing matched. */
  emptyHeading: string
  today: string
  signatures: boolean
  /** Also show the sheets on screen (the Report view's preview). */
  onScreen?: boolean
}

export function ReportPaper({
  sections,
  title,
  facts,
  emptyHeading,
  today,
  signatures,
  onScreen = false,
}: ReportPaperProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = dateLocale(i18n.language)

  const sheet = (key: string, heading: string, body: React.ReactNode): React.JSX.Element => (
    <table key={key} className={SHEET} style={{ color: INK }}>
      <thead>
        <tr>
          <td className="px-[12mm] pt-[10mm] print:px-0 print:pt-0">
            <div className="flex items-end justify-between gap-6 pb-2">
              <div className="flex min-w-0 items-end gap-4">
                <img src="/brand/gssg-wordmark.png" alt="GSSG" className="h-[9mm] w-auto shrink-0" />
                <div className="min-w-0">
                  <p className="text-[13px] font-bold leading-tight">{title}</p>
                  {facts.length > 0 && <p className="text-[9.5px] text-neutral-600">{facts.join(' · ')}</p>}
                </div>
              </div>
              <p className="shrink-0 text-end text-[17px] font-bold leading-none" style={{ color: NAVY }}>
                {heading}
              </p>
            </div>
            <div className="mb-4 border-b-2" style={{ borderColor: NAVY }} />
          </td>
        </tr>
      </thead>
      <tfoot>
        <tr>
          <td className="px-[12mm] pb-[10mm] print:px-0 print:pb-0">
            <div className="mt-4 flex justify-between gap-4 border-t border-neutral-400 pt-1.5 text-[8.5px] text-neutral-600">
              <span>{`GSSG · ${title}`}</span>
              <span>{t('leaves.report.printedOn', { date: fmtDayMonthYear(today, locale) })}</span>
            </div>
          </td>
        </tr>
      </tfoot>
      <tbody>
        <tr>
          <td className="px-[12mm] align-top text-[10px] print:px-0">{body}</td>
        </tr>
      </tbody>
    </table>
  )

  return (
    <div className={cn('print-leave-report', onScreen ? 'flex flex-col gap-6' : 'hidden print:block')}>
      {sections.length === 0
        ? sheet(
            'empty',
            emptyHeading,
            <p className="py-10 text-center text-neutral-600">{t('leaves.report.emptyReport')}</p>,
          )
        : sections.map((s) => {
            const maxUnitDays = Math.max(...s.units.map((u) => u.days))
            return sheet(
              s.month,
              fmtMonthYear(s.month, locale),
              <>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-neutral-100">
                      <th className={cn(CELL, 'w-8 text-center')}>#</th>
                      <th className={cn(CELL, 'w-20')}>{t('leaves.report.colId')}</th>
                      <th className={CELL}>{t('leaves.report.colName')}</th>
                      <th className={CELL}>{t('leaves.report.colUnit')}</th>
                      <th className={cn(CELL, 'w-24 text-end')}>{t('leaves.report.colTotalDays')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.lines.map((l, i) => (
                      <tr key={l.row.employee_id} className="break-inside-avoid">
                        <td className={cn(CELL, 'text-center tabular-nums')}>{i + 1}</td>
                        <td className={CELL}>
                          <bdi dir="ltr" className="font-mono">
                            {l.row.employee_id}
                          </bdi>
                        </td>
                        <td className={CELL}>{leaveEmployeeName(l.row, i18n.language)}</td>
                        <td className={CELL}>
                          <bdi>{l.unit || t('dutyLocations.unassigned')}</bdi>
                        </td>
                        <td className={cn(CELL, 'text-end font-bold tabular-nums')}>{l.days}</td>
                      </tr>
                    ))}
                    <tr className="break-inside-avoid bg-neutral-50 font-bold">
                      <td className={CELL} colSpan={4}>
                        {t('leaves.report.totalEmployees', { count: s.lines.length })}
                      </td>
                      <td className={cn(CELL, 'text-end tabular-nums')}>{s.days}</td>
                    </tr>
                  </tbody>
                </table>

                <section className="mt-6 break-inside-avoid">
                  <h2 className="mb-2 text-[11px] font-bold" style={{ color: NAVY }}>
                    {t('leaves.report.daysByUnit')}
                  </h2>
                  <div className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-x-3 gap-y-1.5">
                    {s.units.map((u) => (
                      <div key={u.unit} className="contents">
                        <span className="truncate">
                          <bdi>{u.unit || t('dutyLocations.unassigned')}</bdi>
                        </span>
                        {/* Bars grow from the inline start: mirrored in Arabic. */}
                        <svg className="h-3 w-full rtl:-scale-x-100" aria-hidden="true">
                          <rect width="100%" height="100%" fill="#ece9e1" />
                          <rect width={`${(u.days / maxUnitDays) * 100}%`} height="100%" fill={NAVY} />
                        </svg>
                        <span className="whitespace-nowrap text-end">
                          <b>{t('leaves.report.totalsDays', { count: u.days })}</b>
                          <span className="text-neutral-600">
                            {' · '}
                            {t('leaves.report.totalsEmployees', { count: u.employees })}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                {signatures && (
                  <section className="mt-10 grid break-inside-avoid grid-cols-2 gap-10">
                    {(['preparedBy', 'approvedBy'] as const).map((role) => (
                      <div key={role} className="flex flex-col gap-3">
                        <p className="font-bold">{t(`leaves.report.${role}`)}</p>
                        {(['sigName', 'sigSignature', 'sigDate'] as const).map((line) => (
                          <p key={line} className="flex items-end gap-2">
                            <span className="shrink-0 text-neutral-600">{t(`leaves.report.${line}`)}</span>
                            <span className="h-4 flex-1 border-b border-neutral-500" />
                          </p>
                        ))}
                      </div>
                    ))}
                  </section>
                )}
              </>,
            )
          })}
    </div>
  )
}
