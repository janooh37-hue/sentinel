import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import { FormProvider, useForm, useWatch } from 'react-hook-form'
import { api } from '@/lib/api'
import { SavedRecipientPicker } from './SavedRecipientPicker'
import { RecipientPickerField } from './RecipientPickerField'
import { MultiRecipientPickerField } from './MultiRecipientPickerField'

const gates = vi.hoisted(() => ({ manage: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => gates.manage }) }))
const RECIPIENTS = [{ id: 1, name: 'HR director', name_ar: 'مدير الموارد البشرية' }, { id: 2, name: 'Custom designation', name_ar: null }]
function Host({ multiple = false, disabled = false }: { multiple?: boolean; disabled?: boolean }): React.JSX.Element {
  const [value, setValue] = useState<number | string | string[] | null>(multiple ? [] : '')
  return <><SavedRecipientPicker mode={multiple ? 'multiple' : 'name'} value={value} onChange={setValue} disabled={disabled} maxNames={20} maxNameLength={500} label="Paper names" hint="Only printed" /><output aria-label="Value">{JSON.stringify(value)}</output></>
}
function mount(element = <Host />): void {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{element}</QueryClientProvider>)
}
beforeEach(() => { gates.manage = true; vi.spyOn(api, 'listRecipients').mockResolvedValue(RECIPIENTS) })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await i18n.changeLanguage('en') })
it.each(['en', 'ar'])('searches the saved General Book names with arrow/Enter/Escape in %s', async (language) => {
  await i18n.changeLanguage(language)
  mount()
  const input = screen.getByRole('combobox', { name: 'Paper names' })
  await userEvent.click(input)
  await screen.findByRole('option', { name: /Custom designation/ })
  await userEvent.type(input, 'مدير')
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(input).toHaveValue('HR director')
  expect(screen.getByLabelText('Value')).toHaveTextContent('"HR director"')
  await userEvent.click(input)
  await userEvent.keyboard('{Escape}')
  expect(input).toHaveAttribute('aria-expanded', 'false')
  expect(input).toHaveFocus()
  expect(input).toHaveAccessibleDescription('Only printed')
})
it('saves a custom designation through the existing endpoint and adds its canonical name', async () => {
  const create = vi.spyOn(api, 'createRecipient').mockResolvedValue({ id: 3, name: 'New title', name_ar: null })
  mount(<Host multiple />)
  await userEvent.type(screen.getByRole('combobox'), 'New title')
  await userEvent.click(await screen.findByRole('option', { name: /New title/ }))
  await waitFor(() => expect(screen.getByLabelText('Value')).toHaveTextContent('["New title"]'))
  expect(create).toHaveBeenCalledWith({ name: 'New title' })
  await userEvent.click(screen.getByRole('button', { name: /Remove.*New title/ }))
  expect(screen.getByLabelText('Value')).toHaveTextContent('[]')
})
it('hides all save-list management without books.edit while retaining free-text direction and saved selection', async () => {
  gates.manage = false
  mount()
  await userEvent.type(screen.getByRole('combobox'), 'Free text')
  expect(screen.getByLabelText('Value')).toHaveTextContent('Free text')
  expect(screen.queryByRole('option', { name: /Add/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Manage/ })).not.toBeInTheDocument()
})
it('disables input and management during a save-list request without losing newer selected names', async () => {
  let resolve!: (value: typeof RECIPIENTS[number]) => void
  vi.spyOn(api, 'createRecipient').mockImplementation(() => new Promise((accept) => { resolve = accept }))
  mount(<Host multiple />)
  await userEvent.type(screen.getByRole('combobox'), 'New title')
  await userEvent.click(await screen.findByRole('option', { name: /New title/ }))
  expect(screen.getByRole('combobox')).toBeDisabled()
  resolve({ id: 3, name: 'New title', name_ar: null })
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
  expect(screen.getByLabelText('Value')).toHaveTextContent('New title')
})
function GeneralBook(): React.JSX.Element {
  const form = useForm({ defaultValues: { recipient_id: null, cc: [] } })
  const values = useWatch({ control: form.control })
  return <FormProvider {...form}><RecipientPickerField name="recipient_id" label_en="To" label_ar="إلى" /><MultiRecipientPickerField name="cc" label_en="CC" label_ar="نسخة إلى" /><output aria-label="General values">{JSON.stringify(values)}</output></FormProvider>
}
it('preserves General Book numeric primary IDs and canonical CC names', async () => {
  mount(<GeneralBook />)
  await userEvent.click(screen.getByRole('combobox', { name: 'To' }))
  await userEvent.click(await screen.findByRole('option', { name: /Custom designation/ }))
  await userEvent.click(screen.getByRole('combobox', { name: 'CC' }))
  await userEvent.click(await screen.findByRole('option', { name: /HR director/ }))
  expect(screen.getByLabelText('General values')).toHaveTextContent('{"recipient_id":2,"cc":["HR director"]}')
})

