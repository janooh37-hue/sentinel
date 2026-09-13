import { useTranslation } from 'react-i18next'

import type { InmateRegisterMonth } from '@/lib/api'
import {
  documentReference,
  formatRegisterDate,
  formatRegisterDateTime,
  formatRegisterMonth,
} from './registerModel'
import {
  buildRegisterPresentation,
  REPORT_LOCALE,
  REPORT_PAGE_RULE,
  REPORT_STYLES as styles,
  type RegisterExportOptions,
  type ReportTable,
} from './registerPresentation'

interface RegisterDocumentProps {
  month: InmateRegisterMonth
  options: RegisterExportOptions
  draftIssuedAt?: string
  forPrint?: boolean
}

function MetaCell({
  label,
  value,
  direction = 'ltr',
  issuedAt,
  closedAt,
}: {
  label: string
  value: string
  direction?: 'rtl' | 'ltr'
  issuedAt?: string
  closedAt?: string
}): React.JSX.Element {
  return (
    <div
      style={styles.metaCell}
      data-report-issued-at={issuedAt}
      data-report-closed-at={closedAt}
    >
      <dt style={styles.metaLabel}>{label}</dt>
      <dd style={styles.metaValue} dir={direction}>
        {value}
      </dd>
    </div>
  )
}

function RegisterTable({
  table,
  caption,
}: {
  table: ReportTable
  caption: string | null
}): React.JSX.Element {
  return (
    <table dir="rtl" style={styles.table}>
      {caption ? (
        <caption dir="rtl" style={styles.caption}>
          {caption}
        </caption>
      ) : null}
      <colgroup>
        {table.columns.map((column, index) => (
          <col key={index} style={{ width: column.width }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th
            dir="rtl"
            colSpan={table.columns.length}
            scope="colgroup"
            style={styles.band}
          >
            {table.label}
          </th>
        </tr>
        <tr>
          {table.columns.map((column, index) => (
            <th key={index} scope="col" dir="rtl" style={styles.header}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.id}>
            {row.values.map((value, index) => (
              <td
                key={index}
                dir={table.columns[index].direction}
                style={table.columns[index].style}
              >
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Render the selected month and its recorded workflow actors. */
export function RegisterDocument({
  month,
  options,
  draftIssuedAt,
  forPrint = false,
}: RegisterDocumentProps): React.JSX.Element {
  const { t } = useTranslation()
  const ar = (key: string) => t(key, { lng: 'ar' })
  const presentation = buildRegisterPresentation(month, options, t)
  const submitted = month.workflow.state !== 'draft'
  const actors = [month.workflow.prepared, month.workflow.reviewed, month.workflow.approved]
  const issuedAt = month.workflow.prepared?.acted_at ?? (month.closed ? null : draftIssuedAt)
  const closedAt = month.workflow.approved?.acted_at ?? month.closed_at
  const dateTime = (iso: string | null | undefined) =>
    iso ? formatRegisterDateTime(iso, REPORT_LOCALE) : '—'
  const formattedMonth = formatRegisterMonth(month.year, month.month, REPORT_LOCALE)
  const prefix = `${month.year}-${String(month.month).padStart(2, '0')}`
  const lastDay = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate()
  const period =
    `${formatRegisterDate(`${prefix}-01`, REPORT_LOCALE)} – ` +
    formatRegisterDate(`${prefix}-${lastDay}`, REPORT_LOCALE)
  const derivedCount = month.entries.filter((entry) => entry.origin === 'derived').length
  const incompleteCount = month.entries.filter(
    (entry) => entry.missing.length > 0 || entry.incomplete_marks.length > 0,
  ).length
  const roles = ['preparedBy', 'checkedBy', 'approvedBy']

  return (
    <div
      className={
        forPrint ? 'print-inmate-register hidden print:block' : 'register-document-preview'
      }
      style={styles.paper}
      lang="ar"
      dir="rtl"
      data-inmate-register-document
    >
      {forPrint ? <style>{REPORT_PAGE_RULE}</style> : null}
      <div className="inmate-register-content" style={styles.content}>
        <header style={styles.masthead}>
          <img src="/brand/gssg-logo.png" alt="" style={styles.logo} />
          <div>
            <h2 style={styles.heading}>{ar('inmateStats.document.titleAr')}</h2>
            <p style={styles.authority}>{ar('inmateStats.document.authority')}</p>
          </div>
        </header>
        <dl data-report-metadata style={styles.metadata}>
          <MetaCell
            label={ar('inmateStats.document.month')}
            value={formattedMonth}
            direction="rtl"
          />
          <MetaCell label={ar('inmateStats.document.period')} value={period} />
          <MetaCell
            label={ar('inmateStats.document.generated')}
            value={dateTime(issuedAt)}
            issuedAt={issuedAt ?? ''}
          />
          <MetaCell
            label={ar('inmateStats.document.reference')}
            value={documentReference(month.year, month.month)}
          />
          <MetaCell
            label={ar('inmateStats.document.derivedCount')}
            value={String(derivedCount)}
          />
          <MetaCell
            label={ar('inmateStats.document.manualCount')}
            value={String(month.entries.length - derivedCount)}
          />
          <MetaCell
            label={ar('inmateStats.document.incompleteCount')}
            value={String(incompleteCount)}
          />
          <MetaCell
            label={ar('inmateStats.sealed.closedAt')}
            value={dateTime(closedAt)}
            closedAt={closedAt ?? ''}
          />
        </dl>
        {!submitted ? <p style={styles.pending}>{ar('inmateStats.sealed.live')}</p> : null}
        {presentation.tables.map((table, index) => (
          <RegisterTable
            key={table.key}
            table={table}
            caption={index === 0 ? presentation.caption : null}
          />
        ))}
        {presentation.summaryRows.length ? (
          <table
            dir="rtl"
            style={{ ...styles.table, ...styles.summary }}
            data-report-summary
          >
            <colgroup>
              <col style={{ width: '48.5%' }} />
              <col style={{ width: '51.5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th dir="rtl" colSpan={2} style={styles.band}>
                  {presentation.summaryTitle}
                </th>
              </tr>
            </thead>
            <tbody>
              {presentation.summaryRows.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    dir="rtl"
                    style={{ ...styles.summaryCell, fontWeight: 'bold' }}
                  >
                    {row.label}
                  </th>
                  <td dir={row.direction} style={styles.summaryCell}>
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      <dl style={styles.signatures} data-report-signatures>
        {roles.map((role, index) => {
          const actor = actors[index]
          return (
            <div key={role} style={styles.signature} data-report-stage={role}>
              <dt style={styles.role}>{ar(`inmateStats.document.${role}`)}</dt>
              <dd style={styles.identity}>
                {actor ? (
                  <>
                    <span dir="auto">{actor.name_ar}</span>
                    <br />
                    <bdi dir="ltr">{actor.employee_id}</bdi>
                  </>
                ) : submitted ? (
                  '—'
                ) : (
                  ar('inmateStats.document.notPerformed')
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
