import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import { api } from '@/lib/api'
import { ItemPermitFormDialog } from './ItemPermitFormDialog'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// The real picker searches the employee API; a button is enough to pick one.
vi.mock('@/pages/application/EmployeePicker', () => ({
  EmployeePicker: ({ onSelect }: { onSelect: (id: string | null) => void }) => (
    <button type="button" onClick={() => onSelect('G3082')}>
      pick employee
    </button>
  ),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listManagers: vi.fn().mockResolvedValue([]),
      createItemPermit: vi.fn(),
      updateItemPermit: vi.fn(),
    },
  }
})

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ItemPermitFormDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Create permit' }))

describe('ItemPermitFormDialog', () => {
  it('creates with the picked employee, item rows and default recipient/zone/site', async () => {
    const createSpy = vi.spyOn(api, 'createItemPermit').mockResolvedValue({ id: 5 } as never)
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: 'pick employee' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
    await userEvent.type(screen.getByLabelText('Item 1'), 'Laptop')
    await userEvent.type(screen.getByLabelText('Item 2'), 'Cable')
    await userEvent.clear(screen.getByLabelText('Qty 2'))
    await userEvent.type(screen.getByLabelText('Qty 2'), '3')
    await submit()
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          employee_id: 'G3082',
          recipient: 'مسؤول وحدة التفتيش',
          zones: ['red'],
          site: 'مبنى مركز الإصلاح والتأهيل الوثبة - 2',
          items: [
            { name: 'Laptop', quantity: 1 },
            { name: 'Cable', quantity: 3 },
          ],
        }),
      ),
    )
  })

  it('blocks submit on a blank item row or a zero quantity', async () => {
    const createSpy = vi.spyOn(api, 'createItemPermit').mockClear()
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: 'pick employee' }))
    await submit()
    expect(await screen.findByText('Enter the item name.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Item 1'), 'Laptop')
    await userEvent.clear(screen.getByLabelText('Qty 1'))
    await userEvent.type(screen.getByLabelText('Qty 1'), '0')
    await submit()
    expect(await screen.findByText('Enter a whole number of 1 or more.')).toBeInTheDocument()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('keeps at least one item row', () => {
    renderForm()
    expect(screen.getByRole('button', { name: 'Remove item' })).toBeDisabled()
  })

  const fillAndSubmit = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'pick employee' }))
    await userEvent.type(screen.getByLabelText('Item 1'), 'Laptop')
    await submit()
  }

  it('sends canonical-order zones when work residence is toggled on', async () => {
    const createSpy = vi.spyOn(api, 'createItemPermit').mockClear().mockResolvedValue({ id: 5 } as never)
    renderForm()
    const wr = screen.getByRole('button', { name: 'Work residence' })
    expect(wr).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(wr)
    expect(wr).toHaveAttribute('aria-pressed', 'true')
    await fillAndSubmit()
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ zones: ['red', 'work_residence'] }),
      ),
    )
  })

  it('blocks submit with the zone error when every zone is deselected', async () => {
    const createSpy = vi.spyOn(api, 'createItemPermit').mockClear()
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: 'Red zone' }))
    await fillAndSubmit()
    expect(await screen.findByText('Select at least one zone.')).toBeInTheDocument()
    expect(createSpy).not.toHaveBeenCalled()
  })
})
