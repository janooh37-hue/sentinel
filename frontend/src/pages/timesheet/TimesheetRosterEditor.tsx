/**
 * Roster edit mode's own band, and the rename control its designation bands
 * carry (design §"Roster edit interaction").
 *
 * It sits inside the sheet card, between the quoted masthead and the scroll
 * region — fixed furniture, like the masthead above it, so entering the mode
 * costs no scroll geometry and the page keeps its ONE scroller. The band leads
 * with its own eyebrow because it is a MODE: the operator has to be able to see
 * at a glance that the sheet is staging moves rather than taking corrections,
 * and the staged count is the second thing they read.
 *
 * It holds nothing. `TimesheetPage` owns `{ editing, draft }`, the baseline the
 * React Query result provides, and the one atomic write; this band reports three
 * intentions and prints what it is handed. That split is what makes Cancel a
 * state change with no request and Save a single batch.
 *
 * The refused batch is printed HERE, beside the draft it refused, rather than
 * being left to the toast the write already raises: a toast is gone in four
 * seconds and the draft it belongs to is still on screen, so the operator who
 * comes back to the sheet needs the sentence to still be there. One alert,
 * replaced on every attempt — never a stack of them.
 */

import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { TimesheetDesignationRead, TimesheetSheet } from '@/lib/api'

import { DesignationDialog } from './DesignationDialog'

export interface TimesheetRosterEditorProps {
  /** The workbook on screen: what a new designation is created on. */
  sheet: TimesheetSheet
  /** How many assignments the draft holds; zero means nothing to save. */
  staged: number
  /** The batch is in flight, so Save must not be pressed a second time. */
  pending: boolean
  /** The server's own sentence from the last refused batch, or `null`. */
  error: string | null
  onSave: () => void
  onCancel: () => void
}

/** The same pill the filter strip and the legend use, so a mode reads as one. */
const CONTROL =
  'inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[0.72em] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Renaming one designation, from the band that prints its name.
 *
 * Rendered by the page and PLACED by the grid: the dialog reaches react-query
 * and the sheet is a props component, so the node crosses that boundary
 * already built (`RosterEdit.renameControl`). The icon is the whole control —
 * the band beside it already says which designation this is, so a second copy
 * of the name would be the only thing on the band said twice.
 */
export function DesignationRenameControl({
  designation,
  sheet,
}: {
  designation: TimesheetDesignationRead
  sheet: TimesheetSheet
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = t('timesheet.rosterEdit.rename', { name: designation.name_en })
  return (
    <DesignationDialog sheet={sheet} designation={designation}>
      <button
        type="button"
        aria-label={label}
        title={label}
        className="ms-auto inline-grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Pencil className="h-3 w-3" strokeWidth={2} aria-hidden />
      </button>
    </DesignationDialog>
  )
}

export function TimesheetRosterEditor({
  sheet,
  staged,
  pending,
  error,
  onSave,
  onCancel,
}: TimesheetRosterEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      data-testid="roster-editor"
      role="group"
      aria-label={t('timesheet.rosterEdit.enter')}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline bg-primary-soft px-3.5 py-1.5"
    >
      <span
        data-ts-caps
        className="shrink-0 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        {t('timesheet.rosterEdit.enter')}
      </span>
      <span className="min-w-0 text-[0.78em] text-muted-foreground">
        {t('timesheet.rosterEdit.banner')}
      </span>
      <span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-[0.72em] font-semibold [unicode-bidi:isolate]">
        {t('timesheet.rosterEdit.staged', { count: staged })}
      </span>

      <div className="ms-auto flex shrink-0 items-center gap-1.5">
        <DesignationDialog sheet={sheet}>
          <button type="button" className={CONTROL}>
            {t('timesheet.rosterEdit.add')}
          </button>
        </DesignationDialog>
        {/* Cancel first, Save last and set off from it: Save is the one that
            reaches the server, and it must not sit under a mis-aimed Cancel. */}
        <button type="button" onClick={onCancel} className={CONTROL}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={staged === 0 || pending}
          className="ms-1.5 inline-flex shrink-0 items-center rounded-full bg-primary px-2.5 py-0.5 text-[0.72em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('timesheet.rosterEdit.save')}
        </button>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="w-full rounded-lg bg-accent-soft px-2.5 py-1.5 text-[0.75em] text-accent"
        >
          {error}
        </p>
      )}
    </div>
  )
}
