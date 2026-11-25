/**
 * EmployeePicker — reopening after a pick.
 *
 * Multi-add callers (the release lists) keep `selectedId={null}` and the input
 * keeps focus after each pick, so the next click or keystroke has to reopen the
 * list without a fresh focus event. Uses the `source` prop instead of mocking
 * `@/lib/api`; i18n comes from the global test/setup.ts (lng=en).
 */

import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { EmployeePicker, type EmployeePickerRow, type EmployeePickerSource } from './EmployeePicker'

const ROWS: EmployeePickerRow[] = [
  { id: 'G3082', name_en: 'Ahmed Saeed', name_ar: 'أحمد سعيد', department: 'Security' },
  { id: 'G4110', name_en: 'Mohammed Khalid', name_ar: 'محمد خالد', department: 'Security' },
]

const search = vi.fn(async (q: string | undefined) => ({
  items: q ? ROWS.filter((r) => r.id.toLowerCase().includes(q.toLowerCase())) : ROWS,
}))

const source: EmployeePickerSource = {
  searchKey: 'test-picker',
  selectedKey: 'test-picker-selected',
  search,
  get: async (id) => ROWS.find((r) => r.id === id)!,
}

/** Multi-add host: like EmployeesTableField, the picker never holds a selection. */
function MultiAdd({ onSelect }: { onSelect: (id: string | null) => void }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EmployeePicker selectedId={null} onSelect={onSelect} source={source} />
    </QueryClientProvider>
  )
}

/** Single-select host: the picked employee stays shown in the input. */
function SingleSelect() {
  const [id, setId] = useState<string | null>(null)
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EmployeePicker selectedId={id} onSelect={setId} source={source} />
    </QueryClientProvider>
  )
}

async function pick(user: UserEvent, id: string): Promise<void> {
  await user.click(await screen.findByRole('option', { name: new RegExp(id) }))
}

beforeEach(() => {
  search.mockClear()
})

describe('EmployeePicker after a pick', () => {
  it('reopens when the still-focused input is clicked again', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MultiAdd onSelect={onSelect} />)
    const combo = screen.getByRole('combobox')

    await user.click(combo)
    await pick(user, 'G3082')
    expect(onSelect).toHaveBeenCalledWith('G3082')
    expect(combo).toHaveFocus()
    expect(combo).toHaveAttribute('aria-expanded', 'false')

    await user.click(combo)
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    await pick(user, 'G4110')
    expect(onSelect).toHaveBeenLastCalledWith('G4110')
  })

  it('reopens and searches when the user types into the still-focused input', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MultiAdd onSelect={onSelect} />)
    const combo = screen.getByRole('combobox')

    await user.click(combo)
    await pick(user, 'G3082')
    expect(combo).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('G41')
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    expect(combo).toHaveValue('G41')
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('G41'))
    expect(await screen.findAllByRole('option')).toHaveLength(1)
  })

  it('adds employees in a row by typing a G-number and pressing Enter', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MultiAdd onSelect={onSelect} />)

    await user.click(screen.getByRole('combobox'))
    for (const id of ['G3082', 'G4110']) {
      await user.keyboard(id)
      await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
      await user.keyboard('{Enter}')
      expect(onSelect).toHaveBeenLastCalledWith(id)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    }
  })

  it('searches only the typed text when a single-select picker reopens over its label', async () => {
    const user = userEvent.setup()
    render(<SingleSelect />)
    const combo = screen.getByRole('combobox')

    await user.click(combo)
    await pick(user, 'G3082')
    await waitFor(() => expect(combo).toHaveValue('Ahmed Saeed — G3082'))

    await user.keyboard('{End}G4')
    expect(combo).toHaveValue('G4')
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('G4'))
  })
})
