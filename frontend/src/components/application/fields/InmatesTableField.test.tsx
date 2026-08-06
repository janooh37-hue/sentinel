import { zodResolver } from '@hookform/resolvers/zod'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'

import i18n from '@/lib/i18n'
import { buildZodSchema } from '@/lib/applicationFormSchema'
import type { TemplateField } from '../types'
import { InmatesTableField } from './InmatesTableField'

function Harness(): React.JSX.Element {
  const form = useForm({ defaultValues: { inmates: [] } })
  return (
    <FormProvider {...form}>
      <InmatesTableField name="inmates" label_en="Inmates" label_ar="النزلاء" required />
    </FormProvider>
  )
}

const VALIDATED_FIELDS: TemplateField[] = [
  { id: 'inmates', label_en: 'Inmates', label_ar: 'النزلاء', type: 'inmates_table', required: true },
]

// Mirrors the real submit path (ApplicationPage: buildZodSchema + zodResolver).
function ValidatedHarness(): React.JSX.Element {
  const { t } = useTranslation()
  const form = useForm({
    resolver: zodResolver(buildZodSchema(VALIDATED_FIELDS, t)),
    defaultValues: { inmates: [] },
  })
  return (
    <FormProvider {...form}>
      <InmatesTableField name="inmates" label_en="Inmates" label_ar="النزلاء" required />
      <button type="button" onClick={() => void form.handleSubmit(() => {})()}>
        submit
      </button>
    </FormProvider>
  )
}

describe('InmatesTableField', () => {
  // If an assertion inside the Arabic test below fails, an inline restore at
  // the end of that `it` never runs — the language stays 'ar' and the NEXT
  // test fails with a misleading "button not found" instead of pointing at
  // the real Arabic regression. afterEach runs regardless of pass/fail.
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('starts empty and adds a row on demand', async () => {
    render(<Harness />)
    expect(screen.getByText(/no rows yet/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0)
  })

  it('offers the 12 wings 1A…6B and nothing else', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    const wing = screen.getByRole('combobox', { name: /wing/i })
    const values = Array.from(wing.querySelectorAll('option'))
      .map((o) => o.value)
      .filter(Boolean)
    expect(values).toEqual([
      '1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', '5A', '5B', '6A', '6B',
    ])
  })

  it('renumbers the ت column after a row is removed', async () => {
    render(<Harness />)
    const add = screen.getByRole('button', { name: /add inmate/i })
    await userEvent.click(add)
    await userEvent.click(add)
    await userEvent.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()
  })

  it('renders Arabic column headers under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    render(<Harness />)
    // Assert the Arabic string itself — an English-only assertion cannot catch
    // an AR leak when the EN label happens to equal the key.
    expect(screen.getByText('اسم النزيل')).toBeInTheDocument()
    expect(screen.getByText('الرقم الموحد')).toBeInTheDocument()
    expect(screen.getByText('ت')).toBeInTheDocument()
  })

  it('surfaces a visible error when a required cell (name) is left blank — not a silent no-op', async () => {
    render(<ValidatedHarness />)
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    // Leave `name` blank on the one row just added; attempt to submit.
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('rejects a whitespace-only name — a bare min(1) would let it through and print a numbered but nameless row', async () => {
    render(<ValidatedHarness />)
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    await userEvent.type(screen.getByLabelText('Inmate name'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
