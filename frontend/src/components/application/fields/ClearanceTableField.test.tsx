/**
 * ClearanceTableField — alignment + row/token mapping.
 *
 * The row keys `${table}_${row}` must map 1:1 to the template's clearance(t,r)
 * tokens. After the 2026-07-06 template renumber the mapping is:
 *   table 2 → clearance(2,2)..(2,22)  ("Documents" is a header, no token)
 *   table 3 → clearance(3,1)..(3,14)  ("Laptop/Desktop" is now 3_1)
 * A mismatch silently prints marks on the wrong rows, so we pin it here.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useForm, FormProvider, useWatch } from 'react-hook-form'

import { ClearanceTableField } from './ClearanceTableField'

function Debug() {
  const v = useWatch({ name: 'clearance_table' }) as
    | { clearance_marks?: Record<string, boolean> }
    | undefined
  return <pre data-testid="v">{JSON.stringify(v?.clearance_marks ?? {})}</pre>
}

function Host() {
  const methods = useForm({ defaultValues: { clearance_table: undefined } })
  return (
    <FormProvider {...methods}>
      <ClearanceTableField name="clearance_table" label_en="Clearance" label_ar="الإخلاء" />
      <Debug />
    </FormProvider>
  )
}

function markKeys(): string[] {
  return Object.keys(JSON.parse(screen.getByTestId('v').textContent || '{}')).sort()
}

describe('ClearanceTableField — alignment', () => {
  it('keeps each status radio at a fixed box (shrink-0) so labels do not squish it', () => {
    render(<Host />)
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBeGreaterThan(0)
    for (const radio of radios) expect(radio.className).toContain('shrink-0')
  })
})

describe('ClearanceTableField — row/token mapping', () => {
  it('"All Cleared" marks exactly the template clearance keys (2_2..2_22, 3_1..3_14; no 2_1)', () => {
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: 'All Cleared' }))
    const expected = [
      ...Array.from({ length: 21 }, (_, i) => `2_${i + 2}`),
      ...Array.from({ length: 14 }, (_, i) => `3_${i + 1}`),
    ].sort()
    expect(markKeys()).toEqual(expected)
  })

  it('lists Laptop/Desktop as an item and drops the Documents header row', () => {
    render(<Host />)
    expect(screen.getByText('Laptop/Desktop')).toBeInTheDocument()
    expect(screen.queryByText('Documents')).toBeNull()
  })
})
