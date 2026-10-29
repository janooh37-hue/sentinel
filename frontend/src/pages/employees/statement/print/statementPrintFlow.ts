/**
 * Print flow shared by both statements: the server issues the reference
 * (`<G-number>/1/12/<serial>`) when the operator presses Print, the paper
 * takes it before the dialog opens, and only then does `window.print()` run.
 * On failure nothing prints.
 */

import { useMutation } from '@tanstack/react-query'
import { useContext, useState } from 'react'
import { flushSync } from 'react-dom'

import { api } from '@/lib/api'
import { AuthContext } from '@/lib/authContext'

import { formatStatementDate } from '../statementModel'
import type { StatementPrint, StatementPrintCreate } from '../statementTypes'
import type { PaperIssue } from './StatementLetterhead'
import type { PaperLanguage } from './printSettings'

const SITE_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Site-local `YYYY-MM-DD` and `HH:MM` of an instant or a naive site timestamp. */
export function siteStamp(value: Date | string): { date: string; time: string } {
  if (typeof value === 'string' && !/(Z|[+-]\d\d:\d\d)$/.test(value)) {
    // Naive timestamps from this server are already site-local.
    return { date: value.slice(0, 10), time: value.slice(11, 16) }
  }
  const parts = Object.fromEntries(
    SITE_PARTS.formatToParts(typeof value === 'string' ? new Date(value) : value).map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

/**
 * The paper's issue block. In the preview the reference is pending and the
 * stamp is now; once issued, both come from the server's print record.
 */
export function usePaperIssue(issued: StatementPrint | null, lang: PaperLanguage): PaperIssue {
  const user = useContext(AuthContext)?.user ?? null
  const stamp = siteStamp(issued?.printed_at ?? new Date())
  const userName = user ? (lang === 'ar' ? (user.name_ar ?? user.name_en) : (user.name_en ?? user.name_ar)) : null
  return {
    reference: issued?.reference ?? null,
    date: stamp.date,
    printedAt: `${formatStatementDate(stamp.date, lang)}${lang === 'ar' ? '، ' : ', '}${stamp.time}`,
    printedBy: issued?.printed_by_name ?? userName ?? user?.email ?? null,
    printedByRole: user?.position ?? null,
  }
}

/**
 * Issue a reference, then print. The issued print is remembered with the
 * setup it was issued for, so changing any setting returns the paper to
 * "Assigned when printed" instead of reusing a reference for a different copy.
 */
export function useStatementPrint(employeeId: string, setupKey: string) {
  const [issued, setIssued] = useState<{ key: string; print: StatementPrint } | null>(null)
  const mutation = useMutation({
    mutationFn: (body: StatementPrintCreate) => api.createStatementPrint(employeeId, body),
    onSuccess: (print) => {
      // The dialog snapshots the DOM when print() is called: the reference
      // must already be committed, which a plain setState would not be.
      flushSync(() => setIssued({ key: setupKey, print }))
      window.print()
    },
  })
  return {
    issued: issued?.key === setupKey ? issued.print : null,
    print: mutation.mutate,
    pending: mutation.isPending,
    error: mutation.error,
  }
}
