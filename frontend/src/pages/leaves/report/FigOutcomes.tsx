/**
 * FigOutcomes — Fig. 3: "Request outcomes" band + the request lifecycle flow
 * line (Requested → Confirmed, with Rejected/Cancelled branches). Band
 * segments render only outcomes with records, prototype `.band`/`.seg`
 * geometry: a 76px-tall band, each segment a stacked column (big mono count,
 * glyph + label, %), proportional via flex-grow with a min-width floor so
 * minority outcomes stay labelable (true proportions live in the aria-label
 * and the `<details>` table). Zero-records scope renders the same muted "—"
 * empty state as Fig. 1 and hides the details.
 */
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { fmtN } from './fmt'
import type { OutcomeAgg, OutcomeBucket } from './reportData'

interface FigOutcomesProps {
  data: OutcomeAgg[]
  scopeLabel: string
}

/** Band/dot tones + glyph per lifecycle bucket. */
const BUCKET_META: Record<OutcomeBucket, { band: string; dot: string; glyph: string }> = {
  settled:  { band: 'bg-success-soft text-success',  dot: 'bg-success',  glyph: '✓' },
  inMotion: { band: 'bg-warning-soft text-warning',  dot: 'bg-warning',  glyph: '◷' },
  rejected: { band: 'bg-accent-soft text-accent',    dot: 'bg-accent',   glyph: '✕' },
  cancelled: { band: 'bg-surface-tinted text-muted-foreground', dot: 'bg-muted', glyph: '⊘' },
}

/** Flow line stages — the request lifecycle displayed as decorative context.
 * Each stage carries its bucket key so the colored dot can be rendered from
 * BUCKET_META (mirrors the old Generated→Approved flow line's stage dots). */
const FLOW_STAGES: Array<{ key: string; bucket: OutcomeBucket; branch?: boolean }> = [
  { key: 'Requested', bucket: 'inMotion' },
  { key: 'Confirmed', bucket: 'settled' },
  { key: 'Rejected', bucket: 'rejected', branch: true },
  { key: 'Cancelled', bucket: 'cancelled', branch: true },
]

const TH_NUM = 'border-b border-border px-1.5 py-1 text-end font-semibold text-muted-foreground'
const TD_NUM = 'border-b border-hairline px-1.5 py-1 text-end font-mono tabular-nums'

export function FigOutcomes({ data, scopeLabel }: FigOutcomesProps): React.JSX.Element {
  const { t } = useTranslation()
  const bucketLabel = (bucket: OutcomeBucket): string =>
    t(`leaves.report.outcome.${bucket}`, { defaultValue: bucket })

  const total = data.reduce((sum, d) => sum + d.count, 0)
  const segments = data.filter((d) => d.count > 0)

  const caption = `${t('leaves.report.fig3Caption')} — ${scopeLabel}`
  const ariaLabel = `${caption}: ${segments
    .map((d) => `${bucketLabel(d.bucket)} ${d.count} (${fmtN(d.pct)}%)`)
    .join(', ')}`

  return (
    <figure className="rounded-2xl border border-hairline bg-surface p-4">
      <figcaption className="font-mono text-[0.7em] uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal">
        {caption}
      </figcaption>

      {total === 0 ? (
        <p className="py-6 text-center text-[0.78em] text-muted-foreground">—</p>
      ) : (
        <div role="img" aria-label={ariaLabel} className="mt-3">
          {/* Request lifecycle flow line — decorative; data lives in the band/table. */}
          <div
            aria-hidden="true"
            className="mb-2 flex flex-wrap items-center gap-1.5 text-[0.68em] text-muted-foreground"
          >
            {FLOW_STAGES.map((stage, i) => (
              <span key={stage.key} className="inline-flex items-center gap-1.5">
                {i > 0 && (
                  <span className="inline-block text-faint">
                    {stage.branch ? (
                      '/'
                    ) : (
                      <span className="inline-block rtl:rotate-180">→</span>
                    )}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 font-semibold whitespace-nowrap">
                  <span className={cn('h-1.5 w-1.5 rounded-full', BUCKET_META[stage.bucket].dot)} />
                  {t(`leaves.display.${stage.key}`, { defaultValue: stage.key })}
                </span>
              </span>
            ))}
          </div>

          <div className="flex h-[76px] w-full gap-0.5 overflow-hidden rounded-lg">
            {segments.map((d) => (
              /* flex-grow by count + a min-width floor (prototype `.seg`):
                 minority outcomes keep their stacked count/label/% legible
                 while the dominant one takes the rest of the band. */
              <span
                key={d.bucket}
                title={`${bucketLabel(d.bucket)} ${d.count} (${fmtN(d.pct)}%)`}
                className={cn(
                  'flex min-w-[68px] flex-col items-center justify-center gap-0.5 overflow-hidden px-1.5',
                  BUCKET_META[d.bucket].band,
                )}
                style={{ flexGrow: d.count }}
              >
                <span className="font-mono text-[1.15em] font-semibold leading-tight tabular-nums">
                  {d.count}
                </span>
                <span className="flex items-center gap-1 whitespace-nowrap text-[0.68em] font-semibold">
                  <span aria-hidden="true">{BUCKET_META[d.bucket].glyph}</span>
                  {bucketLabel(d.bucket)}
                </span>
                <bdi dir="ltr" className="font-mono text-[0.65em] tabular-nums opacity-85">
                  {fmtN(d.pct)}%
                </bdi>
              </span>
            ))}
          </div>
        </div>
      )}

      {total > 0 && (
        <details className="mt-3 border-t border-hairline pt-2">
          <summary className="cursor-pointer font-mono text-[0.7em] uppercase tracking-[0.08em] text-faint hover:text-muted-foreground rtl:tracking-normal">
            {t('leaves.report.viewData')}
          </summary>
          <table className="mt-2 w-full border-collapse text-[0.72em]">
            <thead>
              <tr>
                <th className="border-b border-border px-1.5 py-1 text-start font-semibold text-muted-foreground">
                  {t('leaves.report.colOutcome')}
                </th>
                <th className={TH_NUM}>{t('leaves.report.colRecords')}</th>
                <th className={TH_NUM}>{t('leaves.report.colPct')}</th>
                <th className={TH_NUM}>{t('leaves.report.colDays')}</th>
                <th className={TH_NUM}>{t('leaves.report.colLead')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.bucket}>
                  <td className="border-b border-hairline px-1.5 py-1">
                    <span className="me-1" aria-hidden="true">
                      {BUCKET_META[d.bucket].glyph}
                    </span>
                    {bucketLabel(d.bucket)}
                  </td>
                  <td className={TD_NUM}>{d.count}</td>
                  <td className={TD_NUM}>
                    <bdi dir="ltr">{fmtN(d.pct)}%</bdi>
                  </td>
                  <td className={TD_NUM}>{d.days}</td>
                  <td className={TD_NUM}>
                    {d.medianLeadDays === null ? (
                      '—'
                    ) : (
                      <bdi dir="ltr">
                        {t('leaves.report.leadDays', { count: d.medianLeadDays })}
                      </bdi>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  )
}
