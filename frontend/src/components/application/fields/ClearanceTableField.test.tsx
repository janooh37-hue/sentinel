/**
 * ClearanceTableField — alignment test.
 *
 * The Cleared/Not radios sit two-across in a narrow status column; with long
 * localized labels (Arabic "تم الإخلاء") a radio without `shrink-0` gets
 * squeezed and the row looks broken. Assert the fixed box class, mirroring the
 * violation-grid fix.
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useForm, FormProvider } from 'react-hook-form'

import { ClearanceTableField } from './ClearanceTableField'

function Host() {
  const methods = useForm({ defaultValues: { clearance_table: undefined } })
  return (
    <FormProvider {...methods}>
      <ClearanceTableField
        name="clearance_table"
        label_en="Clearance"
        label_ar="الإخلاء"
      />
    </FormProvider>
  )
}

describe('ClearanceTableField — alignment', () => {
  it('keeps each status radio at a fixed box (shrink-0) so labels do not squish it', () => {
    render(<Host />)
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBeGreaterThan(0)
    for (const radio of radios) {
      expect(radio.className).toContain('shrink-0')
    }
  })
})
