/**
 * AccidentPaper — the GSSG-VA accident letter, row for row, beside the request
 * that produces it.
 *
 * Built from the same rules as `backend/app/core/vehicle_letters.
 * accident_letter_fields`, in the template's own row order, so what the
 * operator reads is what the DOCX prints: the plate written with a slash, the
 * Arabic vehicle type, the site's Arabic name, «—» for a missing VIN, police
 * reference or driver, the date and time as `dd/mm/yyyy HH:MM`, the status as
 * «مفتوح»/«مغلق», and the Arabic description as the body. There is no cost
 * figure: the damage row carries the insurance sentence.
 *
 * The letter is Arabic in both UI languages. A location or description that
 * has no Arabic wording yet prints the «added when the letter is issued» note
 * instead of an empty line, so an English report shows honestly what is still
 * missing.
 */

import { useTranslation } from 'react-i18next'

import { EMPTY_VALUE, formatLetterDate } from '../vehicleUtils'
import { PaperFacts, PaperSheet } from './PaperSheet'

export interface AccidentPaperFacts {
  plateLabel: string
  vehicleTypeAr: string
  vin: string | null | undefined
  siteAr: string
  date: string
  time: string | null | undefined
  /** The driver's name only; the template has no G-number column. */
  driver: string | null
  locationAr: string | null | undefined
  policeRef: string | null | undefined
  status: 'open' | 'closed'
  descriptionAr: string | null | undefined
}

export function AccidentPaper({
  facts,
  reference,
}: {
  facts: AccidentPaperFacts
  /** The book's reference, or a placeholder before it is minted. */
  reference: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const ar = (key: string): string => t(key, { lng: 'ar' })
  const pending = (
    <span className="font-normal italic text-[#6b6b6b]">{ar('vehicles.paperPending')}</span>
  )

  const plate = facts.plateLabel.replace('\\', '/')
  const clock = facts.time?.slice(0, 5)
  const dateTime = clock ? `${formatLetterDate(facts.date)} ${clock}` : formatLetterDate(facts.date)
  const location = facts.locationAr?.trim()
  const description = facts.descriptionAr?.trim()

  return (
    <PaperSheet reference={reference} title={ar('vehicles.accidentTitle')}>
      <PaperFacts
        rows={[
          { label: ar('vehicles.plate'), value: <bdi dir="ltr">{plate}</bdi>, mono: true },
          { label: ar('vehicles.type'), value: facts.vehicleTypeAr || EMPTY_VALUE },
          {
            label: ar('vehicles.vin'),
            value: <bdi dir="ltr">{facts.vin || EMPTY_VALUE}</bdi>,
            mono: true,
          },
          { label: ar('vehicles.site'), value: facts.siteAr || EMPTY_VALUE },
          { label: ar('vehicles.dateTime'), value: <bdi dir="ltr">{dateTime}</bdi>, mono: true },
          { label: ar('vehicles.employee'), value: facts.driver || EMPTY_VALUE },
          { label: ar('vehicles.accidentLocation'), value: location || pending },
          {
            label: ar('vehicles.policeRef'),
            value: <bdi dir="ltr">{facts.policeRef?.trim() || EMPTY_VALUE}</bdi>,
            mono: true,
          },
          { label: ar('vehicles.damageCost'), value: ar('vehicles.damageCoverLine') },
          {
            label: ar('vehicles.status'),
            value: ar(facts.status === 'open' ? 'vehicles.openStatus' : 'vehicles.closedStatus'),
          },
        ]}
      />

      {/* The template's «الوصف» heading and the Arabic account beneath it,
          the operator's own line breaks preserved. */}
      <h3 className="mb-1.5 mt-4 text-[0.72rem] font-bold">{ar('vehicles.description')}</h3>
      <p className="m-0 whitespace-pre-line border border-[#ddd] bg-white p-2.5 text-[0.66rem] leading-relaxed">
        {description || pending}
      </p>
    </PaperSheet>
  )
}
