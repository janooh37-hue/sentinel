import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import i18n from 'i18next'
import ar from '@/locales/ar.json'
import { api, type EmployeeListItem } from '@/lib/api'
import { EmployeeActivityLookup } from './EmployeeActivityLookup'

vi.mock('@/lib/api', async (orig) => ({
  ...(await orig()),
  api: {
    listEmployees: vi.fn(),
  },
}))

const abdulla: EmployeeListItem = {
  id: 'G3190',
  name_en: 'ABDULLA ALABRI',
  name_ar: 'عبدالله العبري',
  status: 'Active',
  position: 'Officer',
  position_ar: 'ضابط',
  has_photo: false,
} as EmployeeListItem
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function lookup(overrides: Partial<React.ComponentProps<typeof EmployeeActivityLookup>> = {}) {
  return (
    <EmployeeActivityLookup
      selected={null}
      onSelect={() => {}}
      onClear={() => {}}
      onOpenProfile={() => {}}
      {...overrides}
    />
  )
}
function statefulLookup(initialSelected: EmployeeListItem | null = null) {
  function StatefulLookup(): React.JSX.Element {
    const [selected, setSelected] = useState<EmployeeListItem | null>(initialSelected)
    return (
      <EmployeeActivityLookup
        selected={selected}
        onSelect={setSelected}
        onClear={() => setSelected(null)}
        onOpenProfile={() => {}}
      />
    )
  }
  return <StatefulLookup />
}

