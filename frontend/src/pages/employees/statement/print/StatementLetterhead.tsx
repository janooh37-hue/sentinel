/**
 * Shared pieces of the printed statements (activity and attendance): the
 * letterhead, the identity table, the provenance and contact footer, the
 * signature boxes, and the sheet that repeats head and foot on every page.
 *
 * The sheet is one table: letterhead + identity in `thead`, provenance +
 * contact in `tfoot`, and the body as one table row per block. Chrome repeats
 * a table's header and footer groups on every printed page, but only when the
 * page breaks BETWEEN rows; one tall cell would print the head once. Long
 * tables are therefore cut into chunks of rows (`tableBlocks`), each chunk
 * repeating its column header.
 *
 * Chrome drops a repeating head once head + foot pass roughly a third of the
 * page, and the full masthead crosses that as soon as a long name or
 * placement wraps (seen on real Arabic records: pages 2+ printed with no
 * head at all). So every orientation repeats a compact one-line head (logo,
 * title, employee, G-number, reference, period) and prints the full
 * letterhead + identity once, as the first body row.
 *
 * The paper pins its own ink (index.css `.statement-sheet`): a dark-theme
 * operator still previews and prints dark text on white paper.
 */

import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'

import type { EmployeeRead } from '@/lib/api'

import { formatStatementDate } from '../statementModel'
import { usePaperT } from './paperBlocks'
import type { Orientation, PaperLanguage } from './printSettings'

export interface PaperIssue {
  /** `G3190/1/12/7` once the server issued it; null in the preview. */
  reference: string | null
  /** ISO date of the paper (site date). */
  date: string
  /** "27 Oct 2026, 11:20", site time, Western digits. */
  printedAt: string
  /** "Mariam Al Kaabi, HR Officer": who printed it, in the paper's language. */
  byline: string | null
}

export interface PaperFrame {
  lang: PaperLanguage
  orient: Orientation
  employee: EmployeeRead
  issue: PaperIssue
  title: string
  period: string
  /** Link back to the screen this paper came from. */
  sourceUrl: string
  lineTotal: string
}

export function Mono({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <bdi dir="ltr" className="st-mono">
      {children}
    </bdi>
  )
}

/**
 * The one masthead, repeated on every page: letterhead (wordmark, office
 * block, red rule) and one line under the rule naming the document. Sized to
 * stay well under Chrome's repeat threshold (head <= 40 mm) whatever the
 * name length: the name line never wraps, it ellipsizes.
 */
