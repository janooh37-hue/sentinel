import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'

import { statusTone, zoneTone, fmtDate } from './permitUtils'
import { PermitsPage } from './PermitsPage'

const mobileState = vi.hoisted(() => ({ value: false }))
// What the mocked form reports as just issued (a full PermitRead, as the real form returns).
const createdPermit = vi.hoisted(() => ({
  id: 9, permit_no: 'PMT-0009', company: 'Brand New Co', zones: ['green'], access_areas: null,
  start_date: '2026-07-01', validity: { value: 1, unit: 'month' }, end_date: '2026-07-30', status: 'active',
  created_at: '2026-07-01T00:00:00', derived_status: 'active', duration_days: 30, days_remaining: 9,
  people_count: 1, vehicle_count: 0, book_id: null, document_name: null, people: [], vehicles: [],
}))

vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => mobileState.value }))
vi.mock('@/pages/application/DocPdfCanvas', () => ({ default: () => <div data-testid="pdf" /> }))
// The real form is covered by PermitFormDialog.test.tsx; here it just reports a created permit.
vi.mock('./PermitFormDialog', () => ({
  PermitFormDialog: ({
    open,
    onOpenChange,
    onSaved,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSaved: (p: typeof createdPermit) => void
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onSaved(createdPermit)
          onOpenChange(false)
        }}
      >
        Mock issue
      </button>
    ) : null,
}))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set(['permits.view', 'permits.create', 'permits.edit', 'permits.revoke', 'permits.delete']),
    isLoading: false,
    has: () => true,
  }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getPermit: vi.fn().mockImplementation(async (id: number) => ({
        id, permit_no: `PMT-${String(id).padStart(4, '0')}`, company: 'Acme Contracting',
        zones: ['green'], access_areas: null, start_date: '2026-07-01',
        validity: { value: 1, unit: 'month' }, end_date: '2026-07-30', status: 'active',
        created_at: '2026-07-01T00:00:00', derived_status: 'active', duration_days: 30,
        days_remaining: 9, people_count: 0, vehicle_count: 0, people: [], vehicles: [],
      })),
      getBook: vi.fn().mockResolvedValue({
        id: 7,
        versions: [{ id: 1, version_no: 1, document_id: 11, signed_pdf_url: null }],
      }),
      permitsSummary: vi.fn().mockResolvedValue({
        active: 3, expiring: 1, expired: 0, revoked: 0,
        people_active: 7, people_green: 5, people_red: 4, people_work_residence: 2,
      }),
      listPermits: vi.fn().mockResolvedValue({
        items: [
          {
            id: 1, permit_no: 'PMT-0001', company: 'Acme Contracting', zones: ['green', 'red'],
            access_areas: { al_wathba_1: ['green'], al_wathba_2: ['red'], work_residence: false },
            start_date: '2026-07-01', validity: { value: 1, unit: 'month' }, end_date: '2026-07-30', status: 'active',
            created_at: '2026-07-01T00:00:00', derived_status: 'active',
            duration_days: 30, days_remaining: 9, people_count: 4, vehicle_count: 2,
            has_document: true, book_id: 7,
          },
          {
            id: 2, permit_no: 'PMT-0002', company: 'Descon Engineering', zones: ['green', 'work_residence'],
            access_areas: null,
            start_date: '2026-07-21', validity: { value: 2, unit: 'month' }, end_date: '2026-08-21', status: 'active',
            created_at: '2026-07-21T00:00:00', derived_status: 'active',
            duration_days: 32, days_remaining: 31, people_count: 5, vehicle_count: 3,
            has_document: false,
          },
          {
            id: 3, permit_no: 'PMT-0003', company: 'Falcon Works', zones: ['red'],
            access_areas: { al_wathba_1: [], al_wathba_2: ['red'], work_residence: false },
            start_date: '2026-07-22', validity: { value: 6, unit: 'month' }, end_date: '2026-08-22', status: 'active',
            created_at: '2026-07-22T00:00:00', derived_status: 'active',
            duration_days: 31, days_remaining: 32, people_count: 2, vehicle_count: 1,
            has_document: false,
          },
        ],
        total: 3, limit: 500, offset: 0,
      }),
      listPermitsDetailed: vi.fn().mockResolvedValue([
        {
          id: 1, permit_no: 'PMT-0001', company: 'Acme Contracting', zones: ['green', 'red'],
          access_areas: { al_wathba_1: ['green'], al_wathba_2: ['red'], work_residence: false },
          start_date: '2026-07-01', validity: { value: 6, unit: 'month' }, end_date: '2026-07-30', status: 'active',
          created_at: '2026-07-01T00:00:00', derived_status: 'active',
          duration_days: 30, days_remaining: 9, people_count: 0, vehicle_count: 0,
          people: [], vehicles: [],
        },
        {
          id: 2, permit_no: 'PMT-0002', company: 'Descon Engineering', zones: ['green', 'work_residence'],
          access_areas: null,
          start_date: '2026-07-21', validity: { value: 2, unit: 'month' }, end_date: '2026-08-21', status: 'active',
          created_at: '2026-07-21T00:00:00', derived_status: 'active',
          duration_days: 32, days_remaining: 31, people_count: 0, vehicle_count: 0,
          people: [], vehicles: [],
        },
        {
          id: 3, permit_no: 'PMT-0003', company: 'Falcon Works', zones: ['red'],
          access_areas: { al_wathba_1: [], al_wathba_2: ['red'], work_residence: false },
          start_date: '2026-07-22', validity: { value: 1, unit: 'month' }, end_date: '2026-08-22', status: 'active',
          created_at: '2026-07-22T00:00:00', derived_status: 'active',
          duration_days: 31, days_remaining: 32, people_count: 0, vehicle_count: 0,
          people: [], vehicles: [],
        },
      ]),
    },
  }
})

