import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminUserRead, EmployeeLookupItem, WorkforceScopeWrite } from '@/lib/api'
import i18n from '@/lib/i18n'
import { WorkforceScopeSection } from './WorkforceScopeSection'
import { toast } from '@/lib/toast'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const fetchMock = vi.fn<typeof fetch>()
const scopesUrl = '/api/v1/workforce/access/users/42/scopes'

function jsonResponse(body: unknown, etag?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(etag ? { ETag: etag } : {}) },
  })
}
const target: AdminUserRead = {
  id: 42,
  email: 'scope@example.com',
  employee_id: 'G100',
  display_name: 'Scope manager',
  name_en: 'Scope manager',
  role: 'operator',
  status: 'active',
  failed_attempts: 0,
  last_login_at: null,
  created_at: null,
  is_default_manager: false,
  password_change_required: false,
}

const roster: EmployeeLookupItem[] = [
  { id: 'G100', name_en: 'Omar Ali', name_ar: null, department: 'Operations', duty_unit: 'First unit', duty_post: 'Main gate' },
  { id: 'G200', name_en: 'Saeed Ahmed', name_ar: null, department: 'Administration', duty_unit: 'Second unit', duty_post: 'Reception' },
]

function mockScopes(initialScopes: WorkforceScopeWrite[] = [], locations = roster) {
  let body: unknown = { scopes: initialScopes }
  let etag = '"scope-1"'
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).startsWith('/api/v1/employees/lookup')) {
      const params = new URLSearchParams(String(url).split('?')[1])
      const offset = Number(params.get('offset') ?? 0)
      return jsonResponse({ items: locations.slice(offset, offset + 500), total: locations.length, limit: 500, offset })
    }
    if (init?.method === 'PUT') {
      body = JSON.parse(String(init.body))
      etag = '"scope-2"'
    }
    return jsonResponse(body, etag)
  })
}

function renderSection(capabilities = ['workforce.people.view'], user = target) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WorkforceScopeSection user={user} effective={new Set(capabilities)} />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  fetchMock.mockReset()
  mockScopes()
  vi.stubGlobal('fetch', fetchMock)
  await i18n.changeLanguage('en')
})
afterEach(() => vi.unstubAllGlobals())

