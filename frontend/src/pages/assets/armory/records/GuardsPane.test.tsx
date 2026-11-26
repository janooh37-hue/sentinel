import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ArmoryGuardPage } from '@/lib/api'
import { ARMORY_EDIT_CAP, ARMORY_VIEW_CAP } from '@/lib/armory'
import i18n from '@/lib/i18n'

import { testCandidate, testEmployee, testFormerGuard, testGuard } from './guardsFixtures'
import { GuardsPane } from './GuardsPane'

const access = vi.hoisted(() => ({ view: true, edit: false }))
vi.mock(import('@/lib/api'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, api: { ...actual.api, listArmoryGuards: vi.fn(), getArmoryGuard: vi.fn(), listArmoryPeople: vi.fn(), saveArmoryQualification: vi.fn() } }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ isLoading: false, has: (cap: string) => cap === ARMORY_VIEW_CAP ? access.view : cap === ARMORY_EDIT_CAP && access.edit }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ status: 'authed', user: { id: 21 } }) }))

const firstPage: ArmoryGuardPage = {
  items: [testGuard, testEmployee], page: 1, page_size: 2, total: 7,
  filter_counts: { valid: 3, missing: 1, expired: 2, expiring: 1 },
}

function CurrentLocation() {
  const { search } = useLocation()
  return <output aria-label="Current URL query">{search}</output>
}

function mount({ qualificationEmployeeId = null, url = '/holdings/armory?tab=guards&safe=5' }: { qualificationEmployeeId?: string | null; url?: string } = {}) {
  const onQualificationDone = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[url]}>
          <GuardsPane safeId={5} qualificationEmployeeId={qualificationEmployeeId} onQualificationDone={onQualificationDone} />
          <CurrentLocation />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { onQualificationDone }
}

beforeEach(async () => {
  vi.resetAllMocks()
  access.view = true
  access.edit = false
  await i18n.changeLanguage('en')
  vi.mocked(api.listArmoryGuards).mockResolvedValue(firstPage)
  vi.mocked(api.getArmoryGuard).mockResolvedValue({ data: testGuard, etag: '"3"' })
  vi.mocked(api.saveArmoryQualification).mockResolvedValue({ data: testGuard, etag: '"4"' })
  vi.mocked(api.listArmoryPeople).mockResolvedValue([])
})

