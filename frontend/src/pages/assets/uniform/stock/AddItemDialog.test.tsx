import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, type UniformItemRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { UNIFORM_ART_KINDS } from '@/components/uniformArtCatalog'
import { AddItemDialog } from './AddItemDialog'
import { DrawingPicker } from './DrawingPicker'

const state = vi.hoisted(() => ({ editable: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => state.editable }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))
const item: UniformItemRead = { id: 1, name_en: 'Suit', name_ar: 'بدلة', description_en: null, description_ar: null, group_key: 'formal', drawing: 'suit', tracking: 'holder', default_qty: 2, sort_order: 0, archived_at: null, version: '1', sizes: [], holders: [] }
function mount() {
  const onOpenChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><AddItemDialog open onOpenChange={onOpenChange} /></I18nextProvider></QueryClientProvider>)
  return onOpenChange
}
async function fill() {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Name in English'), '  Field shirt  ')
  await user.type(screen.getByLabelText('Name in Arabic'), '  قميص  ')
  await user.selectOptions(screen.getByLabelText('Group'), 'guard')
  return user
}
beforeEach(async () => {
  vi.restoreAllMocks()
  state.editable = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listUniformItems').mockResolvedValue([item])
  vi.spyOn(api, 'createUniformItem').mockResolvedValue({ ...item, id: 2, tracking: 'shelf' })
})
describe('Add item catalogue', () => {
  it('hides occupied drawings instead of disabling tiles', () => {
    render(<I18nextProvider i18n={i18n}><DrawingPicker items={[item]} value="polo" onChange={vi.fn()} /></I18nextProvider>)
    expect(screen.queryByRole('radio', { name: 'Suit' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Polo shirt' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Polo shirt' })).toBeChecked()
  })
  it('frees an archived drawing and preselects the first visible grouped drawing', async () => {
    vi.mocked(api.listUniformItems).mockResolvedValue([{ ...item, archived_at: '2026-01-01' }])
    mount()
    expect(await screen.findByRole('radio', { name: 'Suit' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Polo shirt' })).toBeChecked()
  })
  it.each(['en', 'ar'])('explains exhausted drawings accessibly in %s and guards submit', async language => {
    await i18n.changeLanguage(language)
    vi.mocked(api.listUniformItems).mockResolvedValue(UNIFORM_ART_KINDS.map((drawing, index) => ({ ...item, id: index + 1, drawing })))
    mount()
    await screen.findByText(i18n.t('assets.uniform.noDrawing'))
    const save = screen.getByRole('button', { name: i18n.t('assets.uniform.save') })
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription(i18n.t('assets.uniform.saveDisabledReason'))
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    fireEvent.submit(save.closest('form')!)
    expect(api.createUniformItem).not.toHaveBeenCalled()
  })
  it('requires names, explicit group and positive whole quantity; stages trimmed sizes without submitting', async () => {
    mount()
    await screen.findByLabelText('Name in English')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(screen.getAllByText('This name is required.')).toHaveLength(2)
    expect(screen.getByText('Choose a group.')).toBeInTheDocument()
    await fill()
    fireEvent.change(screen.getByLabelText('Hand-out default quantity'), { target: { value: '1.5' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Enter a whole quantity of at least 1.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Hand-out default quantity'), { target: { value: '3' } })
    const size = screen.getByLabelText('Add size')
    await user.click(size)
    await user.keyboard('{Enter}')
    expect(screen.getByText('Enter a size.')).toBeInTheDocument()
    await user.type(size, ' m{Enter}')
    expect(screen.getByText('This size already exists.')).toBeInTheDocument()
    await user.clear(size)
    await user.type(size, '  custom  {Enter}')
    expect(screen.getByRole('button', { name: 'Remove size custom' })).toBeInTheDocument()
    expect(api.createUniformItem).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformItem).toHaveBeenCalledWith({ name_en: 'Field shirt', name_ar: 'قميص', description_en: null, description_ar: null, group_key: 'guard', default_qty: 3, drawing: 'polo', sizes: ['S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'custom'] }))
  })
  it('replaces editable presets and keeps one size', async () => {
    mount()
    const user = await fill()
    await user.selectOptions(screen.getByLabelText('Size preset'), 'shoe')
    expect(screen.getByRole('button', { name: 'Remove size 38' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Size preset'), 'waist')
    expect(screen.getByRole('button', { name: 'Remove size 28' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Size preset'), 'one')
    expect(screen.getByRole('button', { name: 'Remove size One size' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformItem).toHaveBeenCalledWith(expect.objectContaining({ sizes: ['one'] })))
  })
  it('rejects overlong staged labels and allows removing staged sizes', async () => {
    mount()
    const user = await fill()
    const size = screen.getByLabelText('Add size')
    fireEvent.change(size, { target: { value: 'abcdefghijklmnopq' } })
    fireEvent.keyDown(size, { key: 'Enter' })
    expect(screen.getByText('Size labels must contain 1 to 16 characters.')).toBeInTheDocument()
    fireEvent.change(size, { target: { value: '  Tall  ' } })
    fireEvent.keyDown(size, { key: 'Enter' })
    await user.click(screen.getByRole('button', { name: 'Remove size Tall' }))
    expect(screen.queryByRole('button', { name: 'Remove size Tall' })).not.toBeInTheDocument()
    expect(api.createUniformItem).not.toHaveBeenCalled()
  })
  it('shows drawing races inline without closing', async () => {
    vi.mocked(api.createUniformItem).mockRejectedValue(new ApiError(409, 'uniform_drawing_in_use', 'Conflict'))
    const close = mount()
    const user = await fill()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another active item already uses this drawing. Choose another drawing.')
    expect(close).not.toHaveBeenCalled()
  })
  it('does not trust availability after a load error', async () => {
    vi.mocked(api.listUniformItems).mockRejectedValue(new Error('offline'))
    mount()
    await screen.findByRole('alert')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
  it('does not mount or write without edit capability', () => {
    state.editable = false
    mount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.listUniformItems).not.toHaveBeenCalled()
    expect(api.createUniformItem).not.toHaveBeenCalled()
  })
})
