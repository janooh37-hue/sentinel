/**
 * CheckboxField — submitted payload type.
 *
 * The Inmate Conduct Violations backend selects its action bullets by plain
 * `fields.get(key)` truthiness (document_service.py) — a JSON string "false"
 * is truthy in Python and would print an unticked box as ticked. Every
 * checkbox-typed field (including action_notified/action_written/
 * action_transferred) renders through this shared component, so pinning the
 * contract here guards all of them at once: CheckboxField must emit a real
 * boolean, both as the live RHF field value and as what the zodResolver used
 * at submit time (buildZodSchema, same as ApplicationPage) hands to the
 * submit callback — never the strings "true"/"false" or "0"/"1".
 */

import { zodResolver } from '@hookform/resolvers/zod'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { buildZodSchema } from '@/lib/applicationFormSchema'
import type { TemplateField } from '../types'
import { CheckboxField } from './CheckboxField'

const FIELDS: TemplateField[] = [
  {
    id: 'action_notified',
    type: 'checkbox',
    label_en: 'Branch manager was notified',
    label_ar: 'تم ابلاغ مدير فرع شؤون النزلاء',
    required: false,
  },
]

function Watched(): React.JSX.Element {
  const v = useWatch({ name: 'action_notified' })
  // Unquoted JSON.stringify output ("true"/"false") is how we tell a real
  // boolean apart from the string "true"/"false" (which would render as
  // '"true"' — quoted).
  return <pre data-testid="watched">{JSON.stringify(v)}</pre>
}

function Harness({ onSubmit }: { onSubmit: (v: unknown) => void }): React.JSX.Element {
  const { t } = useTranslation()
  const form = useForm({
    resolver: zodResolver(buildZodSchema(FIELDS, t)),
    defaultValues: { action_notified: false },
  })
  return (
    <FormProvider {...form}>
      <CheckboxField name="action_notified" label_en="Notified" label_ar="ابلاغ" />
      <Watched />
      <button type="button" onClick={() => void form.handleSubmit(onSubmit)()}>
        submit
      </button>
    </FormProvider>
  )
}

describe('CheckboxField — submitted payload types', () => {
  it('the live field value is a real boolean, not the string "true"/"false"', async () => {
    render(<Harness onSubmit={() => {}} />)
    expect(screen.getByTestId('watched').textContent).toBe('false')
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByTestId('watched').textContent).toBe('true')
  })

  it('the value handed to the submit callback (through the real zodResolver) is boolean true, typeof "boolean"', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
    expect(payload.action_notified).toBe(true)
    expect(typeof payload.action_notified).toBe('boolean')
  })

  // This is the actual dangerous path: an UNTICKED box that gets stringified
  // as "false" is still truthy to the backend's `fields.get(key)` and would
  // print as a ticked bullet on an official document. The ticked→true case
  // above doesn't exercise this at all.
  it('an untouched (unticked) submit is boolean false, typeof "boolean" — not the string "false"', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
    expect(payload.action_notified).toBe(false)
    expect(typeof payload.action_notified).toBe('boolean')
  })
})
