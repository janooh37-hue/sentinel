import { useEffect, useMemo, useRef, useState } from 'react'
import { Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import type { AbsenceRegisterRowRead } from '@/lib/api'
import { dmyPad } from '@/lib/basketEmail'
import { todayIso } from '@/lib/leaveDateMath'
import { getRecentRecipientsForForm } from '@/lib/recentRecipients'
import {
  ABSENCE_BASKET_KEY,
  buildAbsenceEmail,
  defaultCase,
  letterName,
} from '@/pages/absences/absenceEmail'
import type { AbsenceCase } from '@/pages/absences/absenceEmail'

interface Props {
  open: boolean
  rows: AbsenceRegisterRowRead[]
  onOpenChange: (open: boolean) => void
}

function rowKey(row: AbsenceRegisterRowRead): string {
  return `${row.employee_id}|${row.start_date}|${row.end_date}`
}

function caseSelectId(row: AbsenceRegisterRowRead): string {
  return `absence-email-case-${encodeURIComponent(rowKey(row))}`
}

export function AbsenceEmailDialog({ open, rows, onOpenChange }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [cases, setCases] = useState<Record<string, AbsenceCase>>({})
  const [violationAttached, setViolationAttached] = useState(false)
  const wasOpen = useRef(false)

  useEffect(() => {
    const isOpening = open && !wasOpen.current
    wasOpen.current = open
    if (!isOpening) return

    const today = todayIso()
    // Opening is the intentional synchronization point for dialog-local draft state.
    setCases(
      Object.fromEntries(rows.map((row) => [rowKey(row), defaultCase(row, today)])),
    )
    setViolationAttached(false)
  }, [open, rows])

  const today = todayIso()
  const emailRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        case: cases[rowKey(row)] ?? defaultCase(row, today),
      })),
    [cases, rows, today],
  )
  const { subject, bodyHtml } = useMemo(
    () => buildAbsenceEmail(emailRows, { violationAttached }),
    [emailRows, violationAttached],
  )

  const openInEmail = (): void => {
    navigate('/ledger', {
      state: {
        composePrefill: {
          subject,
          bodyHtml,
          to: getRecentRecipientsForForm(ABSENCE_BASKET_KEY),
          basketKey: ABSENCE_BASKET_KEY,
        },
      },
    })
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('absences.email.title')}</DialogTitle>
          <DialogDescription>{t('absences.email.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4 text-sm">
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const key = rowKey(row)
              const name = letterName(row)
              const startDate = dmyPad(row.start_date)
              const endDate = dmyPad(row.end_date)
              const selectId = caseSelectId(row)
              return (
                <li
                  key={key}
                  className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-tinted/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground" dir="auto">
                      {name}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="font-mono">{row.employee_id}</span>
                      <span aria-hidden>·</span>
                      <span className="font-mono" dir="ltr">
                        {startDate} – {endDate}
                      </span>
                    </p>
                  </div>
                  <label htmlFor={selectId} className="sr-only">
                    {t('absences.email.caseRow', {
                      name,
                      id: row.employee_id,
                      start: startDate,
                      end: endDate,
                    })}
                  </label>
                  <select
                    id={selectId}
                    value={cases[key] ?? defaultCase(row, today)}
                    onChange={(event) => {
                      const nextCase = event.target.value as AbsenceCase
                      setCases((current) => ({ ...current, [key]: nextCase }))
                    }}
                    className="h-9 shrink-0 rounded-md border border-input bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="absent">{t('absences.email.caseAbsent')}</option>
                    <option value="returned">{t('absences.email.caseReturned')}</option>
                  </select>
                </li>
              )
            })}
          </ul>

          <label
            htmlFor="absence-email-violation-attached"
            className="flex items-center gap-2 text-sm text-foreground"
          >
            <input
              id="absence-email-violation-attached"
              type="checkbox"
              checked={violationAttached}
              onChange={(event) => setViolationAttached(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            {t('absences.email.violationAttached', { count: rows.length })}
          </label>

          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-surface-tinted px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {t('absences.email.subjectLabel')}:
            </span>
            <span dir="rtl" lang="ar" className="font-medium text-foreground">
              {subject}
            </span>
          </div>

          <div
            dir="rtl"
            lang="ar"
            className="max-h-[50vh] overflow-auto rounded-xl border border-hairline bg-white p-4 text-black"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="default" className="gap-2" onClick={openInEmail}>
            <Mail className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            {t('absences.email.open')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
