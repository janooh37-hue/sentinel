import { Trans, useTranslation } from 'react-i18next'

import { siteToday } from '@/components/employees/useAttendanceAttention'

import { onSiteSummary, siteTime, type AttendanceRow, type OnSiteBucket } from './attendanceModel'

interface Props {
  rows: readonly AttendanceRow[]
  operationalDate: string
  /** The day payload's timestamp, shared with the row verdicts. */
  now: Date
}

const BUCKETS: readonly OnSiteBucket[] = ['onSite', 'left', 'notArrived', 'leave', 'nationalService']

/** One person per bucket, even when the filtered register contains two shifts. */
export function OnSiteNowSummary({ rows, operationalDate, now }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const today = operationalDate === siteToday()
  const summary = onSiteSummary(rows, { now })
  const title = t(today ? 'attendance.onSiteNow.title' : 'attendance.onSiteNow.daySummary')

  return (
    <section aria-label={title} className="my-3 rounded-xl border border-border bg-surface px-4 py-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[0.85em] font-semibold">{title}</h2>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[0.75em] text-muted-foreground">
          <span>
            <Trans
              i18nKey="attendance.onSiteNow.asOf"
              values={{ time: siteTime(now.toISOString()) }}
              components={[<bdi dir="ltr" key="time" className="font-mono tabular-nums" />]}
            />
          </span>
          <span>
            <Trans
              i18nKey="attendance.onSiteNow.people"
              count={summary.people}
              components={[<bdi dir="ltr" key="people" className="font-mono tabular-nums" />]}
            />
          </span>
        </div>
      </header>
      <dl className={`mt-3 grid grid-cols-2 gap-x-4 gap-y-3 ${today ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
        {BUCKETS.filter((bucket) => today || bucket !== 'onSite').map((bucket) => (
          <div key={bucket} className="flex flex-col-reverse">
            <dt className="text-[0.75em] text-muted-foreground">{t(`attendance.onSiteNow.${bucket}`)}</dt>
            <dd className="text-[1.2em] font-semibold tabular-nums">
              <bdi dir="ltr">{summary[bucket]}</bdi>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
