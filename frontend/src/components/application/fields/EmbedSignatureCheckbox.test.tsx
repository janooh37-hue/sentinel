/**
 * EmbedSignatureCheckbox — defaultOn contract (Task 8).
 *
 * Mirrors CheckboxField.test.tsx's untouched-submit case, the actual
 * dangerous path: an untouched box must submit whatever `defaultOn` says,
 * not silently fall back to `false`. `defaultOn` is driven by
 * `field.default === 'true'` in buildZodSchema (applicationFormSchema.ts),
 * the same per-field mechanism TemplateForm.tsx threads through. A field
 * with no default keeps submitting false when untouched.
 */

import { zodResolver } from '@hookform/resolvers/zod'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { buildZodSchema } from '@/lib/applicationFormSchema'
import type { TemplateField } from '../types'
import { EmbedSignatureCheckbox } from './EmbedSignatureCheckbox'

function fields(defaultValue?: string): TemplateField[] {
  return [
    {
      id: 'hand_sign_employee',
      type: 'hand_sign_checkbox',
      label_en: 'Embed employee signature',
      label_ar: 'تضمين توقيع الموظف',
      required: false,
      default: defaultValue,
    },
  ]
}

function Harness({
  defaultOn,
  schemaDefault,
  onSubmit,
}: {
  defaultOn: boolean
  schemaDefault?: string
  onSubmit: (v: unknown) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const form = useForm({
    resolver: zodResolver(buildZodSchema(fields(schemaDefault), t)),
    defaultValues: {},
  })
  return (
    <FormProvider {...form}>
      <EmbedSignatureCheckbox
        name="hand_sign_employee"
        label_en="Embed employee signature"
        label_ar="تضمين توقيع الموظف"
        defaultOn={defaultOn}
      />
      <button type="button" onClick={() => void form.handleSubmit(onSubmit)()}>
        submit
      </button>
    </FormProvider>
  )
}

describe('EmbedSignatureCheckbox — defaultOn contract', () => {
  it('defaultOn renders checked before any interaction', () => {
    render(<Harness defaultOn schemaDefault="true" onSubmit={() => {}} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('without defaultOn renders unchecked before any interaction', () => {
    render(<Harness defaultOn={false} onSubmit={() => {}} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('an untouched submit with defaultOn is boolean true — the regression this whole task fixed', async () => {
    const onSubmit = vi.fn()
    render(<Harness defaultOn schemaDefault="true" onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
    expect(payload.hand_sign_employee).toBe(true)
  })

  it('an explicit untick still submits boolean false even with defaultOn', async () => {
    const onSubmit = vi.fn()
    render(<Harness defaultOn schemaDefault="true" onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('checkbox')) // defaultOn checked -> untick
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
    expect(payload.hand_sign_employee).toBe(false)
  })

  it('an untouched submit without defaultOn stays boolean false', async () => {
    const onSubmit = vi.fn()
    render(<Harness defaultOn={false} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
    expect(payload.hand_sign_employee).toBe(false)
  })
})
