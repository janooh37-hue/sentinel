import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { VehicleSiteRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { SitesDialog } from './SitesDialog'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<{ api: typeof api }>()
  return { ...mod, api: { ...mod.api, listVehicleSites: vi.fn(), createVehicleSite: vi.fn(), updateVehicleSite: vi.fn() } }
})

const SITES: VehicleSiteRead[] = [
  { id: 1, name_ar: 'الوثبة', name_en: 'Al Wathba', active: true, vehicle_count: 2 },
  { id: 2, name_ar: 'مصفح', name_en: 'Mussafah', active: true, vehicle_count: 0 },
]

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><SitesDialog open onOpenChange={vi.fn()} /></I18nextProvider></QueryClientProvider>)
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.listVehicleSites).mockResolvedValue(SITES)
  vi.mocked(api.createVehicleSite).mockResolvedValue({ ...SITES[1], id: 3 })
  vi.mocked(api.updateVehicleSite).mockResolvedValue(SITES[0])
})

describe('Sites request', () => {
  it.each(['en', 'ar'])('renames in the session language and adds one name to both halves in %s', async (language) => {
    await i18n.changeLanguage(language)
    const user = userEvent.setup()
    renderDialog()
    const current = language === 'ar' ? 'الوثبة' : 'Al Wathba'
    const name = language === 'ar' ? 'موقع جديد' : 'New site'
    const existing = await screen.findByRole('textbox', { name: `${i18n.t('vehicles.siteName')} · ${current}` })
    await user.clear(existing)
    await user.type(existing, name)
    const row = existing.closest('li')
    if (!row) throw new Error('Site row not found')
    await user.click(within(row).getByRole('button', { name: i18n.t('vehicles.save') }))
    // A bilingual site keeps its other-language name: only the session half changes.
    const renamed = language === 'ar' ? { name_ar: name } : { name_en: name }
    await waitFor(() => expect(api.updateVehicleSite).toHaveBeenCalledWith(1, renamed))
    await user.type(screen.getByRole('textbox', { name: i18n.t('vehicles.siteName') }), name)
    await user.click(screen.getByRole('button', { name: i18n.t('vehicles.addSite') }))
    await waitFor(() => expect(api.createVehicleSite).toHaveBeenCalledWith({ name_ar: name, name_en: name }))
    expect(screen.queryByLabelText(i18n.t('vehicles.siteNameAr'))).not.toBeInTheDocument()
    expect(screen.queryByLabelText(i18n.t('vehicles.siteNameEn'))).not.toBeInTheDocument()
  })

  it('offers archive only for empty sites and keeps counts readable', async () => {
    const user = userEvent.setup()
    renderDialog()
    const occupied = (await screen.findByDisplayValue('Al Wathba')).closest('li')
    const empty = screen.getByDisplayValue('Mussafah').closest('li')
    if (!occupied || !empty) throw new Error('Site row not found')
    expect(within(occupied).queryByRole('button', { name: i18n.t('vehicles.archive') })).not.toBeInTheDocument()
    expect(within(occupied).getByText('2')).toBeInTheDocument()
    await user.click(within(empty).getByRole('button', { name: i18n.t('vehicles.archive') }))
    await waitFor(() => expect(api.updateVehicleSite).toHaveBeenCalledWith(2, { active: false }))
  })

  it('keeps an unsaved name when a refresh after another save fails', async () => {
    vi.mocked(api.listVehicleSites).mockReset()
    vi.mocked(api.listVehicleSites).mockResolvedValueOnce(SITES).mockRejectedValue(new Error('offline'))
    const user = userEvent.setup()
    renderDialog()
    const first = await screen.findByDisplayValue('Al Wathba')
    await user.clear(first)
    await user.type(first, 'East depot')
    const second = screen.getByDisplayValue('Mussafah')
    await user.clear(second)
    await user.type(second, 'Mussafah North')
    const row = second.closest('li')
    if (!row) throw new Error('Site row not found')
    await user.click(within(row).getByRole('button', { name: i18n.t('vehicles.save') }))
    await waitFor(() => expect(api.updateVehicleSite).toHaveBeenCalledWith(2, { name_en: 'Mussafah North' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('common.loadError'))
    expect(screen.getByDisplayValue('East depot')).toBeInTheDocument()
  })
})
