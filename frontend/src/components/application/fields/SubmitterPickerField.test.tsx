import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FormProvider, useForm, useWatch } from 'react-hook-form'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, listSubmitters: vi.fn() } }
})
vi.mock('@/lib/useIdentity', () => ({
  useIdentity: () => ({ identity: { linked: true, employee_id: 'G100' } }),
}))
vi.mock('../SubmitterManagerDialog', () => ({ SubmitterManagerDialog: () => null }))
vi.mock('@/components/shell/CapabilityGate', () => ({ CapabilityGate: () => null }))

import { api } from '@/lib/api'
import { SubmitterPickerField } from './SubmitterPickerField'

const NAME = 'submitter_id'

function Host({
  value,
  kind,
}: {
  value?: string
  kind?: 'submitter' | 'interviewer'
}): React.JSX.Element {
  const methods = useForm<Record<string, unknown>>({
    defaultValues: value === undefined ? {} : { [NAME]: value },
  })
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  const current: unknown = useWatch({ control: methods.control, name: NAME })
  return (
    <QueryClientProvider client={client}>
      <FormProvider {...methods}>
        <SubmitterPickerField
          name={NAME}
          label_en="Submitter"
          label_ar="مقدم الطلب"
          kind={kind}
        />
        <output data-testid="value">{JSON.stringify(current ?? null)}</output>
      </FormProvider>
    </QueryClientProvider>
  )
}

const value = () => screen.getByTestId('value').textContent

beforeEach(() => {
  vi.mocked(api.listSubmitters).mockResolvedValue([
    { id: 5, name: 'Me', employee_id: 'G100', stored_sig_path: null },
    { id: 6, name: 'Other', employee_id: null, stored_sig_path: null },
  ] as never)
})

describe('SubmitterPickerField', () => {
  it('starts empty for a submitter, even when the signed-in user has a row', async () => {
    render(<Host />)
    await waitFor(() => expect(api.listSubmitters).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('combobox')).not.toBeDisabled())
    expect(value()).toBe('null')
    expect(screen.getByRole('combobox')).toHaveTextContent('— No selection —')
  })

  it('pre-fills the interviewer and lets the operator empty it', async () => {
    render(<Host kind="interviewer" />)
    await waitFor(() => expect(value()).toBe('"5"'))
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: '— No selection —' }))
    await waitFor(() => expect(value()).toBe('""'))
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('— No selection —'))
    expect(value()).toBe('""')
  })

  it('drops a stored submitter that no longer exists', async () => {
    render(<Host value="2" />)
    await waitFor(() => expect(value()).toBe('""'))
    expect(screen.getByRole('combobox')).toHaveTextContent('— No selection —')
  })

  it('keeps a stored submitter that exists', async () => {
    render(<Host value="6" />)
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Other'))
    expect(value()).toBe('"6"')
  })
})
