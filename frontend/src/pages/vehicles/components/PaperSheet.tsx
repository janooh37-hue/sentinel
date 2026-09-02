/**
 * PaperSheet — the on-screen twin of a generated vehicle letter.
 *
 * The vehicle letters are Arabic letterhead documents (GSSG-VF / GSSG-VA), so
 * the sheet is RTL and bilingually labelled by construction — «الرقم /
 * Reference» — regardless of the UI language: it shows the operator what the
 * DOCX will say, not a translation of it. Both label halves are read out of
 * the locale files with an explicit `lng`, so the paper can never drift from
 * the app's own wording.
 *
 * Ink is hard-coded rather than tokenised for the same reason
 * `AttendancePrintSheet` pins its colours: a dark-theme operator must not
 * print near-white text onto white paper.
 */

import { useContext } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthContext } from '@/lib/authContext'
import { hijriToday } from '@/lib/hijri'
import { cn } from '@/lib/utils'

import { formatLetterDate, todayIso } from '../vehicleUtils'

const NAVY = '#0d2845'

interface PaperSheetProps {
  /** The reference the document will carry, or a placeholder («VF-____»)
   *  before the book is minted. */
  reference: string
  /** Document title — centred and underlined, exactly as the template. */
  title: string
  children: React.ReactNode
  className?: string
}

export function PaperSheet({
  reference,
  title,
  children,
  className,
}: PaperSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  // `useAuth` throws without a provider and the submitter is one courtesy line
  // in the footer; read the context directly and let the line disappear.
  const user = useContext(AuthContext)?.user ?? null
  const hijri = hijriToday()

  // Both halves of every printed label, so the paper reads the same in an
  // Arabic and an English session.
  const companyAr = t('vehicles.company', { lng: 'ar' })
  const companyEn = t('vehicles.company', { lng: 'en' })
  const companySubAr = t('vehicles.companySub', { lng: 'ar' })
  const companySubEn = t('vehicles.companySub', { lng: 'en' })

  return (
    <article
      dir="rtl"
      className={cn(
        'mx-auto w-[min(760px,100%)] border border-[#d8d5cd] bg-[#fffdf8] px-[34px] pb-7 pt-8',
        'text-[#111] shadow-[0_5px_18px_rgba(13,40,69,0.1)]',
        'print:border-0 print:shadow-none',
        className,
      )}
    >
      <header
        className="flex items-center justify-between gap-4 border-b-2 pb-3"
        style={{ borderColor: NAVY }}
      >
        {/* The crest is bilingual by construction (Arabic ring above, English
            below), so one asset serves both directions. Decorative: the
            company name sits beside it. */}
        <img src="/brand/gssg-logo.png" alt="" className="h-[58px] w-[58px] shrink-0 object-contain" />
        <div className="min-w-0 flex-1 text-center">
          <strong className="block text-[0.8rem] font-bold" style={{ color: NAVY }}>
            {companyAr}
          </strong>
          <span dir="ltr" className="isolate-bidi mt-0.5 block text-[0.68rem] font-semibold" style={{ color: NAVY }}>
            {companyEn}
          </span>
          <small className="mt-1 block text-[0.62rem] text-[#4a4a4a]">
            {companySubAr}
            <span dir="ltr" className="isolate-bidi"> · {companySubEn}</span>
          </small>
        </div>
        <span className="shrink-0 font-mono text-[0.7rem] font-semibold" style={{ color: NAVY }}>
          GSSG
        </span>
      </header>

      <div className="my-4 grid grid-cols-2 gap-3 text-[0.66rem]">
        <p className="m-0">
          <PaperLabel labelKey="vehicles.reference" />
          {': '}
          <strong className="font-mono font-bold">
            <bdi dir="ltr">{reference}</bdi>
          </strong>
        </p>
        <div className="text-end">
          <p className="m-0 mb-1">
            <PaperLabel labelKey="vehicles.gregorian" />
            {': '}
            <strong className="font-mono font-bold">
              <bdi dir="ltr">{formatLetterDate(todayIso())}</bdi>
            </strong>
          </p>
          {hijri && (
            <p className="m-0">
              <PaperLabel labelKey="vehicles.hijri" />
              {': '}
              <strong className="font-bold">{hijri}</strong>
            </p>
          )}
        </div>
      </div>

      <h2
        className="my-[18px] text-center text-[1.05rem] font-bold underline decoration-1 underline-offset-[5px]"
        style={{ color: NAVY }}
      >
        {title}
      </h2>

      {children}

      <footer className="mt-8 flex items-end justify-between gap-3.5 border-t border-[#777] pt-2.5 text-[0.6rem]">
        <span className="font-mono">www.gssg.app</span>
        {user?.employee_id && (
          <span className="text-end">
            <PaperLabel labelKey="vehicles.loggedSubmitter" />
            <strong className="mt-0.5 block font-mono font-bold">
              <bdi dir="ltr">{user.employee_id}</bdi>
            </strong>
          </span>
        )}
      </footer>
    </article>
  )
}

