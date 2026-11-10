import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FormProvider, useForm } from 'react-hook-form'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, getEmployeeSignature: vi.fn(), listSubmitters: vi.fn() },
  }
})
vi.mock('@/components/signature/SignatureDrawPanel', () => ({
  SignatureDrawPanel: () => <div data-testid="draw-panel" />,
}))

import { api } from '@/lib/api'
import { EmployeeSignatureCard } from './EmployeeSignatureCard'

const SUBMITTER_SIG = 'data:image/png;base64,AAAA'

function Host({
  submitterId,
  hasCompanion = false,
}: {
  submitterId?: string
  hasCompanion?: boolean
}): React.JSX.Element {
  const methods = useForm<Record<string, unknown>>({
    defaultValues: submitterId ? { submitter_id: submitterId } : {},
  })
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <QueryClientProvider client={client}>
      <FormProvider {...methods}>
        <EmployeeSignatureCard
          name="employee_sig_path"
          embedName="hand_sign_employee"
          employeeId="G1"
          hasCompanion={hasCompanion}
        />
      </FormProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  // The applicant (G1) has no signature on file; the submitter's employee (G2) does.
  vi.mocked(api.getEmployeeSignature).mockImplementation(async (id: string) =>
    id === 'G2' ? ({ dataUrl: SUBMITTER_SIG, updatedAt: null } as never) : null,
  )
  vi.mocked(api.listSubmitters).mockResolvedValue([
    { id: 7, name: 'Front Desk', employee_id: 'G2', stored_sig_path: null },
  ] as never)
})

describe('EmployeeSignatureCard with a submitter', () => {
  it('lets the submitter sign for an employee with no signature and no embed tick', async () => {
    render(<Host submitterId="7" />)
    expect(await screen.findByText('Submitter signs for the employee')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Submitter signs for the employee' })).toHaveAttribute(
      'src',
      SUBMITTER_SIG,
    )
    expect(screen.queryByTestId('draw-panel')).not.toBeInTheDocument()
    expect(screen.queryByText('No signature on file')).not.toBeInTheDocument()
  })

  it('keeps the employee controls for the companion page', async () => {
    render(<Host submitterId="7" hasCompanion />)
    expect(await screen.findByText('Submitter signs for the employee')).toBeInTheDocument()
    expect(await screen.findByTestId('draw-panel')).toBeInTheDocument()
    expect(
      screen.getByText('The signature below applies to the undertaking (page 2).'),
    ).toBeInTheDocument()
  })
})

describe('EmployeeSignatureCard without a submitter', () => {
  it("offers the employee's own signature", async () => {
    render(<Host />)
    expect(await screen.findByTestId('draw-panel')).toBeInTheDocument()
    expect(screen.queryByText('Submitter signs for the employee')).not.toBeInTheDocument()
  })
})
