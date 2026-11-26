import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type ArmorySiteOptionsRead } from '@/lib/api'
import { renderArmory, testSafe } from '../shift/shiftFixtures'
import { ArmorySafeDialog } from './ArmorySafeDialog'

const access = vi.hoisted(() => ({ edit: true }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'armory.view' || (cap === 'armory.edit' && access.edit), isLoading: false }),
}))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ status: 'authed', user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' } }),
}))

const siteOptions: ArmorySiteOptionsRead = {
  vehicle_sites: [{ id: 30, name_en: 'Test Fleet Site', name_ar: 'موقع أسطول للاختبار' }],
  duty_posts: [
    { duty_unit: 'Test Unit A', duty_post: 'Test Post' },
    { duty_unit: 'Test Unit B', duty_post: 'Test Post' },
  ],
}

function mount() {
  const saved = vi.fn()
  const changeOpen = vi.fn()
  renderArmory(<ArmorySafeDialog open returnFocusRef={{ current: null }} onSaved={saved} onOpenChange={changeOpen} />)
  return { saved, changeOpen }
}

beforeEach(() => {
  access.edit = true
  vi.spyOn(api, 'listArmorySiteOptions').mockResolvedValue(siteOptions)
})
afterEach(() => vi.restoreAllMocks())

describe('Add safe', () => {
  it('sends trimmed bilingual names and the exact two independent links', async () => {
    const user = userEvent.setup()
    const savedSafe = { ...testSafe, vehicle_site: siteOptions.vehicle_sites[0], duty_post: siteOptions.duty_posts[1] }
    const create = vi.spyOn(api, 'createArmorySafe').mockResolvedValue(savedSafe)
    const { saved, changeOpen } = mount()
    const site = await screen.findByRole('combobox', { name: 'Fleet site (optional)' })
    const post = screen.getByRole('combobox', { name: 'Duty post (optional)' })
    expect(site).toHaveDisplayValue('Not linked')
    expect(post).toHaveDisplayValue('Not linked')
    fireEvent.change(screen.getByLabelText(/^Safe name in English/), { target: { value: `  ${testSafe.name_en}  ` } })
    const nameAr = screen.getByLabelText(/^Safe name in Arabic/)
    expect(nameAr).toHaveAttribute('dir', 'rtl')
    fireEvent.change(nameAr, { target: { value: ` ${testSafe.name_ar} ` } })
    await user.selectOptions(site, within(site).getByRole('option', { name: 'Test Fleet Site' }))
    await user.selectOptions(post, within(post).getByRole('option', { name: /Test Unit B.*Test Post/ }))
    await user.click(screen.getByRole('button', { name: 'Save safe' }))

    await waitFor(() => expect(saved).toHaveBeenCalledWith(savedSafe))
    expect(create).toHaveBeenCalledExactlyOnceWith({
      name_en: testSafe.name_en, name_ar: testSafe.name_ar, vehicle_site_id: 30, duty_unit: 'Test Unit B', duty_post: 'Test Post',
    })
    expect(changeOpen).toHaveBeenCalledWith(false)
  })

  it('requires both names and keeps a rejected duplicate editable', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createArmorySafe').mockRejectedValue(new ApiError(409, 'armory_duplicate_safe', 'Synthetic detail', { field: 'name_en' }))
    const { saved, changeOpen } = mount()
    await screen.findByRole('combobox', { name: 'Fleet site (optional)' })
    const en = screen.getByLabelText(/^Safe name in English/)
    const ar = screen.getByLabelText(/^Safe name in Arabic/)
    const save = screen.getByRole('button', { name: 'Save safe' })
    fireEvent.change(en, { target: { value: testSafe.name_en } })
    await user.click(save)
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter both the English and Arabic safe names.')
    expect(ar).toHaveAttribute('aria-invalid', 'true')
    expect(create).not.toHaveBeenCalled()

    fireEvent.change(ar, { target: { value: testSafe.name_ar } })
    await user.click(save)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('A safe with this name or link already exists.'))
    expect(create).toHaveBeenCalledExactlyOnceWith({
      name_en: testSafe.name_en, name_ar: testSafe.name_ar, vehicle_site_id: null, duty_unit: null, duty_post: null,
    })
    expect(screen.queryByText('Synthetic detail')).not.toBeInTheDocument()
    expect(en).toHaveValue(testSafe.name_en)
    expect(ar).toHaveValue(testSafe.name_ar)
    expect(saved).not.toHaveBeenCalled()
    expect(changeOpen).not.toHaveBeenCalled()
  })

  it('does not load protected site options for a viewer', () => {
    access.edit = false
    mount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.listArmorySiteOptions).not.toHaveBeenCalled()
  })
})
