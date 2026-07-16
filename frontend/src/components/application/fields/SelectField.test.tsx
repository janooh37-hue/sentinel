/**
 * SelectField — option localization.
 *
 * SelectField renders EVERY `select` field: the HR Request Form's
 * `doc_selections` (slug values like `salary_pay_slip` → `hr.docType.*`) AND the
 * Leave Application Form's `leave_type` (full names like "Annual Leave" →
 * `leaves.type.*`). Both must render human, locale-correct labels, never the raw
 * stored value. i18n (English) comes from the global test/setup.ts; the Arabic
 * block below registers the AR bundle and switches language.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import i18n from 'i18next'
import { useForm, FormProvider } from 'react-hook-form'

import ar from '@/locales/ar.json'
import { SelectField } from './SelectField'

const DOC_OPTIONS = [
  'insurance_card',
  'id_card',
  'employment_certificate',
  'salary_certificate',
  'salary_transfer_letter',
  'salary_pay_slip',
  'experience_certificate',
]

function Host({ options }: { options: string[] }) {
  const methods = useForm({ defaultValues: { doc_selections: '' } })
  return (
    <FormProvider {...methods}>
      <SelectField
        name="doc_selections"
        label_en="Requested Documents"
        label_ar="المستندات المطلوبة"
        required
        options={options}
      />
    </FormProvider>
  )
}

describe('SelectField option localization', () => {
  it('renders hr.docType labels instead of raw slugs', () => {
    render(<Host options={DOC_OPTIONS} />)
    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getByText('Insurance Card')).toBeInTheDocument()
    expect(screen.getByText('Salary Pay Slip')).toBeInTheDocument()
    expect(screen.getByText('Experience Certificate')).toBeInTheDocument()
    // The raw storage slug must never surface in the UI.
    expect(screen.queryByText('salary_pay_slip')).not.toBeInTheDocument()
  })

  it('falls back to the raw value when no translation exists', () => {
    render(<Host options={['totally_unknown_slug']} />)
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText('totally_unknown_slug')).toBeInTheDocument()
  })
})

// The Leave Application Form's `leave_type` also routes through SelectField
// (its `_fields.json` type is `select`). Its options are full leave names that
// live in the shared `leaves.type.*` table — the localization the HR-only lookup
// missed, so Arabic used to leak the raw English name into the picker.
const LEAVE_OPTIONS = [
  'Annual Leave',
  'Sick Leave',
  'Compassionate Leave',
  'Duty Leave',
  'Emergency Leave',
  'Hajj Leave',
  'Others',
]

function LeaveHost({ options }: { options: string[] }) {
  const methods = useForm({ defaultValues: { leave_type: '' } })
  return (
    <FormProvider {...methods}>
      <SelectField
        name="leave_type"
        label_en="Leave Type"
        label_ar="نوع الإجازة"
        required
        options={options}
      />
    </FormProvider>
  )
}

describe('SelectField leave-type localization (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders leaves.type Arabic labels, not the raw English names', () => {
    render(<LeaveHost options={LEAVE_OPTIONS} />)
    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getByText('إجازة سنوية')).toBeInTheDocument() // Annual Leave
    expect(screen.getByText('إجازة مرضية')).toBeInTheDocument() // Sick Leave
    expect(screen.getByText('إجازة تعزية')).toBeInTheDocument() // Compassionate Leave
    // The raw English name must never leak into the Arabic UI.
    expect(screen.queryByText('Annual Leave')).not.toBeInTheDocument()
  })
})
