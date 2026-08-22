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
 *
 * The band is also where a man is brought in from the OTHER workbook. The drag
 * bands and the grip picker belong to the sheet on screen, and the design has
 * the operator select the Drivers sheet to move somebody to the Drivers
 * workbook — where he is not printed, so there is nothing there to grab. Naming
 * him is therefore a control of the MODE rather than of the sheet, and it sits
 * on the band's own second line: two choices and one button, which is the whole
 * gesture the design's sentence assumes.
 */

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { TimesheetDesignationRead, TimesheetRow, TimesheetSheet } from '@/lib/api'

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
  /** The valid targets: active designations of the sheet on screen. */
  designations: readonly TimesheetDesignationRead[]
  /** The other workbook's men who can still be moved onto this sheet. */
  crossRows: readonly TimesheetRow[]
  /** The other workbook has been asked for and has not arrived yet. */
  crossLoading: boolean
  /** Stage one arrival. Same callback the drop bands and the grip picker use. */
  onStage: (employeeId: string, designationId: number) => void
  onSave: () => void
  onCancel: () => void
}

/** The same pill the filter strip and the legend use, so a mode reads as one. */
const CONTROL =
  'inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[0.72em] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** The same pill, with the disabled state a submit control needs. */
const SUBMIT = `${CONTROL} disabled:cursor-not-allowed disabled:opacity-40`

/** The band's own field pair: small, on one line, and never taller than it. */
const FIELD =
  'rounded-lg border border-border bg-surface px-1.5 py-0.5 text-[0.72em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const FIELD_LABEL = 'text-[0.72em] font-semibold text-muted-foreground'

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
  const { t, i18n } = useTranslation()
  // The sentence is the interface's, so the NAME inside it has to be the one
  // that interface reads: an Arabic label wrapped around an English
  // designation is a mixed-language leak no locale parity test can see.
  const arabic = i18n.language.startsWith('ar')
  const label = t('timesheet.rosterEdit.rename', {
    name: arabic ? designation.name_ar : designation.name_en,
  })
  return (
    <DesignationDialog sheet={sheet} designation={designation}>
      <button
        type="button"
        lang={i18n.language}
        aria-label={label}
        title={label}
        className="ms-auto inline-grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Pencil className="h-3 w-3" strokeWidth={2} aria-hidden />
      </button>
    </DesignationDialog>
  )
}

/**
 * Naming a man the sheet on screen does not print yet.
 *
 * Two native selects and one button. The platform's own picker is the calm
 * answer here: it is one line tall in a band that has to stay one line tall, it
 * is reachable by keyboard and by touch with no handler of its own, and the two
 * lists are exactly the two the mode already holds — the other workbook's men,
 * and this sheet's targets. The men are the page's list, so somebody already
 * printed here or already staged is not in it.
 *
 * The chosen target is resolved back through `designations` instead of being
 * trusted as a number, so a catalog that changed under an open draft can never
 * stage an id this sheet has no band for.
 */
function CrossWorkbookPicker({
  designations,
  rows,
  loading,
  onStage,
}: {
  designations: readonly TimesheetDesignationRead[]
  rows: readonly TimesheetRow[]
  loading: boolean
  onStage: (employeeId: string, designationId: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [employee, setEmployee] = useState('')
  const [target, setTarget] = useState('')
  const chosen = designations.find((each) => String(each.id) === target) ?? null

  const stage = (event: React.FormEvent): void => {
    event.preventDefault()
    if (employee === '' || chosen === null) return
    onStage(employee, chosen.id)
    // He is on this sheet now, so the list he came from no longer holds him.
    // The target stays: two men into one designation is a choice made once.
    setEmployee('')
  }

  return (
    <div
      role="group"
      aria-labelledby="roster-cross-label"
      className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 border-t border-hairline pt-1.5"
    >
      <span id="roster-cross-label" className={FIELD_LABEL}>
        {t('timesheet.rosterEdit.cross.label')}
      </span>
      {loading ? (
        <span role="status" className="text-[0.75em] text-muted-foreground">
          {t('timesheet.rosterEdit.cross.loading')}
        </span>
      ) : rows.length === 0 ? (
        // Said plainly and in one line. It costs this one control and nothing
        // else: the sheet on screen keeps its drop bands and its grip picker.
        <span className="text-[0.75em] text-muted-foreground">
          {t('timesheet.rosterEdit.cross.empty')}
        </span>
      ) : (
        <form onSubmit={stage} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label className={FIELD_LABEL} htmlFor="roster-cross-employee">
            {t('timesheet.rosterEdit.cross.employee')}
          </label>
          <select
            id="roster-cross-employee"
            value={employee}
            onChange={(event) => setEmployee(event.target.value)}
            className={FIELD}
          >
            <option value="">{t('timesheet.rosterEdit.cross.choose')}</option>
            {rows.map((row) => (
              // A G-number and the name the workbook prints — data, not copy —
              // so the option declares its own language and direction rather
              // than inheriting an Arabic paragraph's and reordering the id.
              <option key={row.employee_id} value={row.employee_id} lang="en" dir="ltr">
                {`${row.employee_id} — ${row.name_en}`}
              </option>
            ))}
          </select>

          <label className={FIELD_LABEL} htmlFor="roster-cross-target">
            {t('timesheet.rosterEdit.cross.target')}
          </label>
          <select
            id="roster-cross-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className={FIELD}
          >
            <option value="">{t('timesheet.rosterEdit.cross.choose')}</option>
            {designations.map((designation) => (
              // The printed name, in the language it prints in — the band the
              // row will land under says exactly this.
              <option key={designation.id} value={designation.id} lang="en">
                {designation.name_en}
              </option>
            ))}
          </select>

          <button type="submit" disabled={employee === '' || chosen === null} className={SUBMIT}>
            {t('timesheet.rosterEdit.cross.stage')}
          </button>
        </form>
      )}
    </div>
  )
}

export function TimesheetRosterEditor({
  sheet,
  staged,
  pending,
  error,
  designations,
  crossRows,
  crossLoading,
  onStage,
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

      {/* The second line: bringing a man across from the other workbook. Below
          the mode's own controls because it is the rarer gesture of the two,
          and above the refusal because a refused batch is the last word. */}
      <CrossWorkbookPicker
        designations={designations}
        rows={crossRows}
        loading={crossLoading}
        onStage={onStage}
      />

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
