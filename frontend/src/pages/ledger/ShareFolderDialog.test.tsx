import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import { api, type BookFolderRead } from '@/lib/api'
import { BookFolderHeader } from './BookFolderHeader'

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { department_scoping_enabled: false } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const folder: BookFolderRead = {
  id: 9, name: 'Team correspondence', team: true, can_manage: true,
  legacy_departments: [], created_by_name: null, created_by_name_ar: null,
  everyone: false, count: 0, shared_users: [], shared_departments: [],
}

function mount(value = folder) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><BookFolderHeader folder={value} /></QueryClientProvider>)
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
  vi.spyOn(api.departments, 'list').mockResolvedValue([])
  vi.spyOn(api, 'getBookFolderShareOptions').mockResolvedValue({
    users: [], departments: [], legacy_departments: ['Operations'],
  })
  vi.spyOn(api, 'updateBookFolderShares').mockResolvedValue(folder)
})

it('offers main\'s free-text department audiences when no active departments exist', async () => {
  mount()
  await userEvent.click(screen.getByRole('button', { name: 'Share' }))
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Operations' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.updateBookFolderShares).toHaveBeenCalledWith(9, {
    everyone: false, user_ids: [], department_ids: [], legacy_departments: ['Operations'],
  }))
})

it('localizes retained text department labels in the header and share editor', async () => {
  vi.mocked(api.departments.list).mockResolvedValue([{ id: 5, name_en: 'Finance', name_ar: 'المالية', active: true }] as never)
  vi.mocked(api.getBookFolderShareOptions).mockResolvedValue({
    users: [], departments: [{ id: 5, name_en: 'Finance', name_ar: 'المالية' }], legacy_departments: [],
  })
  mount({ ...folder, legacy_departments: ['Operations'] })
  expect(await screen.findByText(/Operations.*\(previous department name\)/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Share' }))
  expect(await screen.findByRole('button', { name: 'Remove previous department name: Operations' })).toBeInTheDocument()
})

it('keeps retained text audiences visible and removable when no employee uses that label anymore', async () => {
  mount({ ...folder, legacy_departments: ['Historical team'] })
  await userEvent.click(screen.getByRole('button', { name: 'Share' }))
  const historical = await screen.findByRole('checkbox', { name: 'Historical team' })
  expect(historical).toBeChecked()
  await userEvent.click(historical)
  await userEvent.click(screen.getByRole('checkbox', { name: 'Operations' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.updateBookFolderShares).toHaveBeenCalledWith(9, {
    everyone: false, user_ids: [], department_ids: [], legacy_departments: ['Operations'],
  }))
})