it.each([false, true])('excludes invalid saved names from Ledger fields without truncating (multiple=%s)', async (multiple) => {
  const valid = 'V'.repeat(500)
  const tooLong = 'L'.repeat(501)
  vi.mocked(api.listRecipients).mockResolvedValue([
    { id: 1, name: tooLong, name_ar: 'Long saved title' },
    { id: 2, name: '   ', name_ar: 'Blank saved title' },
    { id: 3, name: valid, name_ar: null },
  ])
  mount(<Host multiple={multiple} />)
  await userEvent.click(screen.getByRole('combobox'))
  await screen.findByRole('option', { name: valid })
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(screen.getByText('Some saved names are unavailable here. Names must contain 1–500 characters.')).toHaveAttribute('role', 'status')
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(screen.getByLabelText('Value').textContent).toBe(JSON.stringify(multiple ? [valid] : valid))
})

it('retains long saved names for existing General Book ID and CC callers', async () => {
  const name = 'L'.repeat(501)
  vi.mocked(api.listRecipients).mockResolvedValue([{ id: 1, name, name_ar: null }])
  mount(<GeneralBook />)
  await userEvent.click(screen.getByRole('combobox', { name: 'To' }))
  await userEvent.click(await screen.findByRole('option', { name }))
  await userEvent.click(screen.getByRole('combobox', { name: 'CC' }))
  await userEvent.click(await screen.findByRole('option', { name }))
  expect(screen.getByLabelText('General values').textContent).toBe(JSON.stringify({ recipient_id: 1, cc: [name] }))
})

it.each(['Ledger', 'General Book'])('prevents repeated padded catalog names in %s CC', async (book) => {
  vi.mocked(api.listRecipients).mockResolvedValue([
    { id: 1, name: ' HR director ', name_ar: null },
    { id: 2, name: 'hr DIRECTOR', name_ar: null },
  ])
  mount(book === 'Ledger' ? <Host multiple /> : <GeneralBook />)
  const input = screen.getByRole('combobox', { name: book === 'Ledger' ? 'Paper names' : 'CC' })
  await userEvent.click(input)
  await userEvent.click(await screen.findByRole('option', { name: 'HR director' }))
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  await userEvent.type(input, 'HR director')
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(screen.getByLabelText(book === 'Ledger' ? 'Value' : 'General values').textContent).toBe(
    JSON.stringify(book === 'Ledger' ? ['HR director'] : { recipient_id: null, cc: ['HR director'] }),
  )
})

it('keeps a full printed CC list removable and prevents a twenty-first selection', async () => {
  const change = vi.fn()
  const names = Array.from({ length: 20 }, (_, index) => `Office ${index}`)
  mount(<SavedRecipientPicker mode="multiple" value={names} onChange={change} maxNames={20} label="Paper names" />)
  const input = screen.getByRole('combobox', { name: 'Paper names' })
  expect(input).toHaveAttribute('readonly')
  await userEvent.click(input)
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Remove Office 0 from CC' }))
  expect(change).toHaveBeenCalledWith(names.slice(1))
  expect(input).toHaveFocus()
})
