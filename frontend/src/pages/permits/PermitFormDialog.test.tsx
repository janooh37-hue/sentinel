import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { api, type PermitRead } from '@/lib/api'
import { PermitFormDialog } from './PermitFormDialog'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(['permits.create', 'permits.edit']), isLoading: false, has: () => true }),
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
    validity: { value: 1, unit: 'month' },
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
  it('gives every visitor input a visible mobile label', () => {
    renderForm()

    for (const name of ['Full name', 'UAE ID', 'Job / trade', 'Nationality']) {
      const input = screen.getByLabelText(name, { selector: 'input' })
      const label = input.closest('label')
      expect(label).not.toBeNull()
      const text = within(label as HTMLLabelElement).getByText(name)
      expect(text).toBeVisible()
      expect(text).toHaveClass('sm:sr-only')
      expect(text).not.toHaveClass('sr-only')
    }
  })

  it('exposes the validity choices as a named group', () => {
    renderForm()
    expect(screen.getByRole('group', { name: 'Permit validity' })).toBeInTheDocument()
  })

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
    await userEvent.type(screen.getByLabelText(/job \/ trade/i), 'Electrician')
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
    await userEvent.type(screen.getByLabelText(/job \/ trade/i), 'Electrician')
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
  it('submits validity presets and a trimmed visitor job without an end date', async () => {
    const createSpy = vi.spyOn(api, 'createPermit').mockResolvedValue({ id: 7, people: [], vehicles: [] } as never)
    renderForm()
    await userEvent.type(screen.getByLabelText(/company/i), 'ACME')
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')
    await userEvent.type(screen.getByLabelText(/job \/ trade/i), '  Electrician  ')
    await userEvent.click(screen.getByRole('button', { name: /al wathba 1.*green/i }))
    await userEvent.click(screen.getByRole('button', { name: /^6 months$/i }))
    await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
        start_date: expect.any(String),
        validity: { value: 6, unit: 'month' },
        people: [expect.objectContaining({ uae_id: '784-1', role: 'Electrician' })],
      })),
    )
    expect(createSpy.mock.calls[0][0]).not.toHaveProperty('end_date')
  })

  it('renders the approved validity presets in order and has no three-month preset', () => {
    renderForm()
    const names = screen.getAllByRole('button').map((button) => button.textContent?.trim())
    const validityNames = ['1 day', '1 week', '1 month', '6 months', '1 year', 'Custom period']
    expect(names.filter((name) => validityNames.includes(name ?? ''))).toEqual(validityNames)
    expect(screen.queryByRole('button', { name: /3 months/i })).not.toBeInTheDocument()
  })

  it('opens custom validity controls and enables issue after a positive value and unit', async () => {
    const createSpy = vi.spyOn(api, 'createPermit').mockResolvedValue({ id: 7, people: [], vehicles: [] } as never)
    renderForm()
    await userEvent.type(screen.getByLabelText(/company/i), 'ACME')
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')
    await userEvent.type(screen.getByLabelText(/job \/ trade/i), 'Electrician')
    await userEvent.click(screen.getByRole('button', { name: /al wathba 1.*green/i }))
    await userEvent.click(screen.getByRole('button', { name: /custom period/i }))
    await userEvent.clear(screen.getByLabelText(/duration/i))
    await userEvent.type(screen.getByLabelText(/duration/i), '2')
    await userEvent.selectOptions(screen.getByLabelText(/unit/i), 'month')
    expect(screen.getByRole('button', { name: /issue permit/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      validity: { value: 2, unit: 'month' },
    })))
  })

  it('requires a nonblank job / trade for each new person', async () => {
    renderForm()
    await userEvent.type(screen.getByLabelText(/company/i), 'ACME')
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')
    await userEvent.click(screen.getByRole('button', { name: /al wathba 1.*green/i }))
    expect(screen.getByRole('button', { name: /issue permit/i })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/job \/ trade/i), ' Electrician ')
    expect(screen.getByRole('button', { name: /issue permit/i })).toBeEnabled()
  })

  it('round-trips validity when editing a permit without writing an end date', async () => {
    const updateSpy = vi.spyOn(api, 'updatePermit').mockResolvedValue({ id: 7 } as never)
    renderForm(editPermit({ al_wathba_1: ['green'], al_wathba_2: [], work_residence: false }))
    await userEvent.click(screen.getByRole('button', { name: /save permit/i }))
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(7, expect.objectContaining({
        start_date: '2026-08-01',
        validity: { value: 1, unit: 'month' },
      })),
    )
    expect(updateSpy.mock.calls[0][1]).not.toHaveProperty('end_date')
  })

  it('keeps all vehicle fields in the create payload', async () => {
    const createSpy = vi.spyOn(api, 'createPermit').mockResolvedValue({ id: 7, people: [], vehicles: [] } as never)
    renderForm()
    await userEvent.type(screen.getByLabelText(/company/i), 'ACME')
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')
    await userEvent.type(screen.getByLabelText(/job \/ trade/i), 'Electrician')
    await userEvent.click(screen.getByRole('button', { name: /al wathba 1.*green/i }))
    await userEvent.click(screen.getByRole('button', { name: /add another vehicle/i }))
    await userEvent.type(screen.getByPlaceholderText(/plate no/i), 'A 1')
    await userEvent.type(screen.getByPlaceholderText(/make \/ model/i), 'Sedan')
    await userEvent.type(screen.getByPlaceholderText(/colour/i), 'White')
    await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
        vehicles: [expect.objectContaining({ plate_no: 'A 1', make_model: 'Sedan', colour: 'White' })],
      })),
    )
  })
  it('keeps Issue Permit disabled and sends no request until access is selected', async () => {
    const createSpy = vi.spyOn(api, 'createPermit').mockResolvedValue({ id: 7, people: [], vehicles: [] } as never)
    renderForm()
    await userEvent.type(screen.getByLabelText(/company/i), 'ACME')
    createSpy.mockClear()
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')
    await userEvent.type(screen.getByLabelText(/job \/ trade/i), 'Electrician')
    expect(screen.getByRole('button', { name: /issue permit/i })).toBeDisabled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('uses a changed start date in the create payload', async () => {
    const createSpy = vi.spyOn(api, 'createPermit').mockResolvedValue({ id: 7, people: [], vehicles: [] } as never)
    renderForm()
    await userEvent.type(screen.getByLabelText(/company/i), 'ACME')
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')
    await userEvent.type(screen.getByLabelText(/job \/ trade/i), 'Electrician')
    await userEvent.clear(screen.getByLabelText(/start date/i))
    await userEvent.type(screen.getByLabelText(/start date/i), '2026-09-01')
    await userEvent.click(screen.getByRole('button', { name: /al wathba 1.*green/i }))
    await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-09-01',
    })))
  })

  it('uses a changed start date in the edit payload', async () => {
    const updateSpy = vi.spyOn(api, 'updatePermit').mockResolvedValue({ id: 7 } as never)
    renderForm(editPermit({ al_wathba_1: ['green'], al_wathba_2: [], work_residence: false }))
    await userEvent.clear(screen.getByLabelText(/start date/i))
    await userEvent.type(screen.getByLabelText(/start date/i), '2026-09-03')
    await userEvent.click(screen.getByRole('button', { name: /save permit/i }))
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(7, expect.objectContaining({
      start_date: '2026-09-03',
    })))
  })

  it('hydrates and round-trips a stored custom validity period in edit mode', async () => {
    const updateSpy = vi.spyOn(api, 'updatePermit').mockResolvedValue({ id: 7 } as never)
    const permit = editPermit({ al_wathba_1: ['green'], al_wathba_2: [], work_residence: false })
    permit.validity = { value: 2, unit: 'month' }
    renderForm(permit)
    expect(screen.getByLabelText(/duration/i)).toHaveValue(2)
    expect(screen.getByLabelText(/unit/i)).toHaveValue('month')
    await userEvent.click(screen.getByRole('button', { name: /save permit/i }))
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(7, expect.objectContaining({
      validity: { value: 2, unit: 'month' },
    })))
  })
  it('keeps Issue Permit disabled with a blank company and sends no request', async () => {
    const createSpy = vi.spyOn(api, 'createPermit').mockResolvedValue({ id: 7, people: [], vehicles: [] } as never)
    renderForm()
    createSpy.mockClear()
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')
    await userEvent.type(screen.getByLabelText(/job \/ trade/i), 'Electrician')
    await userEvent.click(screen.getByRole('button', { name: /al wathba 1.*green/i }))
    expect(screen.getByRole('button', { name: /issue permit/i })).toBeDisabled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('keeps Save disabled with a blank company and sends no edit request', async () => {
    const updateSpy = vi.spyOn(api, 'updatePermit').mockResolvedValue({ id: 7 } as never)
    renderForm(editPermit({ al_wathba_1: ['green'], al_wathba_2: [], work_residence: false }))
    updateSpy.mockClear()
    await userEvent.clear(screen.getByLabelText(/company/i))
    expect(screen.getByRole('button', { name: /save permit/i })).toBeDisabled()
    expect(updateSpy).not.toHaveBeenCalled()
  })
