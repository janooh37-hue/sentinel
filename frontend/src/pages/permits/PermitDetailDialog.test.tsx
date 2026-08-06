import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import i18n from '@/lib/i18n'

import { api } from '@/lib/api'
import { PermitDetailDialog } from './PermitDetailDialog'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(['permits.manage']), isLoading: false, has: () => true }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const basePermit = {
  id: 99,
  permit_no: 'PMT-0099',
  company: 'Test Corp',
  zones: ['green', 'red'] as const,
  access_areas: { al_wathba_1: ['green'], al_wathba_2: ['red'], work_residence: false },
  start_date: '2026-08-06',
  validity: { value: 1, unit: 'month' },
  end_date: '2026-09-06',
  status: 'active' as const,
  created_at: '2026-07-01T00:00:00',
  derived_status: 'active' as const,
  duration_days: 31,
  days_remaining: 90,
  people_count: 1,
  vehicle_count: 1,
  has_document: false,
  purpose: null,
  notes: null,
  revoked_at: null,
  revoke_reason: null,
  updated_at: null,
  document_name: null,
  people: [],
  vehicles: [],
  manager_id: null,
}

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getPermit: vi.fn(),
      getBook: vi.fn(),
      submitPermitApproval: vi.fn(),
    },
  }
})

function renderDetail(permitOverrides: object = {}) {
  vi.spyOn(api, 'getPermit').mockResolvedValue({ ...basePermit, ...permitOverrides } as never)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PermitDetailDialog permitId={99} open onOpenChange={vi.fn()} onEdit={vi.fn()} />
    </QueryClientProvider>,
  )
}


