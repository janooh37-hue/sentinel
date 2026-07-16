/**
 * SelectField — option localization.
 *
 * The HR Request Form's `doc_selections` is the only field routed here, and its
 * options are stored as slugs (`insurance_card`, `salary_pay_slip`…). The field
 * must render the human `hr.docType.*` labels, not the raw slugs. i18n (English)
 * comes from the global test/setup.ts.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useForm, FormProvider } from 'react-hook-form'

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
