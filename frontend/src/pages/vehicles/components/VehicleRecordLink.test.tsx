import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/lib/authContext'
import type { SessionUser } from '@/lib/api'
import { VehicleRecordLink } from './VehicleRecordLink'

const state = vi.hoisted(() => ({ getBook: vi.fn(), canView: true }))
vi.mock('@/lib/api', () => ({ api: { getBook: state.getBook } }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => state.canView }) }))

function renderLink(scopedRole: SessionUser['scoped_role'] = 'fleet_reporter', client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const user: SessionUser = {
    id: 7, email: 'fleet@example.test', employee_id: 'G7', name_en: 'Fleet reporter', name_ar: null,
    position: null, department: null, photo_url: null, role: scopedRole ?? 'operator', scoped_role: scopedRole,
    status: 'active', is_admin: false, is_manager: false, has_signature: true, idle_lock_seconds: 300, lock_layout: 'default',
  }
  const auth: AuthContextValue = {
    user, status: 'authed', login: async () => user, logout: async () => undefined,
    refetch: async () => undefined, setUser: () => undefined,
  }
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter><VehicleRecordLink bookId={51}>11/1/GSSG/51</VehicleRecordLink></MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('fleet record links', () => {
  beforeEach(() => { vi.clearAllMocks(); state.canView = true })

  it('shows the reference as text while visibility resolves, then links a visible book', async () => {
    state.getBook.mockResolvedValue({ id: 51 })
    renderLink()
    expect(screen.getByText('11/1/GSSG/51')).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(await screen.findByRole('link')).toHaveAttribute('href', '/books/51')
  })

  it.each([403, 404])('keeps an inaccessible book reference as text after %s without retries', async (status) => {
    state.getBook.mockRejectedValue(Object.assign(new Error('Not visible'), { status }))
    renderLink()
    await waitFor(() => expect(state.getBook).toHaveBeenCalledWith(51))
    expect(screen.getByText('11/1/GSSG/51')).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(state.getBook).toHaveBeenCalledTimes(1)
  })

  it('does not probe a book when the scoped user lacks books.view', () => {
    state.canView = false
    renderLink()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(state.getBook).not.toHaveBeenCalled()
  })

  it('keeps non-scoped links unchanged without extra requests', () => {
    renderLink(null)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/books/51')
    expect(state.getBook).not.toHaveBeenCalled()
  })
})
