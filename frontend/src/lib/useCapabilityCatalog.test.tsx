import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type CapabilityRead, type SessionUser } from '@/lib/api'
import { AuthContext, type AuthContextValue } from '@/lib/authContext'
import {
  capabilityCatalogKey,
  localizeCapability,
  useCapabilityCatalog,
} from '@/lib/useCapabilityCatalog'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listCapabilities: vi.fn(),
    },
  }
})

const USER = {
  id: 17,
  email: 'catalog@example.test',
} as SessionUser

const AUTH: AuthContextValue = {
  user: USER,
  status: 'authed',
  login: vi.fn(),
  logout: vi.fn(),
  refetch: vi.fn(),
  setUser: vi.fn(),
}

const ENTRY: CapabilityRead = {
  id: 'books.edit',
  domain: 'books',
  label_en: 'Edit records and attachments',
  label_ar: 'تعديل السجلات والمرفقات',
  description_en: 'Edit record content and attachments.',
  description_ar: 'تعديل محتوى السجلات ومرفقاتها.',
  sensitive: false,
  requestable: true,
  default_roles: ['manager', 'admin'],
}

function Consumers(): React.JSX.Element {
  const first = useCapabilityCatalog()
  const second = useCapabilityCatalog()
  return <div>{first.status}:{second.status}:{first.entries.length}</div>
}

describe('useCapabilityCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shares one identity-scoped catalog request across consumers', async () => {
    vi.mocked(api.listCapabilities).mockResolvedValue([ENTRY] as never)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={AUTH}>
          <Consumers />
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('ready:ready:1')).toBeVisible()
    expect(api.listCapabilities).toHaveBeenCalledOnce()
    expect(client.getQueryData(capabilityCatalogKey(USER.id))).toEqual([ENTRY])
  })

  it.each(['loading', 'anon'] as const)(
    'does not request the catalog while authentication is %s',
    (status) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      render(
        <QueryClientProvider client={client}>
          <AuthContext.Provider value={{ ...AUTH, status, user: status === 'anon' ? null : USER }}>
            <Consumers />
          </AuthContext.Provider>
        </QueryClientProvider>,
      )

      expect(screen.getByText('loading:loading:0')).toBeVisible()
      expect(api.listCapabilities).not.toHaveBeenCalled()
    },
  )

  it('does not reuse catalog data after the authenticated identity changes', async () => {
    const nextUser = { ...USER, id: 18, email: 'next@example.test' }
    const nextEntry = { ...ENTRY, id: 'leaves.view', domain: 'leaves' }
    vi.mocked(api.listCapabilities)
      .mockResolvedValueOnce([ENTRY] as never)
      .mockResolvedValueOnce([nextEntry] as never)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const view = render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={AUTH}>
          <Consumers />
        </AuthContext.Provider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('ready:ready:1')).toBeVisible()

    view.rerender(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={{ ...AUTH, user: nextUser }}>
          <Consumers />
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    expect(screen.getByText('loading:loading:0')).toBeVisible()
    expect(await screen.findByText('ready:ready:1')).toBeVisible()
    expect(api.listCapabilities).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(capabilityCatalogKey(USER.id))).toEqual([ENTRY])
    expect(client.getQueryData(capabilityCatalogKey(nextUser.id))).toEqual([nextEntry])
  })

  it.each([
    ['non-array payload', { ...ENTRY }],
    ['non-object entry', [null]],
    ['duplicate id', [ENTRY, { ...ENTRY }]],
    ['blank id', [{ ...ENTRY, id: '  ' }]],
    ['wrong nullable field', [{ ...ENTRY, label_ar: 7 }]],
    ['unknown default role', [{ ...ENTRY, default_roles: ['owner'] }]],
    ['sensitive requestable entry', [{ ...ENTRY, sensitive: true, requestable: true }]],
  ])('fails closed for malformed runtime catalog metadata: %s', async (_case, payload) => {
    vi.mocked(api.listCapabilities).mockResolvedValue(payload as never)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={AUTH}>
          <Consumers />
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('error:error:0')).toBeVisible()
  })

  it('uses trimmed English catalog text in English', () => {
    expect(
      localizeCapability(
        { ...ENTRY, label_en: '  Edit records  ', description_en: '  Edit content.  ' },
        ENTRY.id,
        'en',
      ),
    ).toEqual({
      label: 'Edit records',
      description: 'Edit content.',
      labelIsIdentifier: false,
    })
  })

  it('uses trimmed Arabic catalog text in Arabic', () => {
    expect(
      localizeCapability(
        { ...ENTRY, label_ar: '  تعديل السجلات  ', description_ar: '  تعديل المحتوى.  ' },
        ENTRY.id,
        'ar-AE',
      ),
    ).toEqual({
      label: 'تعديل السجلات',
      description: 'تعديل المحتوى.',
      labelIsIdentifier: false,
    })
  })

  it('falls back independently to English when Arabic text is missing', () => {
    expect(
      localizeCapability(
        { ...ENTRY, label_ar: '  ', description_ar: null },
        ENTRY.id,
        'ar',
      ),
    ).toEqual({
      label: 'Edit records and attachments',
      description: 'Edit record content and attachments.',
      labelIsIdentifier: false,
    })
  })

  it('uses the exact stable ID and empty description for an unknown entry', () => {
    expect(localizeCapability(undefined, 'books.category.retired', 'ar')).toEqual({
      label: 'books.category.retired',
      description: '',
      labelIsIdentifier: true,
    })
  })
})
