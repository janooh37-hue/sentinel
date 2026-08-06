import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { api, type PermitRead } from '@/lib/api'
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
      updatePermit: vi.fn(),
      uploadPermitDocument: vi.fn(),
      uploadPersonDocument: vi.fn(),
      uploadVehicleDocument: vi.fn(),
    },
  }
})

function renderForm(permit?: PermitRead | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PermitFormDialog
        open
        permit={permit}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

const editPermit = (access_areas: PermitRead['access_areas'], zones: PermitRead['zones'] = ['green']): PermitRead =>
  ({
    id: 7,
    company: 'ACME',
    access_areas,
    zones,
    start_date: '2026-08-01',
    end_date: '2026-08-31',
    status: 'active',
    created_at: '2026-08-01T00:00:00Z',
    derived_status: 'active',
    duration_days: 30,
    days_remaining: 25,
    people_count: 0,
    vehicle_count: 0,
    has_document: false,
    people: [],
    vehicles: [],
    purpose: null,
    notes: null,
    revoked_at: null,
    revoke_reason: null,
    updated_at: null,
    document_name: null,
    manager_id: null,
  }) as PermitRead


describe('PermitFormDialog', () => {
  it('starts with no access and requires an explicit selection', async () => {
    renderForm()
    expect(screen.getByRole('button', { name: /issue permit/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /al wathba 1.*green/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('sends independent zones for both Al Wathba locations', async () => {
    const createSpy = vi.spyOn(api, 'createPermit').mockResolvedValue({ id: 7 } as never)
    renderForm()
    await userEvent.type(screen.getByLabelText(/company/i), 'ACME')
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')
    await userEvent.click(screen.getByRole('button', { name: /al wathba 1.*green/i }))
    await userEvent.click(screen.getByRole('button', { name: /al wathba 2.*red/i }))
    await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          access_areas: {
            al_wathba_1: ['green'],
            al_wathba_2: ['red'],
            work_residence: false,
          },
        }),
      ),
    )
  })

  it('hydrates canonical access independently on edit', () => {
    renderForm(editPermit({
      al_wathba_1: ['red'],
      al_wathba_2: ['green'],
      work_residence: true,
    }))
    expect(screen.getByRole('button', { name: /al wathba 1.*red/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /al wathba 2.*green/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /work residence/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('keeps legacy locations unspecified until a site is selected', async () => {
    renderForm(editPermit(null, ['green', 'work_residence']))
    expect(screen.getByRole('button', { name: /work residence/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText(/previously recorded/i)).toBeInTheDocument()
    const save = screen.getByRole('button', { name: /save/i })
    expect(save).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /al wathba 2.*red/i }))
    expect(save).not.toBeDisabled()
  })

  it('does not warn for a work-residence-only legacy permit', () => {
    renderForm(editPermit(null, ['work_residence']))
    expect(screen.getByRole('button', { name: /work residence/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByText(/previously recorded/i)).not.toBeInTheDocument()
  })

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

  it('offers a 7-emirate dropdown and the licence scan pre-selects it', async () => {
    vi.spyOn(api, 'scanVehicleLicence').mockResolvedValue({ plate_no: 'A 1', plate_emirate: 'دبي' })

    renderForm()
    await userEvent.click(screen.getByRole('button', { name: /add another vehicle/i }))

    const emirate = screen.getByLabelText(/emirate/i) as HTMLSelectElement
    // 7 emirates + the placeholder option
    expect(emirate.querySelectorAll('option')).toHaveLength(8)

    await userEvent.upload(
      screen.getByLabelText(/scan licence/i),
      new File(['x'], 'm.jpg', { type: 'image/jpeg' }),
    )
    await waitFor(() => expect(emirate.value).toBe('دبي'))
  })

  it('warns that the letter will stay a draft when no manager can receive it', async () => {
    // listManagers returns [] by default, so nothing is routable.
    renderForm()
    expect(screen.getByRole('switch', { name: /send for approval/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByText(/will stay a draft/i)).toBeInTheDocument()

    // Turning the switch off is a deliberate draft — no warning needed.
    await userEvent.click(screen.getByRole('switch', { name: /send for approval/i }))
    expect(screen.queryByText(/will stay a draft/i)).not.toBeInTheDocument()
  })

  it('drops the warning once a manager with a login account is picked', async () => {
    vi.spyOn(api, 'listManagers').mockResolvedValue([
      { id: 1, name_en: 'Linked Boss', active: true, user_id: 42 },
      { id: 2, name_en: 'No Account', active: true, user_id: null },
    ] as never)

    renderForm()
    const select = await screen.findByRole('combobox', { name: /signing manager/i })
    await screen.findByRole('option', { name: 'No Account' }) // wait for the list to load

    await userEvent.selectOptions(select, '2') // manager without a login account
    expect(screen.getByText(/will stay a draft/i)).toBeInTheDocument()

    await userEvent.selectOptions(select, '1') // linked manager — routable
    await waitFor(() =>
      expect(screen.queryByText(/will stay a draft/i)).not.toBeInTheDocument(),
    )
  })

  it('send-for-approval switch defaults ON and is sent with the permit', async () => {
    const created = { id: 7, people: [], vehicles: [] }
    const createSpy = vi.spyOn(api, 'createPermit').mockResolvedValue(created as never)

    renderForm()

    // Fill the minimum valid form: company + one person (name + UAE ID)
    await userEvent.type(screen.getByLabelText(/company/i), 'ACME')
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')
    await userEvent.click(screen.getByRole('button', { name: /al wathba 1.*green/i }))

    const toggle = screen.getByRole('switch', { name: /send for approval/i })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ send_for_approval: true })),
    )

    // Turning it off holds the letter as a draft
    createSpy.mockClear()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ send_for_approval: false })),
    )
  })
})