describe('EmployeeActivityLookup', () => {
  beforeEach(() => {
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [abdulla], total: 1 } as never)
  })
  afterEach(async () => {
    await i18n.changeLanguage('en')
    i18n.removeResourceBundle('ar', 'translation')
    vi.clearAllMocks()
  })

  it.each(['Abdulla', 'G3190'])('finds an employee by %s and filters activity', async (query) => {
    const onSelect = vi.fn()
    wrap(lookup({ onSelect }))
    await userEvent.type(screen.getByRole('searchbox'), query)
    const show = await screen.findByRole('button', { name: /show activity/i })
    await userEvent.click(show)
    expect(api.listEmployees).toHaveBeenCalledWith({ q: query, limit: 8 })
    expect(onSelect).toHaveBeenCalledWith(abdulla)
  })

  it('keeps profile navigation separate from feed selection', async () => {
    const onSelect = vi.fn()
    const onOpenProfile = vi.fn()
    wrap(lookup({ onSelect, onOpenProfile }))
    await userEvent.type(screen.getByRole('searchbox'), 'Abdulla')
    await userEvent.click(await screen.findByRole('button', { name: /open profile/i }))
    expect(onOpenProfile).toHaveBeenCalledWith('G3190')
    expect(onSelect).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveFocus()
  })


  it('clears a selected employee back to all activity', async () => {
    const onClear = vi.fn()
    wrap(lookup({ selected: abdulla, onClear }))
    await userEvent.click(screen.getByRole('button', { name: /clear employee filter/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })
  it('renders localized selected identity and position', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    wrap(lookup({ selected: abdulla }))
    expect(screen.getByText('عبدالله العبري')).toBeInTheDocument()
    expect(screen.getByText('ضابط')).toBeInTheDocument()
    expect(screen.getByText('G3190')).toBeInTheDocument()
  })
  it('localizes match name, position, and StatusPill for ar-AE', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar-AE')
    wrap(lookup())
    await userEvent.type(screen.getByRole('searchbox'), 'Abdulla')
    const list = await screen.findByRole('list')
    expect(await within(list).findByText('عبدالله العبري')).toBeInTheDocument()
    expect(await within(list).findByText('ضابط')).toBeInTheDocument()
    const status = await within(list).findByText('نشط')
    expect(status).toHaveClass('bg-success-soft', 'text-success')
  })

  it('keeps the lookup input operable after Show activity and returns focus to it', async () => {
    wrap(statefulLookup())
    await userEvent.type(screen.getByRole('searchbox'), 'Abdulla')
    await userEvent.click(await screen.findByRole('button', { name: /show activity/i }))
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    const input = await screen.findByRole('searchbox')
    expect(input).toHaveFocus()
    expect(input).toHaveValue('')
  })

  it('starts a fresh full-query lookup when typing after selection', async () => {
    wrap(statefulLookup())
    await userEvent.type(screen.getByRole('searchbox'), 'Abdulla')
    await userEvent.click(await screen.findByRole('button', { name: /show activity/i }))
    const input = await screen.findByRole('searchbox')
    vi.mocked(api.listEmployees).mockClear()
    await userEvent.type(input, 'G3190')
    await waitFor(() => {
      expect(api.listEmployees).toHaveBeenLastCalledWith({ q: 'G3190', limit: 8 })
    })
    expect(vi.mocked(api.listEmployees).mock.calls.map(([params]) => params.q)).toEqual(['G3190'])
  })

  it('clears the selected employee, restores all activity, and focuses the input', async () => {
    wrap(statefulLookup(abdulla))
    await userEvent.click(screen.getByRole('button', { name: /clear employee filter/i }))
    const input = await screen.findByRole('searchbox')
    expect(input).toHaveFocus()
    expect(input).toHaveValue('')
  })
  it('removes stale lookup results immediately when Clear follows a new lookup', async () => {
    wrap(statefulLookup())
    await userEvent.type(screen.getByRole('searchbox'), 'Abdulla')
    await userEvent.click(await screen.findByRole('button', { name: /show activity/i }))
    const input = await screen.findByRole('searchbox')
    await userEvent.type(input, 'G3190')
    await screen.findByRole('list')
    await userEvent.click(screen.getByRole('button', { name: /clear employee filter/i }))
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('renders Arabic label and placeholder from the real locale resource', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    wrap(lookup())
    const input = screen.getByRole('searchbox')
    expect(input).toHaveAccessibleName('بحث سريع في النشاط')
    expect(input).toHaveAttribute('placeholder', 'ابحث باسم الموظف أو الرقم الوظيفي')
  })

  it('supports keyboard entry and Escape without nested interactive options', async () => {
    wrap(lookup())
    const input = screen.getByRole('searchbox')
    await userEvent.type(input, 'Abdulla')
    const show = await screen.findByRole('button', { name: /show activity/i })
    await userEvent.keyboard('{ArrowDown}')
    expect(show).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(input).toHaveFocus()
    expect(show.closest('li')?.querySelectorAll('button')).toHaveLength(2)
  })

  it('moves through show-activity actions with ArrowUp and ArrowDown', async () => {
    const second = { ...abdulla, id: 'G3191', name_en: 'AMAL ALI' }
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [abdulla, second], total: 2 } as never)
    wrap(lookup())
    const input = screen.getByRole('searchbox')
    await userEvent.type(input, 'A')
    const shows = await screen.findAllByRole('button', { name: /show activity/i })
    await userEvent.keyboard('{ArrowDown}')
    expect(shows[0]).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(shows[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(shows[0]).toHaveFocus()
  })

  it('shows loading, empty, and error states', async () => {
    const deferred = createDeferred<{ items: EmployeeListItem[]; total: number }>()
    vi.mocked(api.listEmployees).mockResolvedValueOnce(deferred.promise as never)
    wrap(lookup())
    await userEvent.type(screen.getByRole('searchbox'), 'A')
    expect(await screen.findByText(/searching employees/i)).toBeInTheDocument()
    deferred.resolve({ items: [], total: 0 })
    expect(await screen.findByText(/no matching employees/i)).toBeInTheDocument()

    vi.mocked(api.listEmployees).mockRejectedValueOnce(new Error('network'))
    const input = screen.getByRole('searchbox')
    await userEvent.clear(input)
    await userEvent.type(input, 'B')
    expect(await screen.findByText(/employees could not be searched/i)).toBeInTheDocument()
  })

  it('debounces and trims lookup queries', async () => {
    wrap(lookup())
    await userEvent.type(screen.getByRole('searchbox'), ' Abdulla ')
    await waitFor(() => expect(api.listEmployees).toHaveBeenCalledWith({ q: 'Abdulla', limit: 8 }))
  })
})
