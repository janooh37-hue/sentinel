import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { PermitFormDialog } from './PermitFormDialog'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(['permits.manage']), isLoading: false, has: () => true }),
}))

// Silence toast in tests
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listManagers: vi.fn().mockResolvedValue([]),
      scanVehicleLicence: vi.fn(),
      scanEmiratesId: vi.fn(),
      createPermit: vi.fn(),
      uploadPermitDocument: vi.fn(),
      uploadPersonDocument: vi.fn(),
      uploadVehicleDocument: vi.fn(),
    },
  }
})

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PermitFormDialog
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('PermitFormDialog', () => {
  it('scanning a licence pre-fills vehicle fields (editable)', async () => {
    vi.spyOn(api, 'scanVehicleLicence').mockResolvedValue({
      plate_no: 'A 1',
      colour: 'White',
      reg_expiry: '2027-03-14',
    })

    renderForm()

    // Add a vehicle row so the scan input exists
    const addVehicle = screen.getByRole('button', { name: /add another vehicle/i })
    await userEvent.click(addVehicle)

    // Upload a file to the "Scan licence" hidden input (aria-label used in the component)
    const scanInput = screen.getByLabelText(/scan licence/i)
    await userEvent.upload(scanInput, new File(['x'], 'm.jpg', { type: 'image/jpeg' }))

    // The colour field should be pre-filled
    expect(await screen.findByDisplayValue('White')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A 1')).toBeInTheDocument()
  })
})