beforeEach(async () => {
  await i18n.changeLanguage('en')
})
describe('PermitDetailDialog', () => {
  it('shows 1/5 book ref and vehicle colour when present', async () => {
    renderDetail({
      book_ref: '1/5/GSSG/0042',
      book_id: 7,
      vehicles: [
        {
          id: 1,
          permit_id: 99,
          plate_no: 'A 1',
          plate_emirate: null,
          make_model: null,
          driver_name: null,
          licence_doc_name: null,
          created_at: '2026-07-01T00:00:00',
          removed_at: null,
          colour: 'White',
          reg_expiry: '2027-03-14',
        },
      ],
    })

    await waitFor(() => expect(screen.getByText('1/5/GSSG/0042')).toBeInTheDocument())
    expect(screen.getByText('White')).toBeInTheDocument()
    // Print button present when book_id is set
    expect(screen.getByRole('button', { name: /print permit/i })).toBeInTheDocument()
  })
  it('shows full structured access pairings', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())
    expect(screen.getByText('Access areas')).toBeInTheDocument()
    expect(screen.getByText('Al Wathba 1 · Green zone')).toBeInTheDocument()
    expect(screen.getByText('Al Wathba 2 · Red zone')).toBeInTheDocument()
  })

  it('Add vehicle sends the chosen emirate', async () => {
    const addSpy = vi
      .spyOn(api, 'addPermitVehicle')
      .mockResolvedValue({ ...basePermit } as never)

    renderDetail()
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText('Plate no.'), 'A 5')
    await userEvent.selectOptions(screen.getByLabelText(/emirate/i), 'دبي')
    await userEvent.click(screen.getByRole('button', { name: /add vehicle/i }))

    await waitFor(() =>
      expect(addSpy).toHaveBeenCalledWith(99, expect.objectContaining({ plate_emirate: 'دبي' })),
    )
  })

  it('sets the emirate on a vehicle already on the permit', async () => {
    const patchSpy = vi
      .spyOn(api, 'updatePermitVehicle')
      .mockResolvedValue({ ...basePermit } as never)

    renderDetail({
      vehicles: [
        {
          id: 5,
          permit_id: 99,
          plate_no: 'A 1',
          plate_emirate: null,
          make_model: null,
          driver_name: null,
          licence_doc_name: null,
          created_at: '2026-07-01T00:00:00',
          removed_at: null,
          colour: null,
          reg_expiry: null,
        },
      ],
    })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByLabelText(/emirate — a 1/i), 'دبي')
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(99, 5, expect.objectContaining({ plate_emirate: 'دبي' })),
    )
  })

  it('hides Print button when book_id is absent', async () => {
    renderDetail({ book_id: null, book_ref: null })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /print permit/i })).not.toBeInTheDocument()
  })

  it('calls getBook on Print click and opens the PDF URL', async () => {
    vi.spyOn(api, 'getBook').mockResolvedValue({
      id: 7,
      versions: [
        {
          id: 1,
          version_no: 1,
          pdf_url: '/api/v1/documents/42/download?format=pdf',
          manager_sig_embedded: false,
          status: 'none',
        },
      ],
    } as never)

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderDetail({ book_id: 7, book_ref: '1/5/GSSG/0042' })
    await waitFor(() => expect(screen.getByText('1/5/GSSG/0042')).toBeInTheDocument())

    screen.getByRole('button', { name: /print permit/i }).click()

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(
      '/api/v1/documents/42/download?format=pdf',
      '_blank',
      'noopener',
    ))

    openSpy.mockRestore()
  })

  it('draft letter shows Draft badge and Send for approval; clicking submits', async () => {
    const submitSpy = vi
      .spyOn(api, 'submitPermitApproval')
      .mockResolvedValue({ ...basePermit, book_id: 7, approval_state: 'pending' } as never)

    renderDetail({ book_id: 7, book_ref: '1/5/GSSG/0042', approval_state: 'none' })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    expect(screen.getByText('Draft')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /send for approval/i }))
    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith(99))
  })

  it('pending letter shows the Pending badge and hides the send button', async () => {
    renderDetail({ book_id: 7, book_ref: '1/5/GSSG/0042', approval_state: 'pending' })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    expect(screen.getByText('Pending approval')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send for approval/i })).not.toBeInTheDocument()
  })

  it('rejected letter offers to re-send', async () => {
    renderDetail({ book_id: 7, book_ref: '1/5/GSSG/0042', approval_state: 'rejected' })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send for approval/i })).toBeInTheDocument()
  })

  it('revoked permit hides the send button even while draft', async () => {
    renderDetail({
      book_id: 7,
      book_ref: '1/5/GSSG/0042',
      approval_state: 'none',
      status: 'revoked',
      derived_status: 'revoked',
    })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /send for approval/i })).not.toBeInTheDocument()
  })
})
  it('renders start date and validity period without exposing the end date', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    const validityFact = screen.getByText('Starts 06 Aug 2026').closest('dd')
    expect(validityFact).toHaveTextContent('Starts 06 Aug 2026')
    expect(validityFact).toHaveTextContent('Permit time: 1 month')
    expect(screen.getByText('Permit time: 1 month')).toBeInTheDocument()
    expect(screen.queryByText('06 Sep 2026')).not.toBeInTheDocument()
    expect(screen.queryByText('2026-09-06')).not.toBeInTheDocument()
  })

  it('pluralizes a six-month detail period in English', async () => {
    renderDetail({ validity: { value: 6, unit: 'month' } })
    await waitFor(() => expect(screen.getByText('Permit time: 6 months')).toBeInTheDocument())
  })

  it('renders Arabic detail period and localized date direction', async () => {
    await i18n.changeLanguage('ar')
    try {
      renderDetail({ validity: { value: 6, unit: 'month' } })
      await waitFor(() => expect(screen.getByText(/مدة التصريح: 6 أشهر/)).toBeInTheDocument())
      expect(document.documentElement.dir).toBe('rtl')
      expect(screen.getByText(/يبدأ في/)).toBeInTheDocument()
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('renders Arabic one- and two-month detail periods', async () => {
    await i18n.changeLanguage('ar')
    try {
      const oneMonth = renderDetail({ validity: { value: 1, unit: 'month' } })
      await waitFor(() => expect(screen.getByText(/مدة التصريح: شهر واحد/)).toBeInTheDocument())
      oneMonth.unmount()

      const twoMonths = renderDetail({ validity: { value: 2, unit: 'month' } })
      await waitFor(() => expect(screen.getByText(/مدة التصريح: شهران/)).toBeInTheDocument())
      twoMonths.unmount()
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('requires a job role and sends it when adding a person, then resets the form', async () => {
    const addSpy = vi.spyOn(api, 'addPermitPerson').mockResolvedValue({ ...basePermit } as never)
    renderDetail()
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    const addButton = screen.getByRole('button', { name: /add person/i })
    expect(addButton).toBeDisabled()
    await userEvent.type(screen.getByPlaceholderText('Full name'), '  Jane Doe  ')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), ' 784-123 ')
    expect(addButton).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Job / trade'), '  Electrician  ')
    expect(addButton).toBeEnabled()
    await userEvent.click(addButton)

    await waitFor(() => expect(addSpy).toHaveBeenCalledWith(99, {
      name: 'Jane Doe',
      uae_id: '784-123',
      nationality: null,
      role: 'Electrician',
    }))
    expect(screen.getByPlaceholderText('Full name')).toHaveValue('')
    expect(screen.getByPlaceholderText('UAE ID')).toHaveValue('')
    expect(screen.getByLabelText('Job / trade')).toHaveValue('')
  })

  it('renews with a duration validity payload and exposes the approved presets', async () => {
    const renewSpy = vi.spyOn(api, 'renewPermit').mockResolvedValue({ ...basePermit } as never)
    renderDetail()
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /^renew$/i }))
    const validityNames = ['1 day', '1 week', '1 month', '6 months', '1 year', 'Custom period']
    expect(screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed')).map((button) => button.textContent?.trim())).toEqual(validityNames)
    expect(screen.queryByLabelText(/new end date/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /custom period/i }))
    await userEvent.clear(screen.getByLabelText('Duration'))
    await userEvent.type(screen.getByLabelText('Duration'), '2')
    await userEvent.type(screen.getByLabelText(/reason/i), 'Extended works')
    await userEvent.click(screen.getAllByRole('button', { name: /^renew$/i })[0])

    await waitFor(() => expect(renewSpy).toHaveBeenCalledWith(99, {
      validity: { value: 2, unit: 'month' },
      reason: 'Extended works',
    }))
  })
