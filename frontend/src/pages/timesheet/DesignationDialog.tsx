/**
 * Adding a designation, and renaming one — the catalog edits roster editing
 * needs on the spot (design §"Designation catalog").
 *
 * Three decisions worth knowing before changing anything here:
 *
 * 1. **It owns its own trigger.** `DialogTrigger asChild` wraps whatever
 *    control is handed in as `children`, which is what makes Radix put focus
 *    back on that exact control when the modal closes — by Escape, by Cancel,
 *    or by a successful write. Driving `open` from the outside would leave the
 *    focus return to be hand-rolled with a ref, for no gain.
 *
 * 2. **The form mounts with the dialog, not with the trigger.** A closed
 *    dialog is one `useState` and a button, so a band per designation costs
 *    nothing; and every open starts from the catalog's current names with no
 *    stale text and no stale error left over from the last attempt. This is the
 *    same lazy-body shape `books/IncludedPapersDialog.tsx` uses.
 *
 * 3. **The refusal is read INSIDE the modal.** Both catalog hooks are asked for
 *    their `quiet` variant, because a toast behind an open modal is a sentence
 *    the operator cannot reach — a duplicate name has to be answered next to
 *    the field that caused it. That is also why the primitive's built-in corner
 *    close button is hidden (`hideClose`): its `aria-label` is a hardcoded
 *    English "Close", and this dialog is read in Arabic too.
 *
 * The workbook sheet is a create-time decision only. Renaming never moves a
 * designation between workbooks, because that would re-file every man printed
 * under it — so the field is not rendered at all rather than rendered disabled.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { apiErrorMessage } from '@/lib/api'
import type { TimesheetDesignationRead, TimesheetSheet } from '@/lib/api'

import {
  useCreateTimesheetDesignation,
  useUpdateTimesheetDesignation,
} from './useTimesheet'

export interface DesignationDialogProps {
  /** The catalog row being renamed, or absent when adding a new one. */
  designation?: TimesheetDesignationRead | null
  /** The workbook a new designation starts on — the sheet on screen. */
  sheet: TimesheetSheet
  /** The control that opens it; Radix returns focus here on close. */
  children: React.ReactNode
}

const FIELD =
  'w-full rounded-lg border border-border-strong bg-surface-raised px-2.5 py-1.5 text-[0.82rem] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const LABEL = 'mb-1 block text-[0.72rem] font-semibold text-muted-foreground'

function DesignationForm({
  designation,
  sheet,
  onDone,
}: {
  designation: TimesheetDesignationRead | null
  sheet: TimesheetSheet
  onDone: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const create = useCreateTimesheetDesignation({ quiet: true })
  const rename = useUpdateTimesheetDesignation({ quiet: true })
  const [nameEn, setNameEn] = useState(designation?.name_en ?? '')
  const [nameAr, setNameAr] = useState(designation?.name_ar ?? '')
  const [target, setTarget] = useState<TimesheetSheet>(sheet)
  const [refused, setRefused] = useState<string | null>(null)

  const pending = create.isPending || rename.isPending
  // Both printed names or nothing: a designation with one name prints a blank
  // cell on the other workbook. Disabled rather than left to native validation,
  // which says nothing until the button is pressed.
  const ready = nameEn.trim() !== '' && nameAr.trim() !== '' && !pending

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!ready) return
    setRefused(null)
    const name_en = nameEn.trim()
    const name_ar = nameAr.trim()
    const done = { onSuccess: onDone, onError: (err: unknown) => setRefused(apiErrorMessage(err)) }
    if (designation) rename.mutate({ id: designation.id, input: { name_en, name_ar } }, done)
    else create.mutate({ name_en, name_ar, sheet: target }, done)
  }

  return (
    <DialogContent className="max-w-md" hideClose>
      <DialogHeader>
        <DialogTitle>
          {designation ? t('timesheet.rosterEdit.renameTitle') : t('timesheet.rosterEdit.add')}
        </DialogTitle>
        <DialogDescription>
          {designation
            ? t('timesheet.rosterEdit.renameHint')
            : t('timesheet.rosterEdit.addHint')}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-3.5">
        <div>
          <label className={LABEL} htmlFor="designation-name-en">
            {t('timesheet.rosterEdit.nameEn')}
          </label>
          <input
            id="designation-name-en"
            type="text"
            lang="en"
            dir="ltr"
            autoComplete="off"
            value={nameEn}
            onChange={(event) => setNameEn(event.target.value)}
            className={FIELD}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="designation-name-ar">
            {t('timesheet.rosterEdit.nameAr')}
          </label>
          {/* The Arabic name is Arabic whatever the interface language is, so
              the field declares its own language and direction rather than
              inheriting the page's. */}
          <input
            id="designation-name-ar"
            type="text"
            lang="ar"
            dir="rtl"
            autoComplete="off"
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
            className={FIELD}
          />
        </div>

        {!designation && (
          <div>
            <label className={LABEL} htmlFor="designation-sheet">
              {t('timesheet.rosterEdit.sheetField')}
            </label>
            <select
              id="designation-sheet"
              value={target}
              onChange={(event) =>
                setTarget(event.target.value === 'drivers' ? 'drivers' : 'main')
              }
              className={FIELD}
            >
              <option value="main">{t('timesheet.sheetMain')}</option>
              <option value="drivers">{t('timesheet.sheetDrivers')}</option>
            </select>
          </div>
        )}

        {/* One alert, replaced on every attempt: the server's own sentence for
            a duplicate name, an inactive target or a stale id. */}
        {refused !== null && (
          <p
            role="alert"
            className="rounded-lg bg-accent-soft px-2.5 py-2 text-[0.78rem] text-accent"
          >
            {refused}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <DialogClose asChild>
            <button
              type="button"
              className="rounded-full border border-border-strong px-3 py-1 text-[0.75rem] font-semibold text-muted-foreground hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="submit"
            disabled={!ready}
            className="rounded-full bg-primary px-3 py-1 text-[0.75rem] font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('common.save')}
          </button>
        </div>
      </form>
    </DialogContent>
  )
}

export function DesignationDialog({
  designation = null,
  sheet,
  children,
}: DesignationDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {open && (
        <DesignationForm
          designation={designation}
          sheet={sheet}
          onDone={() => setOpen(false)}
        />
      )}
    </DialogRoot>
  )
}
