import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InmatePopulation, InmateRegisterMonth } from '@/lib/api'

import {
  documentReference,
  formatRegisterDate,
  formatRegisterDateTime,
  formatRegisterMonth,
  type RegisterGroup,
} from './registerModel'
import {
  registerColumnKeys,
  registerEntryValues,
  registerGroupsForScope,
  type RegisterExportOptions,
} from './registerClipboard'

interface RegisterDocumentProps {
  month: InmateRegisterMonth
  options: RegisterExportOptions
  forPrint?: boolean
}

const WIDTHS_BY_GROUP: Record<InmatePopulation, readonly string[]> = {
  citizens: ['6%', '18%', '18%', '14%', '15%', '29%'],
  expats: ['5%', '16%', '16%', '13%', '13%', '14%', '23%'],
  pending: ['6%', '18%', '18%', '14%', '15%', '29%'],
}

function periodBounds(year: number, month: number): readonly [string, string] {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  return [`${prefix}-01`, `${prefix}-${String(lastDay).padStart(2, '0')}`]
}

function MetaCell({
  label,
  value,
  direction = 'auto',
}: {
  label: string
  value: string
  direction?: 'auto' | 'ltr'
}): React.JSX.Element {
  return (
    <div className="min-w-0 border-e border-b border-black px-1.5 py-1">
      <dt className="text-[6.2pt] font-bold uppercase tracking-[0.08em] text-[#555]">
        {label}
      </dt>
      <dd
        className="mt-px break-words text-[7.8pt] font-semibold tabular-nums [unicode-bidi:isolate]"
        dir={direction}
      >
        {value}
      </dd>
    </div>
  )
}