/** «الرقم / Reference» — the Arabic word the document prints, with the English
 *  peer isolated so the bidi algorithm cannot reorder the pair. */
function PaperLabel({ labelKey }: { labelKey: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="text-[#3c3c3c]">
      {t(labelKey, { lng: 'ar' })}
      <span dir="ltr" className="isolate-bidi"> / {t(labelKey, { lng: 'en' })}</span>
    </span>
  )
}

/**
 * The letter's highlighted note line — the withheld-names notice on an
 * investigation copy. Bordered and tinted, never colour-only: it carries the
 * sentence itself.
 */
export function PaperNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="my-2.5 border-s-[3px] border-[#ffc928] bg-[#fff7d8] px-2.5 py-2 text-[0.62rem] text-[#694c00]">
      {children}
    </p>
  )
}

/**
 * The boxed plate line the fines letter prints above its table
 * («رقم اللوحة | 14 \ 58216»).
 */
export function PaperPlateBox({
  label,
  plate,
}: {
  label: string
  plate: string
}): React.JSX.Element {
  return (
    <div className="mb-4 flex items-center justify-center gap-2.5 border border-[#333] bg-[#fafafa] p-2.5 text-[0.7rem]">
      <span>{label}</span>
      <strong className="font-mono text-[0.82rem] font-bold">
        <bdi dir="ltr">{plate}</bdi>
      </strong>
    </div>
  )
}

/**
 * The facts block of the accident report: one bordered box, one label/value
 * pair per line, in the template's own row order.
 *
 * Deliberately single-column at every width. The GSSG-VA template's facts
 * table is a 2-column (label | value) table of N rows, so pairing two facts
 * side by side would preview a document shape the DOCX never prints — and on
 * a wide sheet it also breaks the reading order the letter is checked in.
 */
export function PaperFacts({
  rows,
}: {
  rows: ReadonlyArray<{ label: string; value: React.ReactNode; mono?: boolean }>
}): React.JSX.Element {
  return (
    <dl className="my-4 grid grid-cols-1 gap-2 border border-[#555] bg-white p-3 text-[0.64rem]">
      {rows.map((row) => (
        <div key={row.label} className="border-b border-[#ddd] py-1">
          <dt className="inline text-[#3c3c3c]">{row.label}: </dt>
          <dd className={cn('inline font-bold', row.mono && 'font-mono')}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * A table on the paper: hairline rules, centred cells, white ground — the
 * shared treatment for the fines letter, the fleet report and any future
 * letterhead list, so they cannot drift apart.
 */
export function PaperTable({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <table
      className={cn(
        'w-full border-collapse border border-[#333] text-[0.57rem]',
        '[&_td]:border [&_td]:border-[#444] [&_td]:bg-white [&_td]:p-1.5 [&_td]:text-center',
        '[&_th]:border [&_th]:border-[#444] [&_th]:bg-white [&_th]:p-1.5 [&_th]:text-center [&_th]:font-bold',
        className,
      )}
    >
      {children}
    </table>
  )
}
