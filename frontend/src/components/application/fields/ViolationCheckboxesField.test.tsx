/**
 * ViolationCheckboxesField — Others option + alignment tests.
 *
 * The grid emits `violations` as `[{row, name}]`. An "Others (اخرى)" checkbox
 * appends a sentinel `{row: 0, name: "Others"}` (row 0 is never queried by the
 * printed template) and reveals a textarea bound to the companion `explanation`
 * field, whose key arrives via the `othersName` prop. i18n resolves to English
 * (test/setup.ts).
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useForm, FormProvider, useWatch } from 'react-hook-form'

import { ViolationCheckboxesField } from './ViolationCheckboxesField'

function Debug() {
  const violations = useWatch({ name: 'violations' })
  const explanation = useWatch({ name: 'explanation' })
  return (
    <pre data-testid="values">
      {JSON.stringify({ violations: violations ?? [], explanation: explanation ?? '' })}
    </pre>
  )
}

function Host({
  defaults,
}: {
  defaults?: { violations?: unknown[]; explanation?: string }
}) {
  const methods = useForm({
    defaultValues: {
      violations: defaults?.violations ?? [],
      explanation: defaults?.explanation ?? '',
    },
  })
  return (
    <FormProvider {...methods}>
      <ViolationCheckboxesField
        name="violations"
        othersName="explanation"
        label_en="Violations"
        label_ar="المخالفات"
        required
      />
      <Debug />
    </FormProvider>
  )
}

function values() {
  return JSON.parse(screen.getByTestId('values').textContent || '{}') as {
    violations: { row: number; name: string }[]
    explanation: string
  }
}

describe('ViolationCheckboxesField — Others option', () => {
  it('ticking Others appends the {row:0, name:"Others"} sentinel', () => {
    render(<Host />)
    fireEvent.click(screen.getByLabelText('Others'))
    expect(values().violations).toContainEqual({ row: 0, name: 'Others' })
  })

  it('ticking Others reveals a textarea whose text feeds explanation', () => {
    render(<Host />)
    expect(screen.queryByPlaceholderText(/describe the violation/i)).toBeNull()
    fireEvent.click(screen.getByLabelText('Others'))
    const box = screen.getByPlaceholderText(/describe the violation/i)
    fireEvent.change(box, { target: { value: 'Spitting on the floor' } })
    expect(values().explanation).toBe('Spitting on the floor')
  })

  it('unticking Others removes the sentinel, clears explanation and hides the box', () => {
    render(<Host />)
    fireEvent.click(screen.getByLabelText('Others'))
    fireEvent.change(screen.getByPlaceholderText(/describe the violation/i), {
      target: { value: 'Some other thing' },
    })
    fireEvent.click(screen.getByLabelText('Others'))
    expect(values().violations).not.toContainEqual({ row: 0, name: 'Others' })
    expect(values().explanation).toBe('')
    expect(screen.queryByPlaceholderText(/describe the violation/i)).toBeNull()
  })

  it('reveals the textarea when explanation has initial text (legacy/revise)', () => {
    render(<Host defaults={{ explanation: 'Pre-existing remark' }} />)
    expect(screen.getByPlaceholderText(/describe the violation/i)).toHaveValue(
      'Pre-existing remark',
    )
  })

  it('renders no Others UI when othersName is absent', () => {
    function Bare() {
      const methods = useForm({ defaultValues: { violations: [] } })
      return (
        <FormProvider {...methods}>
          <ViolationCheckboxesField
            name="violations"
            label_en="Violations"
            label_ar="المخالفات"
            required
          />
        </FormProvider>
      )
    }
    render(<Bare />)
    expect(screen.queryByLabelText('Others')).toBeNull()
  })
})

describe('ViolationCheckboxesField — alignment', () => {
  it('keeps each checkbox at a fixed box (shrink-0) so long labels do not squish it', () => {
    render(<Host />)
    const boxes = screen.getAllByRole('checkbox')
    for (const box of boxes) {
      expect(box.className).toContain('shrink-0')
    }
  })
})
