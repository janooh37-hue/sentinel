/**
 * FigKindBars — Fig. 1: "Days taken by kind" horizontal bars + a
 * `<details>` View-data table (kind / records / days / employees / avg /
 * share %). Bars are width-based fills inside a full-width transparent
 * trough (direction-safe — they grow from inline-start in both LTR and
 * RTL) and opacity-stepped by rank (largest 1 → smallest 0.45).
 */
import { useTranslation } from 'react-i18next'

import { fmtN } from './fmt'
import { kindMeta, type KindId } from './kinds'
import type { KindAgg } from './reportData'

interface FigKindBarsProps {
  data: KindAgg[]
  scopeLabel: string
  /** True when the figure counts Jan 1 → today (no month scope) — renders the
   * prototype's "(year to date)" caption note. */
  yearToDate: boolean
}

/** Opacity stepped by rank: first (largest) 1, last 0.45, linear between. */
const rankOpacity = (index: number, count: number): number =>
  count <= 1 ? 1 : 1 - (index / (count - 1)) * 0.55

const TH_NUM = 'border-b border-border px-1.5 py-1 text-end font-semibold text-muted-foreground'
const TD_NUM = 'border-b border-hairline px-1.5 py-1 text-end font-mono tabular-nums'

export function FigKindBars({ data, scopeLabel, yearToDate }: FigKindBarsProps): React.JSX.Element {
  const { t } = useTranslation()
  const label = (kind: KindId): string => t(kindMeta(kind).i18nKey)

  const maxDays = data.reduce((max, d) => Math.max(max, d.days), 0)
  const ytdNote = yearToDate ? ` ${t('leaves.report.fig1Ytd')}` : ''
  const caption = `${t('leaves.report.fig1Caption')} — ${scopeLabel}`
  const ariaLabel = `${caption}${ytdNote}: ${data.map((d) => `${label(d.kind)} ${d.days}`).join(', ')}`

  return (
    <figure className="rounded-2xl border border-hairline bg-surface p-4">
      {/* rtl:tracking-normal — Arabic joined script must not be letter-spaced */}
      <figcaption className="font-mono text-[0.7em] uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal">
        {caption}
        {yearToDate && (
          <span className="ms-1.5 normal-case tracking-normal text-faint">
            {t('leaves.report.fig1Ytd')}
          </span>
        )}
      </figcaption>

      {data.length === 0 ? (
        <p className="py-6 text-center text-[0.78em] text-muted-foreground">—</p>
      ) : (
        // One grid so label / bar / value columns align across rows.
        <div
          role="img"
          aria-label={ariaLabel}
          className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-2"
        >
          {data.map((d, i) => (
            <div key={d.kind} className="contents">
              <span className="whitespace-nowrap text-[0.78em] text-foreground">
                <span className="me-1" aria-hidden="true">
                  {kindMeta(d.kind).emoji}
                </span>
                {label(d.kind)}
              </span>
              {/* Full-width transparent trough; width-only fill is direction-safe. */}
              <span className="block h-2.5 min-w-0">
                <span
                  className="block h-2.5 rounded-full bg-primary"
                  style={{
                    width: `${maxDays > 0 ? Math.max((d.days / maxDays) * 100, 2) : 2}%`,
                    opacity: rankOpacity(i, data.length),
                  }}
                />
              </span>
              <span className="text-end font-mono text-[0.78em] font-semibold tabular-nums text-foreground">
                {d.days}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.length > 0 && (
        <details className="mt-3 border-t border-hairline pt-2">
          <summary className="cursor-pointer font-mono text-[0.7em] uppercase tracking-[0.08em] text-faint hover:text-muted-foreground rtl:tracking-normal">
            {t('leaves.report.viewData')}
          </summary>
          <table className="mt-2 w-full border-collapse text-[0.72em]">
            <thead>
              <tr>
                <th className="border-b border-border px-1.5 py-1 text-start font-semibold text-muted-foreground">
                  {t('leaves.report.colKind')}
                </th>
                <th className={TH_NUM}>{t('leaves.report.colRecords')}</th>
                <th className={TH_NUM}>{t('leaves.report.colDays')}</th>
                <th className={TH_NUM}>{t('leaves.report.colEmployees')}</th>
                <th className={TH_NUM}>{t('leaves.report.colAvg')}</th>
                <th className={TH_NUM}>{t('leaves.report.colShare')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.kind}>
                  <td className="border-b border-hairline px-1.5 py-1">
                    <span className="me-1" aria-hidden="true">
                      {kindMeta(d.kind).emoji}
                    </span>
                    {label(d.kind)}
                  </td>
                  <td className={TD_NUM}>{d.records}</td>
                  <td className={TD_NUM}>{d.days}</td>
                  <td className={TD_NUM}>{d.employees}</td>
                  <td className={TD_NUM}>{fmtN(d.avgDays)}</td>
                  <td className={TD_NUM}>
                    <bdi dir="ltr">{fmtN(d.sharePct)}%</bdi>
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
