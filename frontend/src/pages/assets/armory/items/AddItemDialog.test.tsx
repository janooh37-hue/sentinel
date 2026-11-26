import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type ArmoryItemDetailRead, type ArmoryKitRead, type ArmoryPersonCandidateRead, type ArmorySafeRead } from '@/lib/api'
import i18n from '@/lib/i18n'

import { AddItemDialog } from './AddItemDialog'

const access = vi.hoisted(() => ({ view: true, edit: true }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' }, status: 'authed' }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({
  isLoading: false, has: (cap: string) => cap === 'armory.view' ? access.view : cap === 'armory.edit' && access.edit,
}) }))

const DAY = '2025-03-04'
const SAFE_A: ArmorySafeRead = { id: 10, name_en: 'Test Safe A', name_ar: 'خزنة اختبار أ', created_at: `${DAY}T00:00:00Z`, duty_post: null, vehicle_site: null }
const SAFE_B: ArmorySafeRead = { ...SAFE_A, id: 20, name_en: 'Test Safe B', name_ar: 'خزنة اختبار ب' }
const KIT: ArmoryKitRead = { id: 55, code: 'equipment', name_en: 'Test equipment kit', name_ar: 'طقم معدات للاختبار', firearm_item: null, lines: [] }
const WITNESS: ArmoryPersonCandidateRead = {
  person: { employee_id: 'T-0002', name_en: 'Test Witness One', name_ar: 'شاهد الاختبار الأول', employee_status: 'Active', is_former: false },
  on_duty_here: true, course_round: null, licence_status: 'missing', licence_expires_on: null, open_firearm: null,
}
const SAVED: ArmoryItemDetailRead = {
  id: 100, name_en: 'Test equipment', name_ar: 'معدات اختبار', kind: 'quantity', category: 'accessories', drawing: 'case',
  optional_kit_ids: [], preset_key: null, stock: [], serials: [], batches: [], recent_movements: [],
  totals: {
    opening_qty: null, received_qty: 0, known_in_safe: 0, in_safe: null, available_qty: 0, unrecorded_qty: null,
    out_on_shift: 0, in_custody: 0, in_repair: null, missing: null, lost: null, written_off: null, awaiting_rounds_decision: null,
    expended_rounds: null, lost_rounds: null, settled_rounds: null, expired_qty: null, book_total: null,
  },
}

