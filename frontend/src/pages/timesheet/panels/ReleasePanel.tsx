/**
 * The release strip: both filenames, the freeze sentence, the seal, and the
 * two-step reopen (UI spec §16.2, §9's Closed row, §11's copy table).
 *
 * The sentence that matters: **the first download closes the month and freezes
 * this grid.** That is why producing either workbook is `timesheet.edit` while
 * the per-employee extract needs only `timesheet.view` — one freezes a
 * deliverable that leaves the building, the other does not.
 *
 * Reopen is two steps on purpose. A closed month is a workbook somebody has
 * already sent; taking it back is not a single click, and the confirm carries
 * the audit sentence rather than a modal.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TimesheetIssue, TimesheetVariant } from '@/lib/api'

import { monthWorkbookNames } from '../useTimesheet'

export interface ReleasePanelProps {
  year: number
  month: number
  closed: boolean
  closedAt: string | null
  closedBy: string | null
  /** Keyed by employee and never joined to `rows`; only the count gates here. */
  blocking: TimesheetIssue[]
  canEdit: boolean
  onDownload: (variant: TimesheetVariant) => void
  onClose: () => void
  onReopen: () => void
}

export function ReleasePanel({
  year,
  month,
  closed,
  closedAt,
  closedBy,
  blocking,
  canEdit,
  onDownload,
  onClose,
  onReopen,
}: ReleasePanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const blocked = blocking.length > 0 && !closed
  const names = year > 0 ? monthWorkbookNames(year, month) : null

  return (
    <div className="flex flex-col gap-3">
      {closed && (
        <span
          data-testid="release-seal"
          className="inline-flex flex-wrap items-center gap-2 self-start rounded-full bg-success-soft px-3 py-1 text-[0.76em] font-semibold text-success"
        >
          <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full border border-success">
            ✓
          </span>
          {t('timesheet.closedOn', {
            date: closedAt
              ? new Date(closedAt).toLocaleDateString(i18n.language, {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : '',
            who: closedBy ?? '',
          })}
        </span>
      )}

      {names && (
        <div className="flex flex-col gap-0.5">
          <span
            data-ts-caps
            className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-faint"
          >
            {t('timesheet.release.files')}
          </span>
          {/* The deliverables' own names, identical in both UI languages, so they
              are not interface copy. A quoted filename needs `direction: ltr` AND
              isolate: isolation alone inherits its base direction from the Arabic
              around it and `.xlsx` jumps to the wrong end (UI spec §14). */}
          <div data-testid="release-files" className="flex flex-col gap-0.5">
            <span
              dir="ltr"
              className="truncate font-mono text-[0.7rem] text-faint [unicode-bidi:isolate]"
            >
              {names.attendance}
            </span>
            <span
              dir="ltr"
              className="truncate font-mono text-[0.7rem] text-faint [unicode-bidi:isolate]"
            >
              {names.statistics}
            </span>
          </div>
        </div>
      )}

      <p className="max-w-[74ch] text-[0.78em] text-muted-foreground">
        {closed
          ? t('timesheet.frozen')
          : blocked
            ? t('timesheet.release.blocked')
            : t('timesheet.freezeWarning')}
      </p>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {/* `download()` never rejects — `onError` has already shown the
              server's own message — so `void download(args)` is the whole call
              and a `.catch` here would be noise. */}
          <button
            type="button"
            disabled={blocked}
            onClick={() => onDownload('attendance')}
            className="rounded-full bg-primary px-4 py-2 text-[0.82em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            ↓ {t('timesheet.downloadAttendance')}
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => onDownload('statistics')}
            className="rounded-full border border-border-strong bg-surface px-4 py-2 text-[0.82em] font-semibold text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            ↓ {t('timesheet.downloadStatistics')}
          </button>

          {!closed && !blocked && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-border-strong bg-surface px-3 py-1.5 text-[0.76em] font-semibold text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('timesheet.release.close')}
              </button>
              <span className="max-w-[42ch] text-[0.72em] text-muted-foreground">
                {t('timesheet.release.closeNote')}
              </span>
            </>
          )}

          {closed &&
            (confirming ? (
              <span className="flex flex-wrap items-center gap-2 text-[0.76em] text-accent">
                {t('timesheet.reopenConsequence')}
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false)
                    onReopen()
                  }}
                  className="rounded-full bg-accent px-3 py-1 text-[0.95em] font-semibold text-primary-foreground transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('timesheet.release.reopenConfirm')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-full border border-border-strong bg-surface px-3 py-1 text-[0.95em] font-semibold text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('common.cancel')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-full border border-accent/40 bg-surface px-3 py-1.5 text-[0.76em] font-semibold text-accent transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('timesheet.reopen')}
              </button>
            ))}

          {blocked && (
            <span className="text-[0.76em] font-semibold text-accent">{t('timesheet.blocking')}</span>
          )}
        </div>
      ) : (
        <p className="text-[0.76em] font-medium text-warning">{t('timesheet.needsEdit')}</p>
      )}
    </div>
  )
}
