/**
 * TimeField — the only new field component from the Inmate Conduct
 * Violations branch that shipped with no direct test (Task 9 review
 * finding). The assembly test (TemplateForm.inmateViolations.test.tsx) only
 * ever asserted the English label via `getByLabelText(/time/i)` — this repo's
 * documented trap is exactly a test that stays green while the Arabic label
 * never gets checked at all.
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect, afterAll } from 'vitest'
import { useForm, FormProvider } from 'react-hook-form'

import i18n from '@/lib/i18n'
import { TimeField } from './TimeField'

function Host({ required = false }: { required?: boolean }): React.JSX.Element {
  const methods = useForm({ defaultValues: { report_time: '' } })
  return (
    <FormProvider {...methods}>
      <TimeField name="report_time" label_en="Time" label_ar="الوقت" required={required} />
    </FormProvider>
  )
}

describe('TimeField', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders a native time input under the English label', () => {
    render(<Host />)
    const input = screen.getByLabelText('Time')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'time')
  })

  it('renders the Arabic label under lng=ar — not the English one', async () => {
    await i18n.changeLanguage('ar')
    render(<Host />)
    expect(screen.getByLabelText('الوقت')).toBeInTheDocument()
    expect(screen.queryByLabelText('Time')).not.toBeInTheDocument()
  })

  it('shows the required asterisk only when required', () => {
    const { rerender } = render(<Host required={false} />)
    expect(screen.queryByText('*')).not.toBeInTheDocument()
    rerender(<Host required />)
    expect(screen.getByText('*')).toBeInTheDocument()
  })
})