function RegisterTable({
  group,
  options,
}: {
  group: RegisterGroup
  options: RegisterExportOptions
}): React.JSX.Element {
  const { t } = useTranslation()
  const headers = registerColumnKeys(group.key).map((key) =>
    t(key, { lng: options.language }),
  )
  const widths = WIDTHS_BY_GROUP[group.key]
  const dateIndex = group.key === 'expats' ? 4 : 3
  const detailsIndex = headers.length - 1
  const cellClass = 'border border-black px-1 py-0.5 align-top text-[7.1pt] leading-[1.38]'

  return (
    <section className="mt-2.5">
      {/* This is a fixed Arabic government form, not reader-direction layout:
          `ت` starts on the right in both document languages. */}
      <table dir="rtl" className="w-full table-fixed border-collapse text-black">
        <colgroup>
          {widths.map((width, index) => <col key={index} style={{ width }} />)}
        </colgroup>
        <thead>
          <tr>
            <th
              dir="rtl"
              colSpan={headers.length}
              scope="colgroup"
              className="print-inmate-register-band border border-black bg-[#C00000] px-1 py-1 text-center text-[8.4pt] font-extrabold leading-tight text-white [print-color-adjust:exact]"
            >
              {t(`inmateStats.populations.${group.key}`, { lng: options.language })}
            </th>
          </tr>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="print-inmate-register-band border border-black bg-[#C00000] px-1 py-1 text-center text-[6.7pt] font-extrabold leading-tight text-white [print-color-adjust:exact]"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.entries.map((entry) => {
            const values = registerEntryValues(entry, group.key, options, t)
            return (
              // Manual entries deliberately use the ordinary row shape: no
              // provenance badge, reason, or extra document column.
              <tr key={entry.id} className="break-inside-avoid">
                {values.map((value, index) => {
                  const numericOrDate = index === 0 || index === 2 || index === dateIndex
                  return (
                    <td
                      key={index}
                      className={`${cellClass} ${numericOrDate ? 'text-center font-mono tabular-nums [unicode-bidi:isolate]' : 'text-start'} ${index === detailsIndex ? 'whitespace-pre-line break-words' : 'break-words'}`}
                      dir={numericOrDate ? 'ltr' : 'auto'}
                    >
                      {value}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        {options.includeCounts ? (
          <tfoot>
            <tr className="break-inside-avoid font-extrabold">
              <td
                colSpan={headers.length - 1}
                className="border border-black px-1.5 py-1 text-end text-[7.3pt]"
              >
                {t('inmateStats.counts.perTable', { lng: options.language })}
              </td>
              <td
                dir="ltr"
                className="border border-black px-1.5 py-1 text-center font-mono text-[8pt] tabular-nums [unicode-bidi:isolate]"
              >
                {group.count}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </section>
  )
}

function SignatureBlock({ language }: { language: 'ar' | 'en' }): React.JSX.Element {
  const { t } = useTranslation()
  const roles = [
    t('inmateStats.document.preparedBy', { lng: language }),
    t('inmateStats.document.checkedBy', { lng: language }),
    t('inmateStats.document.approvedBy', { lng: language }),
  ]
  return (
    <dl className="mt-3 grid grid-cols-3 gap-2 break-inside-avoid">
      {roles.map((role) => (
        <div key={role} className="min-h-[22mm] border-[1.5px] border-black px-2 py-1.5">
          <dt className="text-[7.2pt] font-extrabold uppercase tracking-[0.08em]">{role}</dt>
          <dd className="mt-[12mm] border-b border-dotted border-black" aria-hidden="true" />
        </div>
      ))}
    </dl>
  )
}

/** The formal A4 artifact. Screen provenance and manual-entry controls never enter this tree. */
export function RegisterDocument({
  month,
  options,
  forPrint = false,
}: RegisterDocumentProps): React.JSX.Element {
  const { t } = useTranslation()
  const [generatedIso] = useState(() => new Date().toISOString())
  const groups = registerGroupsForScope(month, options.scope)
  const entries = groups.flatMap((group) => group.entries)
  const derivedCount = entries.filter((entry) => entry.origin === 'derived').length
  const manualCount = entries.length - derivedCount
  const incompleteCount = entries.filter(
    (entry) => entry.missing.length > 0 || entry.incomplete_marks.length > 0,
  ).length
  const [periodStart, periodEnd] = periodBounds(month.year, month.month)
  const reference = documentReference(month.year, month.month)
  // The total is always re-derived from the three scoped table groups; it is
  // never trusted as stored month state.
  const documentTotal = groups.reduce((total, group) => total + group.count, 0)
  const pageClass =
    options.orientation === 'portrait'
      ? 'print-inmate-register-portrait'
      : 'print-inmate-register-landscape'
  const rootClass = forPrint
    ? `print-inmate-register ${pageClass} hidden w-full bg-white text-black print:block`
    : 'register-document-preview w-full bg-white text-black shadow-[0_18px_55px_rgb(0_0_0_/_0.24)]'
  const formattedMonth = formatRegisterMonth(month.year, month.month, options.language)
  const formattedPeriod = `${formatRegisterDate(periodStart, options.language)} – ${formatRegisterDate(periodEnd, options.language)}`
  const generatedAt = formatRegisterDateTime(generatedIso, options.language)

  return (
    <div
      className={`${rootClass} p-[10mm] text-[9.6pt] leading-[1.35]`}
      lang={options.language}
      dir={options.language === 'ar' ? 'rtl' : 'ltr'}
      data-inmate-register-document
    >
      <div className="flex items-center gap-2.5 border-b-[1.5px] border-black pb-1.5">
        <img
          src="/brand/gssg-logo.png"
          alt=""
          className="h-[15mm] w-[15mm] shrink-0 object-contain"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13pt] font-extrabold tracking-[-0.01em]">
            <span lang="ar" dir="rtl">{t('inmateStats.document.titleAr', { lng: 'ar' })}</span>
            <span aria-hidden="true"> · </span>
            <span lang="en" dir="ltr" className="[unicode-bidi:isolate]">
              {t('inmateStats.document.titleEn', { lng: 'en' })}
            </span>
          </h2>
          <p className="mt-px text-[7.2pt] text-[#555]">
            {t('inmateStats.document.authority', { lng: options.language })}
          </p>
        </div>
        <dl className="shrink-0 text-end">
          <dt className="text-[6.2pt] font-bold uppercase tracking-[0.08em] text-[#555]">
            {t('inmateStats.document.month', { lng: options.language })}
          </dt>
          <dd
            dir="ltr"
            className="text-[9pt] font-extrabold tabular-nums [unicode-bidi:isolate]"
          >
            {formattedMonth}
          </dd>
        </dl>
      </div>

      <dl className="mt-1.5 grid grid-cols-4 border-s border-t border-black">
        <MetaCell
          label={t('inmateStats.document.month', { lng: options.language })}
          value={formattedMonth}
          direction="ltr"
        />
        <MetaCell
          label={t('inmateStats.document.period', { lng: options.language })}
          value={formattedPeriod}
          direction="ltr"
        />
        <MetaCell
          label={t('inmateStats.document.generated', { lng: options.language })}
          value={generatedAt}
          direction="ltr"
        />
        <MetaCell
          label={t('inmateStats.document.reference', { lng: options.language })}
          value={reference}
          direction="ltr"
        />
        <MetaCell
          label={t('inmateStats.document.derivedCount', { lng: options.language })}
          value={String(derivedCount)}
          direction="ltr"
        />
        <MetaCell
          label={t('inmateStats.document.manualCount', { lng: options.language })}
          value={String(manualCount)}
          direction="ltr"
        />
        <MetaCell
          label={t('inmateStats.document.incompleteCount', { lng: options.language })}
          value={String(incompleteCount)}
          direction="ltr"
        />
        {month.closed ? (
          <>
            <MetaCell
              label={t('inmateStats.sealed.closedAt', { lng: options.language })}
              value={
                month.closed_at
                  ? formatRegisterDateTime(month.closed_at, options.language)
                  : ''
              }
              direction="ltr"
            />
            <MetaCell
              label={t('inmateStats.sealed.closedBy', { lng: options.language })}
              value={month.closed_by_name ?? ''}
            />
            {month.force_closed ? (
              <MetaCell
                label={t('inmateStats.sealed.strip', { lng: options.language })}
                value={t('inmateStats.sealed.forced', { lng: options.language })}
              />
            ) : null}
          </>
        ) : null}
      </dl>

      {!month.closed ? (
        <p className="mt-1.5 border-[1.5px] border-[#C00000] px-2 py-1 text-center text-[7.5pt] font-extrabold text-[#C00000]">
          {t('inmateStats.sealed.live', { lng: options.language })}
        </p>
      ) : null}

      {groups.map((group) => (
        <RegisterTable key={group.key} group={group} options={options} />
      ))}

      {options.includeCounts ? (
        <div className="mt-2 flex items-baseline justify-end gap-3 border-y-[1.5px] border-black px-2 py-1.5 break-inside-avoid">
          <span className="text-[8pt] font-extrabold">
            {t('inmateStats.counts.documentTotal', { lng: options.language })}
          </span>
          <strong
            dir="ltr"
            className="font-mono text-[11pt] tabular-nums [unicode-bidi:isolate]"
          >
            {documentTotal}
          </strong>
        </div>
      ) : null}

      <SignatureBlock language={options.language} />
    </div>
  )
}