function Masthead({ frame, t }: { frame: PaperFrame; t: TFunction }): React.JSX.Element {
  const e = frame.employee
  return (
    <div className="st-head" data-testid="statement-head">
      <div className="st-lh">
        <img src="/brand/gssg-wordmark.png" alt="GSSG" />
        <dl className="st-office">
          <div>
            <dt>{t('statementPrint.paper.department')}</dt>
            <dd>{t('statementPrint.paper.hrDepartment')}</dd>
          </div>
          <div>
            <dt>{t('statementPrint.paper.date')}</dt>
            <dd>{formatStatementDate(frame.issue.date, frame.lang)}</dd>
          </div>
          <div>
            <dt>{t('statementPrint.paper.ref')}</dt>
            <dd data-testid="statement-reference">
              {frame.issue.reference ? (
                <Mono>{frame.issue.reference}</Mono>
              ) : (
                <span className="st-pending">{t('statementPrint.paper.refPending')}</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
      <div className="st-rule" aria-hidden="true">
        <i />
        <i />
      </div>
      <div className="st-docline">
        <h1>{frame.title}</h1>
        <bdi className="st-who">{frame.lang === 'ar' ? (e.name_ar ?? e.name_en) : e.name_en}</bdi>
        <Mono>{e.id}</Mono>
        <span className="st-period">{frame.period}</span>
      </div>
    </div>
  )
}

/** Page 1 only: who the statement is about, beyond what the head already says. */
function Identity({ frame, t }: { frame: PaperFrame; t: TFunction }): React.JSX.Element {
  const e = frame.employee
  const job = frame.lang === 'ar' ? (e.position_ar ?? e.position) : (e.position ?? e.position_ar)
  const placement = [e.duty_unit, e.duty_post].filter(Boolean).join(' / ')
  // The paper's own language first, the other script beside it.
  const names = [
    <bdi key="en" lang="en" dir="ltr">
      {e.name_en}
    </bdi>,
    ...(e.name_ar
      ? [
          <bdi key="ar" lang="ar" dir="rtl">
            {e.name_ar}
          </bdi>,
        ]
      : []),
  ]
  if (frame.lang === 'ar') names.reverse()
  const rows: [string, ReactNode][] = [
    [
      t('statementPrint.paper.name'),
      names.map((name, i) => (
        <span key={i}>
          {i > 0 && ' | '}
          {name}
        </span>
      )),
    ],
    [t('statementPrint.paper.jobTitle'), <bdi key="j">{job ?? '-'}</bdi>],
    [t('statementPrint.paper.departmentField'), <bdi key="d">{e.department ?? '-'}</bdi>],
    [t('statementPrint.paper.unitPost'), <bdi key="u">{placement || '-'}</bdi>],
    [t('statementPrint.paper.joined'), e.doj ? formatStatementDate(e.doj, frame.lang) : '-'],
  ]
  return (
    <dl className="st-identity" data-testid="statement-identity">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Foot({ frame, t }: { frame: PaperFrame; t: TFunction }): React.JSX.Element {
  return (
    <>
      <div className="st-prov">
        <div>
          {t('statementPrint.paper.printed', { at: frame.issue.printedAt })}
          {frame.issue.byline && ` · ${t('statementPrint.paper.printedBy', { name: frame.issue.byline })}`}
          <br />
          {t('statementPrint.paper.source', { id: frame.employee.id })} · <Mono>{frame.sourceUrl}</Mono>
        </div>
        <b data-testid="statement-line-total">{frame.lineTotal}</b>
      </div>
      <div className="st-contact">
        <span>
          <img src="/brand/icon-location.png" alt="" />
          {t('statementPrint.paper.location')}
        </span>
        <span>
          <img src="/brand/icon-email.png" alt="" />
          <Mono>info@gss-group.net</Mono> · <Mono>www.gss-group.net</Mono>
        </span>
        <span>
          <img src="/brand/icon-phone.png" alt="" />
          {t('statementPrint.paper.phone')} <Mono>+9712 6666898</Mono> · {t('statementPrint.paper.fax')}{' '}
          <Mono>+971 2 666 8980</Mono>
        </span>
      </div>
    </>
  )
}

export function StatementSheet({
  frame,
  blocks,
}: {
  frame: PaperFrame
  /** Body blocks; each becomes one unbreakable table row. */
  blocks: ReactNode[]
}): React.JSX.Element {
  const t = usePaperT(frame.lang)
  return (
    <div className="print-statement" data-orient={frame.orient}>
      <table
        className="statement-sheet"
        data-orient={frame.orient}
        lang={frame.lang}
        dir={frame.lang === 'ar' ? 'rtl' : 'ltr'}
      >
        <thead>
          <tr>
            <td>
              <Masthead frame={frame} t={t} />
            </td>
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td>
              <Foot frame={frame} t={t} />
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr className="st-row">
            <td>
              <Identity frame={frame} t={t} />
            </td>
          </tr>
          {blocks.map((block, index) => (
            <tr className="st-row" key={index}>
              <td>{block}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A single quiet line ("Not included: ...", "No records in this period: ..."). Nothing when empty. */
export function NoteLine({
  label,
  items,
  testId,
  t,
}: {
  label: string
  items: string[]
  testId: string
  t: TFunction
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <p className="st-note" data-testid={testId}>
      <b>{label}:</b> {items.join(t('statementPrint.paper.listJoin'))}.
    </p>
  )
}

/** "Not included: ..." Printed only when something is left out. */
export function ScopeLine({ t, items }: { t: TFunction; items: string[] }): React.JSX.Element | null {
  return <NoteLine label={t('statementPrint.paper.notIncluded')} items={items} testId="statement-scope" t={t} />
}

export function SignatureBlocks({
  t,
  boxes,
}: {
  t: TFunction
  boxes: { role: string; name: string | null }[]
}): React.JSX.Element {
  return (
    <div className="st-sign" data-testid="statement-signatures" data-count={boxes.length}>
      {boxes.map((box) => (
        <div className="b" key={box.role} data-testid="statement-signature">
          {box.role}
          {box.name && <small>{box.name}</small>}
          <small>{t('statementPrint.paper.signatureDate')}</small>
        </div>
      ))}
    </div>
  )
}