describe('GuardsPane', () => {
  it('lets viewers see qualifications and server filter counts, but no editor controls', async () => {
    mount({ qualificationEmployeeId: 'T-0001' })

    expect(await screen.findByRole('link', { name: /Test Guard One/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Valid/ })).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: /^Licence missing/ })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /^Expired/ })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: /^Expiring/ })).toHaveTextContent('1')
    expect(screen.queryByRole('button', { name: /Add guard|Add licence|Update licence/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.getArmoryGuard).not.toHaveBeenCalled()
    expect(api.listArmoryPeople).not.toHaveBeenCalled()
  })

  it('does not request data for an edit-only user, even with a guard deep link', () => {
    access.view = false
    access.edit = true
    mount({ url: '/holdings/armory?tab=guards&guard=T-0001', qualificationEmployeeId: 'T-0001' })

    expect(screen.getByRole('alert')).toHaveTextContent(/permission/)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.listArmoryGuards).not.toHaveBeenCalled()
    expect(api.getArmoryGuard).not.toHaveBeenCalled()
  })

  it('lets editors filter by licence and shows former holders separately without edit actions', async () => {
    access.edit = true
    const user = userEvent.setup()
    vi.mocked(api.listArmoryGuards).mockImplementation(async ({ include_former } = {}) => include_former
      ? { ...firstPage, items: [testGuard, testFormerGuard], total: 2 }
      : firstPage,
    )
    mount()

    expect(await screen.findByRole('button', { name: 'Update licence: Test Guard One' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add licence: Test Employee Two' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add guard' })).toBeVisible()
    expect(screen.queryByRole('rowgroup', { name: 'Former guards' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Expiring/ }))
    await waitFor(() => expect(api.listArmoryGuards).toHaveBeenLastCalledWith(expect.objectContaining({ licence_status: 'expiring', page: 1 })))
    expect(screen.getByRole('button', { name: /^Expiring/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('checkbox', { name: 'Show former guards' }))

    const former = await screen.findByRole('rowgroup', { name: 'Former guards' })
    expect(api.listArmoryGuards).toHaveBeenLastCalledWith(expect.objectContaining({ licence_status: 'expiring', include_former: true }))
    expect(within(former).getByRole('link', { name: /Test Former Guard/ })).toBeVisible()
    expect(within(former).getByText('Resigned')).toBeVisible()
    expect(within(former).getByText('Open custody on clearance')).toBeVisible()
    expect(within(former).getByRole('link', { name: /TEST-CUSTODY-A/ })).toHaveAttribute('href', '/holdings/armory?tab=custody&custody=17')
    expect(within(former).getByRole('link', { name: /TEST-SHIFT-A/ })).toHaveAttribute('href', '/holdings/armory?tab=shift&issue=18')
    expect(within(former).queryByRole('button')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(screen.queryByRole('rowgroup', { name: 'Former guards' })).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Show former guards' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('paginates and resets to the first page when searching by employee ID', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listArmoryGuards).mockImplementation(async ({ page, q } = {}) => q
      ? { ...firstPage, items: [testGuard], total: 1 }
      : { ...firstPage, page: page ?? 1 },
    )
    mount()

    await user.click(await screen.findByRole('button', { name: 'Next' }))
    await waitFor(() => expect(api.listArmoryGuards).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
    const search = screen.getByRole('searchbox', { name: 'Search by name or G-number' })
    fireEvent.change(search, { target: { value: 'T-0001' } })
    await waitFor(() => expect(api.listArmoryGuards).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'T-0001', page: 1 })))
    await user.click(screen.getByRole('button', { name: 'Clear search filter' }))

    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
  })

  it('opens viewer detail with the guard URL key and restores focus on back', async () => {
    const user = userEvent.setup()
    mount()
    const link = await screen.findByRole('link', { name: /Test Guard One/ })
    await user.click(link)

    expect(await screen.findByRole('heading', { name: 'Test Guard One' })).toBeVisible()
    expect(api.getArmoryGuard).toHaveBeenCalledWith('T-0001')
    expect(screen.getByLabelText('Current URL query')).toHaveTextContent('?tab=guards&safe=5&guard=T-0001')
    expect(screen.queryByRole('button', { name: /Update licence/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to the list' }))

    expect(screen.getByLabelText('Current URL query')).toHaveTextContent('?tab=guards&safe=5')
    expect(screen.getByLabelText('Current URL query')).not.toHaveTextContent('guard=')
    expect(link).toHaveFocus()
  })

  it('starts Add guard with a keyboard-selectable existing employee lookup', async () => {
    access.edit = true
    const user = userEvent.setup()
    vi.mocked(api.listArmoryPeople).mockImplementation(async ({ q }) => q === 'T-0002' ? [testCandidate] : [])
    vi.mocked(api.getArmoryGuard).mockResolvedValue({ data: testEmployee, etag: '"0"' })
    const { onQualificationDone } = mount()

    const opener = screen.getByRole('button', { name: 'Add guard' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Add guard' })
    const search = within(dialog).getByRole('searchbox', { name: 'Search by name or G-number' })
    expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(api.getArmoryGuard).not.toHaveBeenCalled()
    await user.type(search, 'T-0002')
    const match = await within(dialog).findByRole('button', { name: /Test Employee Two/ })
    expect(api.listArmoryPeople).toHaveBeenLastCalledWith({ purpose: 'qualification', q: 'T-0002' })
    await user.keyboard('{ArrowDown}')
    expect(match).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(await within(dialog).findByLabelText('Course round')).toHaveValue('')
    expect(api.getArmoryGuard).toHaveBeenCalledWith('T-0002')
    expect(api.saveArmoryQualification).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(opener).toHaveFocus())
    expect(onQualificationDone).not.toHaveBeenCalled()
  })

  it('opens and completes the suspended shell request exactly once on close', async () => {
    access.edit = true
    const user = userEvent.setup()
    const { onQualificationDone } = mount({ qualificationEmployeeId: 'T-0001' })
    const dialog = await screen.findByRole('dialog', { name: 'Update licence' })
    expect(within(dialog).getByLabelText('Course round')).toHaveValue('4')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(onQualificationDone).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.saveArmoryQualification).not.toHaveBeenCalled()
  })

  it('resumes the suspended shell request exactly once after saving', async () => {
    access.edit = true
    const user = userEvent.setup()
    const { onQualificationDone } = mount({ qualificationEmployeeId: 'T-0001' })
    const dialog = await screen.findByRole('dialog', { name: 'Update licence' })
    fireEvent.change(within(dialog).getByLabelText('Course round'), { target: { value: '5' } })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onQualificationDone).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Guard qualification saved.')).toBeVisible()
  })

  it('uses the Arabic name and isolates the identifier, licence and date', async () => {
    await i18n.changeLanguage('ar')
    mount()
    const row = await screen.findByRole('row', { name: /حارس الاختبار الأول/ })

    for (const text of ['T-0001', 'TEST-LICENCE-A', '28/05/2032']) {
      const value = within(row).getByText(text)
      expect(value.tagName).toBe('BDI')
      expect(value).toHaveAttribute('dir', 'ltr')
    }
  })
})
