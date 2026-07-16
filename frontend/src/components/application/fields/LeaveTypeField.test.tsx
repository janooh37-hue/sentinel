/**
 * LeaveTypeField — option localization.
 *
 * The Leave Application Form stores full names ("Annual Leave"…). Options must
 * render through the shared leaves.type.* table (so Arabic works too), not the
 * raw stored value only. i18n (English) comes from the global test/setup.ts.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useForm, FormProvider } from 'react-hook-form'

import { LeaveTypeField } from './LeaveTypeField'

const LEAVE_OPTIONS = [
  'Annual Leave',
  'Sick Leave',
  'Compassionate Leave',
  'Duty Leave',
  'Emergency Leave',
  'Hajj Leave',
  'Others',
]

function Host({ options }: { options: string[] }) {
  const methods = useForm({ defaultValues: { leave_type: '' } })
  return (
    <FormProvider {...methods}>
      <LeaveTypeField
        name="leave_type"
        label_en="Leave Type"
        label_ar="نوع الإجازة"
        required
        options={options}
      />
    </FormProvider>
  )
}

describe('LeaveTypeField option localization', () => {
  it('renders each option through the leaves.type table', () => {
    render(<Host options={LEAVE_OPTIONS} />)
    fireEvent.click(screen.getByRole('combobox'))

    // English labels equal the key text here, but the key path must resolve.
    for (const label of ['Annual Leave', 'Sick Leave', 'Compassionate Leave', 'Others']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('falls back to the raw value for an unknown option', () => {
    render(<Host options={['Sabbatical Leave']} />)
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText('Sabbatical Leave')).toBeInTheDocument()
  })
})
