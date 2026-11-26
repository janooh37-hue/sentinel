import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '@/lib/api'
import { ARMORY_EDIT_CAP, ARMORY_VIEW_CAP } from '@/lib/armory'
import i18n from '@/lib/i18n'

import { GuardQualificationDialog } from './GuardQualificationDialog'
import { testFormerGuard, testGuard } from './guardsFixtures'

vi.mock(import('@/lib/api'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, api: { ...actual.api, getArmoryGuard: vi.fn(), saveArmoryQualification: vi.fn() } }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ isLoading: false, has: (cap: string) => cap === ARMORY_VIEW_CAP || cap === ARMORY_EDIT_CAP }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ status: 'authed', user: { id: 21 } }) }))

function mount(employeeId = 'T-0001') {
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function DialogUnderTest() {
    const [open, setOpen] = useState(true)
    return <GuardQualificationDialog employeeId={employeeId} open={open} onClose={(saved) => { onClose(saved); setOpen(false) }} />
  }
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><DialogUnderTest /></I18nextProvider></QueryClientProvider>)
  return { onClose }
}

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.getArmoryGuard).mockResolvedValue({ data: testGuard, etag: '"3"' })
  vi.mocked(api.saveArmoryQualification).mockResolvedValue({ data: testGuard, etag: '"4"' })
})

afterEach(() => { vi.useRealTimers() })

describe('GuardQualificationDialog', () => {
  it('saves the qualification using the exact ETag from the guard read', async () => {
    const user = userEvent.setup()
    const { onClose } = mount()
    const dialog = await screen.findByRole('dialog', { name: 'Update licence' })
    fireEvent.change(within(dialog).getByLabelText('Course round'), { target: { value: '5' } })
    fireEvent.change(within(dialog).getByLabelText('Licence security number'), { target: { value: 'TEST-LICENCE-B' } })
    fireEvent.change(within(dialog).getByLabelText('Licence expiry'), { target: { value: '2032-06-01' } })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(api.saveArmoryQualification).toHaveBeenCalledWith('T-0001', {
      course_round: 5, licence_number: 'TEST-LICENCE-B', licence_expires_on: '2032-06-01',
    }, '"3"')
    await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith(true))
  })

  it('reports a 412 conflict, reloads and re-seeds the draft for review without resubmitting', async () => {
    const user = userEvent.setup()
    const supersedingGuard = {
      ...testGuard,
      qualification: { ...testGuard.qualification, version: 4, course_round: 8, licence_number: 'TEST-LICENCE-NEW', licence_expires_on: '2032-06-07' },
    }
    vi.mocked(api.getArmoryGuard)
      .mockResolvedValueOnce({ data: testGuard, etag: '"3"' })
      .mockResolvedValue({ data: supersedingGuard, etag: '"4"' })
    vi.mocked(api.saveArmoryQualification).mockRejectedValueOnce(new ApiError(412, 'armory_version_mismatch', 'Internal fixture error', { version: 4 }))
    const { onClose } = mount()
    const dialog = await screen.findByRole('dialog', { name: 'Update licence' })
    const round = within(dialog).getByLabelText('Course round')
    fireEvent.change(round, { target: { value: '6' } })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This record changed since you opened it. Review the current values.')
    expect(within(dialog).queryByText('Internal fixture error')).not.toBeInTheDocument()
    expect(await within(dialog).findByDisplayValue('TEST-LICENCE-NEW')).toBe(within(dialog).getByLabelText('Licence security number'))
    expect(round).toHaveValue('8')
    expect(within(dialog).getByLabelText('Licence expiry')).toHaveValue('2032-06-07')
    expect(api.getArmoryGuard).toHaveBeenNthCalledWith(2, 'T-0001')
    expect(api.saveArmoryQualification).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.change(round, { target: { value: '9' } })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(api.saveArmoryQualification).toHaveBeenLastCalledWith('T-0001', {
      course_round: 9, licence_number: 'TEST-LICENCE-NEW', licence_expires_on: '2032-06-07',
    }, '"4"')
    await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith(true))
  })

  it('warns before save for a date before today in Dubai, including during the UTC date rollover', async () => {
    vi.setSystemTime(new Date('2032-05-18T21:30:00Z'))
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Update licence' })
    const expiry = within(dialog).getByLabelText('Licence expiry')
    const warning = 'This date is in the past. The licence will show as Expired.'

    fireEvent.change(expiry, { target: { value: '2032-05-19' } })
    expect(within(dialog).queryByText(warning)).not.toBeInTheDocument()
    fireEvent.change(expiry, { target: { value: '2032-05-18' } })
    expect(within(dialog).getByRole('status')).toHaveTextContent(warning)
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(api.saveArmoryQualification).not.toHaveBeenCalled()
  })

  it('requires both licence fields or neither, and accepts a positive whole course round without licence evidence', async () => {
    const user = userEvent.setup()
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Update licence' })
    const round = within(dialog).getByLabelText('Course round')
    const save = within(dialog).getByRole('button', { name: 'Save' })
    fireEvent.change(within(dialog).getByLabelText('Licence security number'), { target: { value: '' } })

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a licence security number and expiry date.')
    expect(save).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Licence expiry'), { target: { value: '' } })
    fireEvent.change(round, { target: { value: '0' } })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a positive whole number for the course round.')
    expect(save).toBeDisabled()
    fireEvent.change(round, { target: { value: '٧' } })
    expect(round).toHaveValue('7')
    await user.click(save)

    expect(api.saveArmoryQualification).toHaveBeenCalledWith('T-0001', {
      course_round: 7, licence_number: null, licence_expires_on: null,
    }, '"3"')
  })

  it('never offers the qualification form for a former employee', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getArmoryGuard).mockResolvedValue({ data: testFormerGuard, etag: '"3"' })
    const { onClose } = mount('T-0003')

    expect(await screen.findByText('Former employees’ qualifications are read-only.')).toBeVisible()
    expect(screen.queryByLabelText('Course round')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false)
    expect(api.saveArmoryQualification).not.toHaveBeenCalled()
  })
})