describe('Attendance scope', () => {
  it('is absent and does not load scopes without the edited user’s people-view capability', () => {
    renderSection(['workforce.attendance.review'])
    expect(screen.queryByRole('heading', { name: 'Attendance scope' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is shown for a non-admin edited user with workforce.people.view', () => {
    renderSection()
    expect(screen.getByRole('heading', { name: 'Attendance scope' })).toBeInTheDocument()
    expect(screen.getByText('The user always sees their own record. With no entries, only their own record is visible.')).toBeInTheDocument()
  })

  it('is absent for admin targets with implicit organization scope', () => {
    renderSection(['workforce.people.view'], { ...target, role: 'admin' })
    expect(screen.queryByRole('heading', { name: 'Attendance scope' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('saves whole-organization scope with the ETag loaded from GET', async () => {
    const scopes = [{ scope_kind: 'organization', department: null, duty_unit: null, duty_post: null }]
    let saved = false
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).startsWith('/api/v1/employees/lookup')) {
        return jsonResponse({ items: [], total: 0, limit: 500, offset: 0 })
      }
      if (init?.method === 'PUT') saved = true
      return jsonResponse({
        scopes: saved ? scopes : [{ scope_kind: 'department', department: 'Operations', duty_unit: null, duty_post: null }],
      }, saved ? '"scope-2"' : '"scope-1"')
    })
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('radio', { name: 'Whole organization' }))
    await user.click(screen.getByRole('button', { name: 'Save scope' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      scopesUrl,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'If-Match': '"scope-1"' }),
        body: JSON.stringify({ scopes }),
      }),
    ))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save scope' })).toBeDisabled())
    expect(toast.success).toHaveBeenCalledWith('Attendance scope saved.')
  })

  it('adds a department once and saves only its department hierarchy with If-Match', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Scope type' }), 'department')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Department' }), 'Operations')
    await user.click(screen.getByRole('button', { name: 'Add scope' }))
    expect(screen.getByRole('button', { name: 'Add scope' })).toBeDisabled()
    expect(screen.getByText('This scope is already included.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save scope' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      scopesUrl,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'If-Match': '"scope-1"' }),
        body: JSON.stringify({
          scopes: [{ scope_kind: 'department', department: 'Operations', duty_unit: null, duty_post: null }],
        }),
      }),
    ))
  })

  it.each([
    { kind: 'duty_unit', withDepartment: false },
    { kind: 'duty_unit', withDepartment: true },
    { kind: 'duty_post', withDepartment: false },
    { kind: 'duty_post', withDepartment: true },
  ])('saves $kind with optional department=$withDepartment and its required parent levels', async ({ kind, withDepartment }) => {
    const existing: WorkforceScopeWrite = { scope_kind: 'department', department: 'Administration', duty_unit: null, duty_post: null }
    mockScopes([existing])
    const user = userEvent.setup()
    renderSection()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Scope type' }), kind)
    if (withDepartment) {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Department (optional)' }), 'Operations')
    }
    await user.selectOptions(screen.getByRole('combobox', { name: 'Duty unit' }), 'First unit')
    expect(screen.getByRole('option', { name: 'الدوام الرسمي' })).toBeInTheDocument()
    if (kind === 'duty_post') {
      expect(screen.getByRole('button', { name: 'Add scope' })).toBeDisabled()
      expect(screen.queryByRole('option', { name: 'Reception' })).not.toBeInTheDocument()
      await user.selectOptions(screen.getByRole('combobox', { name: 'Duty post' }), 'Main gate')
    }
    await user.click(screen.getByRole('button', { name: 'Add scope' }))
    await user.click(screen.getByRole('button', { name: 'Save scope' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(scopesUrl, expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ scopes: [existing, {
        scope_kind: kind,
        department: withDepartment ? 'Operations' : null,
        duty_unit: 'First unit',
        duty_post: kind === 'duty_post' ? 'Main gate' : null,
      }] }),
    })))
  })

  it('removes the final scope and saves self-only access as an empty list', async () => {
    mockScopes([{ scope_kind: 'department', department: 'Operations', duty_unit: null, duty_post: null }])
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: 'Remove Department · Operations' }))
    expect(screen.getByText('Self only')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save scope' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(scopesUrl, expect.objectContaining({
      method: 'PUT', body: '{"scopes":[]}',
    })))
  })

  it('loads every lookup page so later departments, units and posts remain selectable', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({ ...roster[0], id: `G${index + 1000}` }))
    mockScopes([], [...firstPage, roster[1]])
    const user = userEvent.setup()
    renderSection()
    const type = await screen.findByRole('combobox', { name: 'Scope type' })
    expect(screen.getByRole('option', { name: 'Administration' })).toBeInTheDocument()
    await user.selectOptions(type, 'duty_post')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Duty unit' }), 'Second unit')
    expect(screen.getByRole('option', { name: 'Reception' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/employees/lookup?limit=500&offset=500',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it.each([
    { status: 409, code: 'WORKFORCE_VERSION_CONFLICT' },
    { status: 412, code: 'PRECONDITION_FAILED' },
  ])('refreshes a $status conflict and uses the refreshed ETag on the next deliberate save', async ({ status, code }) => {
    let body: unknown = { scopes: [] }
    let revision = 1
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).startsWith('/api/v1/employees/lookup')) {
        return jsonResponse({ items: roster, total: roster.length, limit: 500, offset: 0 })
      }
      if (init?.method === 'PUT') {
        if (revision === 1) {
          revision = 2
          body = { scopes: [{ scope_kind: 'department', department: 'Operations', duty_unit: null, duty_post: null }] }
          return new Response(JSON.stringify({ error: { code, message: 'Scope changed.', details: {} } }), { status })
        }
        body = JSON.parse(String(init.body))
        revision = 3
      }
      return jsonResponse(body, `"scope-${revision}"`)
    })
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('radio', { name: 'Whole organization' }))
    await user.click(screen.getByRole('button', { name: 'Save scope' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Attendance scope changed.')
    expect(screen.getByRole('radio', { name: 'Self and selected locations' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Remove Department · Operations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save scope' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Whole organization' }))
    await user.click(screen.getByRole('button', { name: 'Save scope' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(scopesUrl, expect.objectContaining({
      method: 'PUT', headers: expect.objectContaining({ 'If-Match': '"scope-2"' }),
    })))
  })
})