import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type ArmorySettingsRead, type Versioned } from '@/lib/api'
import { renderArmory } from '../shift/shiftFixtures'
import { ArmoryShiftSettingsDialog } from './ArmoryShiftSettingsDialog'

const access = vi.hoisted(() => ({ edit: true }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'armory.view' || (cap === 'armory.edit' && access.edit), isLoading: false }),
}))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ status: 'authed', user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' } }),
}))

const current: ArmorySettingsRead['current'] = { day_start: '05:45:00', night_start: '18:15:00', grace_minutes: 20, effective_on: null }
const settings: Versioned<ArmorySettingsRead> = {
  etag: '"2"',
  data: { version: 2, current, pending: { ...current, day_start: '06:30:00', effective_on: '2027-01-13' } },
}

function mount() {
  const saved = vi.fn()
  const changeOpen = vi.fn()
  renderArmory(<ArmoryShiftSettingsDialog open returnFocusRef={{ current: null }} onOpenChange={changeOpen} onSaved={saved} />)
  return { saved, changeOpen }
}

beforeEach(() => { access.edit = true })
afterEach(() => vi.restoreAllMocks())

describe('Shift settings', () => {
  it('shows active and scheduled policy and passes the loaded ETag with the change', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'getArmorySettings').mockResolvedValue(settings)
    const patch = vi.spyOn(api, 'updateArmorySettings').mockResolvedValue({ ...settings, etag: '"3"' })
    const { saved, changeOpen } = mount()
    const start = await screen.findByLabelText(/^Day shift starts/)
    expect(screen.getByRole('heading', { name: 'Current settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scheduled from 13/01/2027' }).querySelector('bdi')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('05:45')).toBeInTheDocument()
    expect(start).toHaveValue('06:30')
    expect(start).toHaveAttribute('type', 'text')
    expect(start).toHaveAttribute('dir', 'ltr')
    expect(start).toHaveAttribute('inputmode', 'numeric')
    expect(start).toHaveAttribute('maxlength', '5')
    expect(start).toHaveAttribute('placeholder', '06:00')
    fireEvent.change(start, { target: { value: '٠٧:١٠' } })
    expect(start).toHaveValue('07:10')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Overdue grace (minutes)' }), { target: { value: '0' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(patch).toHaveBeenCalledExactlyOnceWith({ day_start: '07:10', night_start: '18:15', grace_minutes: 0 }, '"2"')
    expect(changeOpen).toHaveBeenCalledWith(false)
  })

  it('reloads a stale policy, preserves the edits and requires a new save with the fresh ETag', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'getArmorySettings').mockResolvedValueOnce(settings).mockResolvedValue({
      etag: '"3"', data: { version: 3, current, pending: { ...current, day_start: '07:05:00', effective_on: '2027-01-13' } },
    })
    const patch = vi.spyOn(api, 'updateArmorySettings')
      .mockRejectedValueOnce(new ApiError(412, 'armory_version_mismatch', 'Synthetic detail', { version: 3 }))
      .mockResolvedValueOnce({ ...settings, etag: '"4"' })
    const { saved, changeOpen } = mount()
    const start = await screen.findByLabelText(/^Day shift starts/)
    const grace = screen.getByRole('spinbutton', { name: 'Overdue grace (minutes)' })
    fireEvent.change(start, { target: { value: '07:10' } })
    fireEvent.change(grace, { target: { value: '43' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This record changed since you opened it. Review the current values.')
    expect(await screen.findByText('07:05')).toBeInTheDocument()
    expect(start).toHaveValue('07:10')
    expect(grace).toHaveValue(43)
    expect(saved).not.toHaveBeenCalled()
    expect(changeOpen).not.toHaveBeenCalled()
    expect(patch).toHaveBeenCalledExactlyOnceWith({ day_start: '07:10', night_start: '18:15', grace_minutes: 43 }, '"2"')

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(patch).toHaveBeenLastCalledWith({ day_start: '07:10', night_start: '18:15', grace_minutes: 43 }, '"3"')
  })

  it('validates shift ordering and whole grace minutes before any write', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'getArmorySettings').mockResolvedValue(settings)
    const patch = vi.spyOn(api, 'updateArmorySettings')
    mount()
    const night = await screen.findByLabelText(/^Night shift starts/)
    const grace = screen.getByRole('spinbutton', { name: 'Overdue grace (minutes)' })
    fireEvent.change(night, { target: { value: '06:30' } })
    fireEvent.change(grace, { target: { value: '1.5' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The day shift must start before the night shift.')).toBeInTheDocument()
    expect(screen.getByText('Enter whole minutes from 0 to 1440.')).toBeInTheDocument()
    expect(night).toHaveAttribute('aria-invalid', 'true')
    expect(grace).toHaveAttribute('aria-invalid', 'true')
    expect(patch).not.toHaveBeenCalled()

    fireEvent.change(night, { target: { value: '24:00' } })
    fireEvent.change(grace, { target: { value: '30' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter the shift start time in 24-hour format.')).toBeInTheDocument()
    expect(patch).not.toHaveBeenCalled()
  })

  it('does not request settings for a viewer', () => {
    access.edit = false
    const read = vi.spyOn(api, 'getArmorySettings')
    mount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(read).not.toHaveBeenCalled()
  })
})
