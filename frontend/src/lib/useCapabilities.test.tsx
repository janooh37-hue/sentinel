import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'

vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ status: 'authed' }) }))

function Consumer() {
  const { has } = useCapabilities()
  return has('messages.templates') ? <button>Edit wording</button> : <p>Read only</p>
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><Consumer /></QueryClientProvider>)
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('capability changes in a signed-in session', () => {
  it('removes an edit affordance on focus after the server revokes access', async () => {
    let allowed = true
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(allowed ? ['messages.templates'] : []))))
    mount()
    expect(await screen.findByRole('button', { name: 'Edit wording' })).toBeInTheDocument()
    allowed = false
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit wording' })).not.toBeInTheDocument())
    expect(screen.getByText('Read only')).toBeInTheDocument()
  })

  it('refreshes stale capabilities after a denied write while preserving the authoritative error', async () => {
    let allowed = true
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH') {
        allowed = false
        return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not allowed' } }), { status: 403 })
      }
      return new Response(JSON.stringify(allowed ? ['messages.templates'] : []))
    }))
    mount()
    expect(await screen.findByRole('button', { name: 'Edit wording' })).toBeInTheDocument()
    await act(async () => {
      await expect(api.updateEditorTemplate(1, { name: 'Changed' })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit wording' })).not.toBeInTheDocument())
    expect(screen.getByText('Read only')).toBeInTheDocument()
  })
})