beforeEach(() => {
  mobileState.value = false
})

function renderPage(initialEntries = ['/permits']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <PermitsPage />
        <NavigationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function NavigationProbe(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="location">{location.pathname + location.search}</output>
      <button data-testid="back" type="button" onClick={() => navigate(-1)}>Back</button>
    </>
  )
}

describe('permitUtils', () => {
  it('maps derived status to a badge tone', () => {
    expect(statusTone('active')).toBe('active')
    expect(statusTone('expiring')).toBe('warning')
    expect(statusTone('expired')).toBe('danger')
    expect(statusTone('revoked')).toBe('neutral')
  })
  it('maps zone to a badge tone', () => {
    expect(zoneTone('green')).toBe('active')
    expect(zoneTone('red')).toBe('danger')
    expect(zoneTone('work_residence')).toBe('info')
  })
  it('formats a timestamp down to the date', () => {
    expect(fmtDate('2026-07-30T12:00:00')).toBe('2026-07-30')
    expect(fmtDate(null)).toBe('—')
  })
})

describe('PermitsPage', () => {
  it('renders the register with a permit row and summary tiles', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /security permits/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Acme Contracting')).toBeInTheDocument())
    expect(screen.getByText('PMT-0001')).toBeInTheDocument()
    // Manager sees the "New permit" action.
    expect(screen.getByRole('button', { name: /new permit/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /access areas/i })).toBeInTheDocument()
  })

  it('renders exact structured pairings and honest legacy location labels', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Contracting')).toBeInTheDocument())
    expect(screen.getAllByText(/W1 · Green/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/W2 · Red/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Unspecified · Green/i).length).toBeGreaterThan(0)
  })

  it('renders multi-zone chips (incl. work residence) and a clip for attached papers', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Descon Engineering')).toBeInTheDocument())
    // A permit's zones render as separate chips — here Green + Work res.
    expect(screen.getAllByText('Work res.').length).toBeGreaterThan(0)
    // The permit with an attached scan surfaces a paperclip affordance.
    expect(screen.getByLabelText(/permit paper attached/i)).toBeInTheDocument()
    // Vehicles column is present with its header.
    expect(screen.getByRole('columnheader', { name: /vehicles/i })).toBeInTheDocument()
  })

  it('exposes a keyboard-reachable View action per row', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Contracting')).toBeInTheDocument())
    // Row click is mouse-only; the explicit View button is what keyboard/SR
    // users reach — one per row.
    expect(screen.getAllByRole('button', { name: /^view$/i })).toHaveLength(3)
  })

  it('selecting a row switches Print to the selected-count label', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Contracting')).toBeInTheDocument())
    const rowCheckbox = screen.getByLabelText(/select permit PMT-0001/i)
    rowCheckbox.click()
    expect(screen.getByRole('button', { name: /print 1/i })).toBeInTheDocument()
  })
  it('renders start and validity from server fields while retaining server status text', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Contracting')).toBeInTheDocument())
    expect(screen.getByText('6 months from 22 Jul 2026')).toBeInTheDocument()
    expect(screen.getByText(/9 days left/)).toBeInTheDocument()
    expect(screen.queryByText(/2026-07-30/)).not.toBeInTheDocument()
  })

  it('prints start and validity without printing the visible end date', async () => {
    let printed = ''
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      printed = document.body.textContent ?? ''
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Contracting')).toBeInTheDocument())
    await screen.getByRole('button', { name: /^print$/i }).click()
    await waitFor(() => expect(printSpy).toHaveBeenCalled())
    expect(printed).toContain('6 months from 01 Jul 2026')
    expect(printed).not.toContain('2026-07-30')
    printSpy.mockRestore()
  })

  it('renders Arabic whole periods, localized dates, and RTL direction', async () => {
    await i18n.changeLanguage('ar')
    try {
      renderPage()
      await waitFor(() => expect(screen.getByText('Acme Contracting')).toBeInTheDocument())
      expect(screen.getAllByText(/شهر واحد من/).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/شهران من/).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/6 أشهر من/).length).toBeGreaterThan(0)
      expect(screen.queryByText(/month from/i)).not.toBeInTheDocument()
    } finally {
      await i18n.changeLanguage('en')
    }
  })
  it('opens a directly linked permit and Close stays on the permits list', async () => {
    renderPage(['/permits?open=1'])
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByText('Acme Contracting')).toBeInTheDocument()
    await screen.getByRole('button', { name: /close/i }).click()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/permits$/))
  })

  it('Back from the full detail returns to the quick view, then to the list with filters intact', async () => {
    const user = userEvent.setup()
    renderPage(['/permits', '/permits?state=active&zone=green&q=acme'])
    await screen.findByText('Acme Contracting')
    await user.click(screen.getAllByRole('button', { name: /^view$/i })[0])
    expect(await screen.findByRole('dialog', { name: /PMT-0001/ })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('preview=1')
    await user.click(screen.getByRole('button', { name: /open full details/i }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('open=1'))
    expect(screen.getByTestId('location')).not.toHaveTextContent('preview=')
    fireEvent.click(screen.getByTestId('back')) // a modal blocks real pointer events on the probe
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('preview=1'))
    expect(await screen.findByRole('dialog', { name: /PMT-0001/ })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('back'))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/permits\?state=active&zone=green&q=acme$/),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('a deep-linked preview of a permit the list does not contain opens the full detail instead', async () => {
    renderPage(['/permits?preview=99'])
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/permits\?open=99$/))
  })

  it('status tiles are aria-pressed toggles bound to ?state=', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Acme Contracting')
    expect(screen.getByText('3 permits')).toBeInTheDocument()
    const group = screen.getByRole('group', { name: /filter permits by status/i })
    const tile = within(group).getByRole('button', { name: /expired/i })
    expect(tile).toHaveAttribute('aria-pressed', 'false')
    await user.click(tile)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/permits?state=expired'))
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    await user.click(tile)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/permits$/))
    expect(tile).toHaveAttribute('aria-pressed', 'false')
  })

  it('zone tiles bind to ?zone=', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Acme Contracting')
    const group = screen.getByRole('group', { name: /filter permits by zone/i })
    await user.click(within(group).getByRole('button', { name: /work residence/i }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('zone=work_residence'))
  })

  it('Clear filters removes state, zone and q but keeps other params', async () => {
    const user = userEvent.setup()
    renderPage(['/permits?tab=security&state=expired&zone=red&q=acme'])
    await screen.findByText('Acme Contracting')
    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/permits\?tab=security$/))
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
  })

  it('renders tappable cards instead of the table on mobile', async () => {
    mobileState.value = true
    const user = userEvent.setup()
    renderPage()
    const card = await screen.findByRole('button', { name: /PMT-0001/ })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/select permit/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('Acme Contracting')).toHaveLength(1)
    await user.click(card)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('preview=1'))
    expect(await screen.findByRole('dialog', { name: /PMT-0001/ })).toBeInTheDocument()
  })

  it('after issuing a permit, lands on its preview with the filters cleared, before the list has it', async () => {
    const user = userEvent.setup()
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 1)
    try {
      // The list mock never includes PMT-0009: the preview must come from the record the form returned.
      renderPage(['/permits?state=active&q=acme'])
      await screen.findByText('Acme Contracting')
      await user.click(screen.getByRole('button', { name: /new permit/i }))
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('action=new'))
      await user.click(screen.getByRole('button', { name: 'Mock issue' }))
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/permits\?preview=9$/))
      expect(await screen.findByRole('dialog', { name: /PMT-0009/ }, { timeout: 3000 })).toBeInTheDocument()
      expect(screen.getByText('Brand New Co')).toBeInTheDocument()
      // Not bounced to the full dialog as a "missing" permit.
      expect(screen.getByTestId('location')).not.toHaveTextContent('open=')
      expect(success).toHaveBeenCalledWith('Permit PMT-0009 issued')
    } finally {
      success.mockRestore()
    }
  })
})

  it('prints Arabic one-, two-, and six-month periods', async () => {
    await i18n.changeLanguage('ar')
    let printed = ''
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      printed = document.body.textContent ?? ''
    })
    try {
      renderPage()
      await waitFor(() => expect(screen.getByText('Acme Contracting')).toBeInTheDocument())
      await screen.getByRole('button', { name: /طباعة/ }).click()
      await waitFor(() => expect(printSpy).toHaveBeenCalled())
      expect(printed).toMatch(/6 أشهر من/)
      expect(printed).toMatch(/شهران من/)
      expect(printed).toMatch(/شهر واحد من/)
    } finally {
      printSpy.mockRestore()
      await i18n.changeLanguage('en')
    }
  })
