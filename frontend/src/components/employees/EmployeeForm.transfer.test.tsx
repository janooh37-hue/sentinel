import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { EmployeeRead } from '@/lib/api'
import { EmployeeForm } from './EmployeeForm'

const BASE = { id: 'G3190', name_en: 'ABDULLA ALABRI', status: 'Active' } as Partial<EmployeeRead>

async function chooseStatus(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: /^Status/ }))
  await userEvent.click(await screen.findByRole('option', { name: label }))
}

function setDate(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement
  // userEvent.type is unreliable for date inputs in jsdom; fire a change directly.
  return userEvent.clear(el).then(() => userEvent.type(el, value))
}

describe('EmployeeForm transfer fields', () => {
  it('shows transfer fields when Transferred is selected and blocks submit without a site', async () => {
    const onSubmit = vi.fn()
    render(<EmployeeForm mode="edit" initial={BASE} onSubmit={onSubmit} />)
    expect(document.getElementById('transfer_site')).toBeNull()
    expect(document.getElementById('transfer_return_date')).toBeNull()

    await chooseStatus('Transferred')
    expect(document.getElementById('transfer_site')).not.toBeNull()
    expect(document.getElementById('transfer_return_date')).not.toBeNull()
    expect(screen.getByText(/Destination site/)).toHaveTextContent('*')

    await setDate('end_date', '2026-08-15')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(
      await screen.findByText('Destination site is required for a transfer'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each(['Transferred', 'Loaned'])('%s rejects a return date that is not after the effective date', async (status) => {
    const onSubmit = vi.fn()
    render(<EmployeeForm mode="edit" initial={BASE} onSubmit={onSubmit} />)
    await chooseStatus(status)
    await setDate('end_date', '2026-08-15')
    await userEvent.type(document.getElementById('transfer_site') as HTMLElement, 'Dubai')
    await setDate('transfer_return_date', '2026-08-15')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(
      await screen.findByText('Expected return date must be after the effective date'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each(['Transferred', 'Loaned'])('submits transfer_site and transfer_return_date for %s', async (status) => {
    const onSubmit = vi.fn()
    render(<EmployeeForm mode="edit" initial={BASE} onSubmit={onSubmit} />)
    await chooseStatus(status)
    await setDate('end_date', '2026-08-15')
    await userEvent.type(document.getElementById('transfer_site') as HTMLElement, 'Dubai')
    await setDate('transfer_return_date', '2026-11-15')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0]
    expect(payload).toMatchObject({
      status,
      end_date: '2026-08-15',
      transfer_site: 'Dubai',
      transfer_return_date: '2026-11-15',
      effective_date: null,
    })
  })

  it('shows optional Loaned to party and return date, and submits without a party', async () => {
    const onSubmit = vi.fn()
    render(<EmployeeForm mode="edit" initial={BASE} onSubmit={onSubmit} />)
    await chooseStatus('Loaned')
    expect(screen.getByLabelText('Loaned to')).toBeInTheDocument()
    expect(document.getElementById('transfer_return_date')).not.toBeNull()

    await setDate('end_date', '2026-08-15')
    await setDate('transfer_return_date', '2026-11-15')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      status: 'Loaned',
      end_date: '2026-08-15',
      transfer_site: null,
      transfer_return_date: '2026-11-15',
      effective_date: null,
    })
  })

  it('omits transfer fields and effective_date for a status without site fields', async () => {
    const onSubmit = vi.fn()
    render(
      <EmployeeForm
        mode="edit"
        initial={{ ...BASE, transfer_site: 'Stale', transfer_return_date: '2026-11-15' }}
        onSubmit={onSubmit}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.transfer_site).toBeNull()
    expect(payload.transfer_return_date).toBeNull()
    expect(payload.effective_date).toBeNull()
  })

  it.each(['Transferred', 'Loaned'] as const)('includes effective_date and clears site fields when reactivating from %s', async (status) => {
    const onSubmit = vi.fn()
    render(
      <EmployeeForm
        mode="edit"
        initial={{
          ...BASE,
          status,
          end_date: '2026-08-15',
          transfer_site: 'Dubai',
          transfer_return_date: '2026-11-15',
        }}
        onSubmit={onSubmit}
      />,
    )
    await chooseStatus('Active')
    expect(document.getElementById('effective_date')).not.toBeNull()
    await setDate('effective_date', '2026-09-01')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.status).toBe('Active')
    expect(payload.effective_date).toBe('2026-09-01')
    expect(payload.transfer_site).toBeNull()
    expect(payload.transfer_return_date).toBeNull()
  })

  it.each(['Transferred', 'Loaned'] as const)('keeps a pending %s departure\'s site and return date on a full save', async (pendingStatus) => {
    // Still-Active employees must retain pending site fields until the scheduled flip.
    const onSubmit = vi.fn()
    render(
      <EmployeeForm
        mode="edit"
        initial={{
          ...BASE,
          end_date: '2099-08-15',
          pending_status: pendingStatus,
          transfer_site: 'Abu Dhabi',
          transfer_return_date: '2099-11-15',
        }}
        onSubmit={onSubmit}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.status).toBe('Active')
    expect(payload.transfer_site).toBe('Abu Dhabi')
    expect(payload.transfer_return_date).toBe('2099-11-15')
    expect(payload.effective_date).toBeNull()
  })
})
