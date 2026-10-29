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
 * Chrome drops a repeating head once head + foot pass about a third of the
 * page. A4 portrait stays under it with the full masthead; A4 landscape does
 * not, so landscape prints the full masthead once as the first body row and
 * repeats a compact one-line head instead.
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
  printedBy: string | null
  printedByRole: string | null
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

function Letterhead({ frame, t }: { frame: PaperFrame; t: TFunction }): React.JSX.Element {
  return (
    <>
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
    </>
  )
}

function Identity({ frame, t }: { frame: PaperFrame; t: TFunction }): React.JSX.Element {
  const e = frame.employee
  const job = frame.lang === 'ar' ? (e.position_ar ?? e.position) : (e.position ?? e.position_ar)
  const placement = [e.duty_unit, e.duty_post].filter(Boolean).join(' / ')
  return (
    <>
      <div className="st-title">
        <h1>{frame.title}</h1>
        <p>{frame.period}</p>
      </div>
      <table className="st-meta">
        <tbody>
          <tr>
            <td className="k">{t('statementPrint.paper.name')}</td>
            <td className="v">
              <bdi lang="en" dir="ltr">
                {e.name_en}
              </bdi>
              {e.name_ar && (
                <>
                  {' | '}
                  <bdi lang="ar" dir="rtl">
                    {e.name_ar}
                  </bdi>
                </>
              )}
            </td>
            <td className="k">{t('statementPrint.paper.employeeNo')}</td>
            <td className="v">
              <Mono>{e.id}</Mono>
            </td>
          </tr>
          <tr>
            <td className="k">{t('statementPrint.paper.jobTitle')}</td>
            <td className="v">
              <bdi>{job ?? '-'}</bdi>
            </td>
            <td className="k">{t('statementPrint.paper.departmentField')}</td>
            <td className="v">
              <bdi>{e.department ?? '-'}</bdi>
            </td>
          </tr>
          <tr>
            <td className="k">{t('statementPrint.paper.unitPost')}</td>
            <td className="v">
              <bdi>{placement || '-'}</bdi>
            </td>
            <td className="k">{t('statementPrint.paper.joined')}</td>
            <td className="v">{e.doj ? formatStatementDate(e.doj, frame.lang) : '-'}</td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

function Masthead({ frame, t }: { frame: PaperFrame; t: TFunction }): React.JSX.Element {
  return (
    <>
      <Letterhead frame={frame} t={t} />
      <Identity frame={frame} t={t} />
    </>
  )
}

function CompactHead({ frame }: { frame: PaperFrame }): React.JSX.Element {
  const e = frame.employee
  return (
    <div className="st-compact">
      <img src="/brand/gssg-wordmark.png" alt="GSSG" />
      <b>{frame.title}</b>
      <span className="g">
        <bdi>{frame.lang === 'ar' ? (e.name_ar ?? e.name_en) : e.name_en}</bdi> · <Mono>{e.id}</Mono>
      </span>
      <span>{frame.period}</span>
    </div>
  )
}

function Foot({ frame, t }: { frame: PaperFrame; t: TFunction }): React.JSX.Element {
  const by = [frame.issue.printedBy, frame.issue.printedByRole].filter(Boolean).join(frame.lang === 'ar' ? '، ' : ', ')
  return (
    <>
      <div className="st-prov">
        <div>
          {t('statementPrint.paper.printed', { at: frame.issue.printedAt })}
          {by && ` · ${t('statementPrint.paper.printedBy', { name: by })}`}
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
  const landscape = frame.orient === 'landscape'
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
            <td>{landscape ? <CompactHead frame={frame} /> : <Masthead frame={frame} t={t} />}</td>
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
          {landscape && (
            <tr className="st-row">
              <td>
                <div className="st-first">
                  <Masthead frame={frame} t={t} />
                </div>
              </td>
            </tr>
          )}
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

/** "Not included: ..." Printed only when something is left out. */
export function ScopeLine({ t, items }: { t: TFunction; items: string[] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <p className="st-scope" data-testid="statement-scope">
      <b>{t('statementPrint.paper.notIncluded')}:</b> {items.join(t('statementPrint.paper.listJoin'))}.
    </p>
  )
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
