/**
 * EmbedSignatureCheckbox — defaultOn contract (Task 8).
 *
 * Mirrors CheckboxField.test.tsx's untouched-submit case, the actual
 * dangerous path: an untouched box must submit whatever `defaultOn` says,
 * not silently fall back to `false`. `defaultOn` is driven by
 * `field.default === 'true'` in buildZodSchema (applicationFormSchema.ts),
 * the same per-field mechanism TemplateForm.tsx threads through — so this
 * also pins that a field with no `default` (every sibling form's
 * hand_sign_manager) keeps submitting `false` when untouched.
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
      id: 'hand_sign_manager',
      type: 'hand_sign_checkbox',
      label_en: 'Embed manager signature',
      label_ar: 'تضمين توقيع المدير',
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
        name="hand_sign_manager"
        label_en="Embed manager signature"
        label_ar="تضمين توقيع المدير"
        defaultOn={defaultOn}
      />
      <button type="button" onClick={() => void form.handleSubmit(onSubmit)()}>
        submit
      </button>
    </FormProvider>
  )
}

describe('EmbedSignatureCheckbox — defaultOn contract', () => {
  it('defaultOn renders checked before any interaction (Inmate Conduct Violations)', () => {
    render(<Harness defaultOn schemaDefault="true" onSubmit={() => {}} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('without defaultOn (every sibling form) renders unchecked before any interaction', () => {
    render(<Harness defaultOn={false} onSubmit={() => {}} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('an untouched submit with defaultOn is boolean true — the regression this whole task fixed', async () => {
    const onSubmit = vi.fn()
    render(<Harness defaultOn schemaDefault="true" onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
    expect(payload.hand_sign_manager).toBe(true)
  })

  it('an explicit untick still submits boolean false even with defaultOn', async () => {
    const onSubmit = vi.fn()
    render(<Harness defaultOn schemaDefault="true" onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('checkbox')) // defaultOn checked -> untick
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
    expect(payload.hand_sign_manager).toBe(false)
  })

  it('an untouched submit without defaultOn (sibling forms) stays boolean false', async () => {
    const onSubmit = vi.fn()
    render(<Harness defaultOn={false} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
    expect(payload.hand_sign_manager).toBe(false)
  })
})
