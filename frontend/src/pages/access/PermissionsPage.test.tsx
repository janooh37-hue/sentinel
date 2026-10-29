import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUserRead } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { listAuthUsers: vi.fn(), listPermissionRequests: vi.fn() }, apiErrorMessage: () => 'Unavailable' }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1 }, status: 'authed' }) }))
vi.mock('@/lib/permissionStudioApi', () => ({ accessSnapshotKey: (operator: number, id: number) => ['permission-studio', operator, id] }))
import { api } from '@/lib/api'
import i18n from '@/lib/i18n'
import { PermissionsPage } from './PermissionsPage'

function account(id: number, extra: Partial<AdminUserRead> = {}): AdminUserRead {
  return { id, email: `person${id}@example.test`, employee_id: `G${id}`, display_name: `Person ${id}`, name_en: `Person ${id}`, role: 'operator', status: 'active', failed_attempts: 0, is_default_manager: false, password_change_required: false, last_login_at: null, created_at: null, ...extra }
}
function Location() { return <output aria-label="Current URL">{useLocation().search}</output> }
function mount(users: AdminUserRead[], url = '/permissions') {
  vi.mocked(api.listAuthUsers).mockResolvedValue(users)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><PermissionsPage /><Location /></MemoryRouter></QueryClientProvider>)
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.listPermissionRequests).mockResolvedValue([])
})
describe('Accounts register', () => {
  it('does not select an account automatically and includes all lifecycle states', async () => {
    mount([account(1, { role: 'admin' }), account(2), account(3, { status: 'disabled' }), account(4, { status: 'locked' }), account(5, { status: 'pending' })])
    expect(await screen.findByText('person3@example.test')).toBeVisible()
    expect(screen.getByText('person4@example.test')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Review account' })).toHaveAttribute('href', '/access-requests?user=5')
    expect(screen.queryByRole('region', { name: 'Access workspace' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('')
  })
  it('searches all returned users before paginating 25 rows', async () => {
    mount(Array.from({ length: 200 }, (_, index) => account(index + 10)))
    await screen.findByText('person10@example.test')
    expect(screen.queryByText('person209@example.test')).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(26)
    await userEvent.type(screen.getByRole('searchbox'), 'G209')
    expect(await screen.findByText('person209@example.test')).toBeVisible()
    expect(screen.queryByText('person10@example.test')).not.toBeInTheDocument()
  })
  it('merges account navigation with org-owned URL state and restores filter and focus', async () => {
    mount([account(2), account(3)], '/permissions?tab=people&q=org-query&dept=7&psFilter=attention')
    await screen.findByText('person2@example.test')
    await userEvent.type(screen.getByRole('searchbox'), 'G2')
    await userEvent.click(screen.getByRole('button', { name: 'Edit access' }))
    expect(screen.getByLabelText('Current URL').textContent).toContain('q=org-query')
    expect(screen.getByLabelText('Current URL').textContent).toContain('user=2')
    await userEvent.click(screen.getByRole('button', { name: 'Back to accounts' }))
    expect(screen.getByRole('searchbox')).toHaveValue('G2')
    expect(screen.getByLabelText('Current URL').textContent).toContain('dept=7')
    expect(screen.getByLabelText('Current URL').textContent).not.toContain('psFilter')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit access' })).toHaveFocus())
  })
  it('filters roles and statuses without excluding disabled accounts from search', async () => {
    mount([account(2), account(3, { status: 'disabled', role: 'manager' })])
    await screen.findByText('person3@example.test')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'disabled')
    expect(screen.queryByText('person2@example.test')).not.toBeInTheDocument()
    expect(screen.getByText('person3@example.test')).toBeVisible()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'operator')
    expect(screen.getByText('No matching accounts. Clear the search or filters.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    expect(screen.getByText('person2@example.test')).toBeVisible()
  })
  it('matches the supplied Arabic identity in an English register', async () => {
    const bilingual = { ...account(2), name_ar: 'أحمد علي' }
    mount([bilingual, account(3)])
    await screen.findByText('person2@example.test')
    await userEvent.type(screen.getByRole('searchbox'), 'احمد')
    expect(screen.getByText('person2@example.test')).toBeVisible()
    expect(screen.queryByText('person3@example.test')).not.toBeInTheDocument()
  })
  it.each([
    [account(2, { role: 'admin' }), 'Administrator access is locked.'],
    [account(1), 'You cannot change your own access.'],
  ])('does not mount an editor for a protected target', async (target, notice) => {
    mount([target], `/permissions?user=${target.id}`)
    expect(await screen.findByText(notice)).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Access workspace' })).not.toBeInTheDocument()
  })
  it('keeps a disabled target identifiable and marks configured access unusable', async () => {
    mount([account(2, { status: 'disabled' })], '/permissions?user=2')
    expect(await screen.findByText('Configured access is read-only and cannot be used until the account is activated.')).toBeVisible()
    expect(screen.getByText('person2@example.test')).toBeVisible()
  })
  it('does not substitute another person for a stale account URL', async () => {
    mount([account(2)], '/permissions?user=999')
    expect(await screen.findByText('This account is unavailable.')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Access workspace' })).not.toBeInTheDocument()
  })
})
