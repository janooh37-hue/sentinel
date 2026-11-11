/**
 * Print flow shared by both statements: the server issues the reference
 * (`<G-number>/1/12/<serial>`) when the operator presses Print, the paper
 * takes it before the dialog opens, and only then does `window.print()` run.
 * On failure nothing prints.
 */

import { useMutation } from '@tanstack/react-query'
import { useContext, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'

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
  const { i18n } = useTranslation()
  const t = i18n.getFixedT(lang)
  const stamp = siteStamp(issued?.printed_at ?? new Date())
  // The printer is the signed-in user, so their name is picked in the paper's
  // language; the server's name is the fallback.
  const name =
    (user ? (lang === 'ar' ? (user.name_ar ?? user.name_en) : (user.name_en ?? user.name_ar)) : null) ??
    issued?.printed_by_name ??
    user?.email ??
    null
  // The session carries the job title in English only; an Arabic paper leaves
  // it off rather than print English beside an Arabic name.
  const role = lang === 'en' ? (user?.position ?? null) : null
  return {
    reference: issued?.reference ?? null,
    date: stamp.date,
    printedAt: `${formatStatementDate(stamp.date, lang)}${t('statementPrint.paper.listJoin')}${stamp.time}`,
    byline: [name, role].filter(Boolean).join(t('statementPrint.paper.listJoin')) || null,
  }
}

/**
 * Issue a reference, then print. The issued print is remembered with the
 * setup it was issued for, so changing any setting returns the paper to
 * "Assigned when printed" instead of reusing a reference for a different copy.
 */
export function useStatementPrint(employeeId: string, setupKey: string) {
  const [issued, setIssued] = useState<{ key: string; print: StatementPrint } | null>(null)
  const [stale, setStale] = useState(false)
  // The setup on screen right now; read when the serial comes back.
  const mounted = useRef(setupKey)
  useEffect(() => {
    mounted.current = setupKey
  }, [setupKey])
  const mutation = useMutation({
    mutationFn: ({ body }: { body: StatementPrintCreate; key: string }) =>
      api.createStatementPrint(employeeId, body),
    onSuccess: (print, { key }) => {
      // The serial was issued for the setup captured with the request. If the
      // paper changed meanwhile, that serial must not go on a different copy.
      if (key !== mounted.current) {
        setIssued(null)
        setStale(true)
        return
      }
      // The dialog snapshots the DOM when print() is called: the reference
      // must already be committed, which a plain setState would not be.
      flushSync(() => {
        setStale(false)
        setIssued({ key, print })
      })
      window.print()
    },
  })
  return {
    issued: issued?.key === setupKey ? issued.print : null,
    print: (body: StatementPrintCreate) => {
      setStale(false)
      mutation.mutate({ body, key: setupKey })
    },
    pending: mutation.isPending,
    error: mutation.error,
    /** The setup changed while the reference was being issued: print again. */
    stale,
  }
}
