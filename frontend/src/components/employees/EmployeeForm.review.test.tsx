import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EmployeeForm } from './EmployeeForm'

const initial = {
  id: 'G3190',
  name_en: 'ABDULLA ALABRI',
  status: 'Active' as const,
  department: 'Operations',
}

describe('EmployeeForm review', () => {
  it('disables unchanged edits and restores a changed field with Undo', async () => {
    render(<EmployeeForm mode="edit" initial={initial} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument()

    fireEvent.change(document.getElementById('department')!, { target: { value: 'Administration' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(document.getElementById('department')).toHaveValue('Operations')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('reviews trimmed submitted values, keeps edits, and saves only after confirmation', async () => {
    const onSubmit = vi.fn()
    render(<EmployeeForm mode="edit" initial={initial} onSubmit={onSubmit} />)
    fireEvent.change(document.getElementById('department')!, { target: { value: '  Administration  ' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const review = await screen.findByRole('region', { name: 'Review changes before saving' })
    expect(onSubmit).not.toHaveBeenCalled()
    const row = within(review).getByRole('row', { name: /Operations Administration/ })
    expect(within(row).getByText('Administration')).toHaveTextContent(/^Administration$/)

    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('region', { name: 'Review changes before saving' })).not.toBeInTheDocument()
    expect(document.getElementById('department')).toHaveValue('  Administration  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm and save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ department: 'Administration', effective_date: null })
  })

  it('requires a fresh valid review after editing a reviewed value', async () => {
    const onSubmit = vi.fn()
    render(<EmployeeForm mode="edit" initial={initial} onSubmit={onSubmit} />)
    fireEvent.change(document.getElementById('department')!, { target: { value: 'Administration' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Confirm and save' })
    fireEvent.change(document.getElementById('name_en')!, { target: { value: '' } })
    expect(screen.queryByRole('button', { name: 'Confirm and save' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Review changes before saving' })).not.toBeInTheDocument()
  })

  it('reviews status-shaped clearing of stale transfer details', async () => {
    render(<EmployeeForm mode="edit" initial={{ ...initial, transfer_site: 'Dubai' }} onSubmit={vi.fn()} />)
    fireEvent.change(document.getElementById('department')!, { target: { value: 'Administration' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const review = await screen.findByRole('region', { name: 'Review changes before saving' })
    expect(within(review).getByRole('row', { name: /Dubai/ })).toHaveTextContent('Not set')
  })

  it('saves a valid new employee directly without an edit review', async () => {
    const onSubmit = vi.fn()
    render(<EmployeeForm mode="create" onSubmit={onSubmit} />)
    fireEvent.change(document.getElementById('id')!, { target: { value: 'G3190' } })
    fireEvent.change(document.getElementById('name_en')!, { target: { value: initial.name_en } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(screen.queryByRole('region', { name: 'Review changes before saving' })).not.toBeInTheDocument()
  })
})