function mount(overrides: Partial<ComponentProps<typeof AddItemDialog>> = {}) {
  const onSaved = vi.fn()
  const onReceiveExisting = vi.fn()
  const onOpenChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter>
    <AddItemDialog open safes={[SAFE_A, SAFE_B]} onOpenChange={onOpenChange} onSaved={onSaved}
      onReceiveExisting={onReceiveExisting} returnFocusRef={{ current: null }} {...overrides} />
  </MemoryRouter></I18nextProvider></QueryClientProvider>)
  return { onSaved, onReceiveExisting, onOpenChange }
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>, kind = 'Equipment by count') {
  await user.click(screen.getByRole('radio', { name: kind }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  expect(screen.getByText('Enter both the English and Arabic name.')).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Name in English' }), 'Test equipment')
  await user.type(screen.getByRole('textbox', { name: 'Name in Arabic' }), 'معدات اختبار')
}

beforeEach(async () => {
  access.view = true
  access.edit = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listArmoryKits').mockResolvedValue([KIT])
  vi.spyOn(api, 'listArmoryPeople').mockResolvedValue([WITNESS])
  vi.spyOn(api, 'createArmoryItem').mockResolvedValue(SAVED)
})
afterEach(() => vi.restoreAllMocks())

describe('Add armory item', () => {
  it.each([
    { kind: 'Firearm', category: 'Firearms', value: 'firearms', drawing: 'pistol', label: 'Serials to record', input: 'test-x-٠١', entry: { type: 'serial', serial_codes: ['TEST-X-01'] } },
    { kind: 'Ammunition', category: 'Ammunition', value: 'ammo', drawing: 'rounds', label: 'Quantity', input: '0', entry: { type: 'quantity', qty: 0 } },
  ])('locks the $kind category and requires evidence for each counted opening', async ({ kind, category, value, drawing, label, input, entry }) => {
    mount()
    const user = userEvent.setup()
    await fillDetails(user, kind)
    const categorySelect = screen.getByRole('combobox', { name: 'Category' })
    expect(categorySelect).toBeDisabled()
    expect(within(categorySelect).getByRole('option', { name: category, selected: true })).toBeInTheDocument()
    expect(screen.queryByText('Kit membership')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    const opening = within(screen.getByRole('group', { name: 'Test Safe A' }))
    await user.type(opening.getByRole('textbox', { name: label }), input)
    expect(screen.getByRole('button', { name: 'Save item' })).toBeDisabled()
    expect(screen.getByText('Enter a receipt or opening-stock reference.')).toBeInTheDocument()
    fireEvent.change(opening.getByLabelText(/^Opening date/), { target: { value: DAY } })
    await user.type(opening.getByRole('textbox', { name: 'Reference' }), 'TEST-OPEN-01')
    expect(screen.getByRole('button', { name: 'Save item' })).toBeDisabled()
    expect(screen.getByText('Choose a witness other than the armorer.')).toBeInTheDocument()
    expect(api.createArmoryItem).not.toHaveBeenCalled()
    await user.click(await opening.findByRole('button', { name: /Test Witness One/ }))
    expect(api.listArmoryPeople).toHaveBeenCalledWith({ purpose: 'witness', safe_id: 10 })
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    expect(api.createArmoryItem).toHaveBeenCalledExactlyOnceWith({
      name_en: 'Test equipment', name_ar: 'معدات اختبار', kind: kind === 'Firearm' ? 'firearm' : 'ammunition',
      category: value, drawing, optional_kit_ids: [],
      openings: [{ safe_id: 10, received_on: DAY, reference: 'TEST-OPEN-01', witness_employee_id: 'T-0002', entry }],
    })
  })

  it('omits a blank safe, sends counted zero, and saves ordinary kit membership', async () => {
    const { onSaved, onOpenChange } = mount()
    const user = userEvent.setup()
    await fillDetails(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'restraints')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Drawing' }), 'shield')
    await user.click(screen.getByText('Kit membership'))
    await user.click(await screen.findByRole('checkbox', { name: 'Test equipment kit' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    const counted = within(screen.getByRole('group', { name: 'Test Safe B' }))
    fireEvent.change(counted.getByRole('textbox', { name: 'Quantity' }), { target: { value: '٠' } })
    fireEvent.change(counted.getByLabelText(/^Opening date/), { target: { value: DAY } })
    expect(within(screen.getByRole('group', { name: 'Test Safe A' })).getByText('Opening stock not counted.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    expect(api.createArmoryItem).toHaveBeenCalledExactlyOnceWith({
      name_en: 'Test equipment', name_ar: 'معدات اختبار', kind: 'quantity', category: 'restraints', drawing: 'shield',
      optional_kit_ids: [55], openings: [{ safe_id: 20, received_on: DAY, reference: null, witness_employee_id: null, entry: { type: 'quantity', qty: 0 } }],
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps both names after a duplicate and hands the existing item to Receive stock', async () => {
    vi.mocked(api.createArmoryItem).mockRejectedValueOnce(new ApiError(409, 'armory_duplicate_item', 'Raw backend text', { field: 'name_ar', item_id: 73 }))
    const { onReceiveExisting, onSaved, onOpenChange } = mount()
    const user = userEvent.setup()
    await fillDetails(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    const shortcut = await screen.findByRole('button', { name: 'Receive stock' })
    expect(screen.getByRole('alert')).toHaveTextContent('معدات اختبار is already in the catalogue.')
    expect(screen.getByRole('textbox', { name: 'Name in English' })).toHaveValue('Test equipment')
    expect(screen.getByRole('textbox', { name: 'Name in Arabic' })).toHaveValue('معدات اختبار')
    expect(screen.queryByText('Raw backend text')).not.toBeInTheDocument()
    await user.click(shortcut)
    expect(onReceiveExisting).toHaveBeenCalledExactlyOnceWith(73)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('starts over at Kind after Add another and leaves all uncounted safes out of the write', async () => {
    const { onSaved, onOpenChange } = mount()
    const user = userEvent.setup()
    await fillDetails(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('checkbox', { name: 'Add another after saving' }))
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    expect(await screen.findByRole('heading', { name: 'What are you adding?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Equipment by count' })).not.toBeChecked()
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(SAVED)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(api.createArmoryItem).toHaveBeenCalledExactlyOnceWith({
      name_en: 'Test equipment', name_ar: 'معدات اختبار', kind: 'quantity', category: 'accessories', drawing: 'case',
      optional_kit_ids: [], openings: [],
    })
  })

  it('attests zero for serialized equipment without registering a serial', async () => {
    mount()
    const user = userEvent.setup()
    await fillDetails(user, 'Equipment with a serial')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    const opening = within(screen.getByRole('group', { name: 'Test Safe A' }))
    await user.click(opening.getByText('Quantity known, serials later'))
    await user.type(opening.getByRole('textbox', { name: 'Units without a serial number' }), '0')
    fireEvent.change(opening.getByLabelText(/^Opening date/), { target: { value: DAY } })
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    expect(api.createArmoryItem).toHaveBeenCalledExactlyOnceWith({
      name_en: 'Test equipment', name_ar: 'معدات اختبار', kind: 'serial', category: 'comms', drawing: 'radio',
      optional_kit_ids: [], openings: [{ safe_id: 10, received_on: DAY, reference: null, witness_employee_id: null,
        entry: { type: 'serial', serial_codes: [], unrecorded_qty: 0 } }],
    })
  })

  it('confirms a dirty close and does not write when the operator discards it', async () => {
    const { onOpenChange } = mount()
    const user = userEvent.setup()
    await fillDetails(user)
    await user.keyboard('{Escape}')
    const confirmation = await screen.findByRole('dialog', { name: 'Discard this catalogue entry?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Discard' }))
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(api.createArmoryItem).not.toHaveBeenCalled()
  })

  it('does not expose the draft without both capabilities', () => {
    access.view = false
    mount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.listArmoryKits).not.toHaveBeenCalled()
    expect(api.createArmoryItem).not.toHaveBeenCalled()
  })
})