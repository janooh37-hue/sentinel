import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import i18n from 'i18next'
import { api } from '@/lib/api'
import ar from '@/locales/ar.json'
import { EmployeeEditPage } from './EmployeeEditPage'

const { has } = vi.hoisted(() => ({ has: vi.fn<(cap: string) => boolean>(() => true) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const employee = { id: 'G100', name_en: 'John Doe', name_ar: 'جون دو', status: 'Active', former_ids: ['G099'], contact: '0501234567' }
const detail = { employee, recent_documents: [], recent_leaves: [], recent_violations: [], recent_sms: [], recent_activity: [], missing_fields: [], completeness: { filled: 10, tracked: 14 }, stats: { documents: 0, leaves_taken_days: 0, violations: 0, ledger_count: 0 } }
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="edit-location">{location.pathname}</output>
}
function renderPage() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={['/employees/G100/edit']}><Routes><Route path="/employees/:id/edit" element={<EmployeeEditPage />} /><Route path="/employees/:id" element={<div>Employee file</div>} /></Routes><LocationProbe /></MemoryRouter></QueryClientProvider>)
}
beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.restoreAllMocks()
  has.mockReturnValue(true)
  vi.spyOn(api, 'getEmployeeDetail').mockResolvedValue(detail as never)
  vi.spyOn(api, 'updateEmployee').mockResolvedValue(employee as never)
  vi.spyOn(api, 'getEmployeeIdChangePreview').mockResolvedValue({ new_id: 'G200', status: 'ok', owner_id: null, owner_name_en: null, owner_name_ar: null, impact: [{ key: 'documents', count: 2 }, { key: 'leaves', count: 0 }] } as never)
  vi.spyOn(api, 'changeEmployeeId').mockResolvedValue({ ...employee, id: 'G200', former_ids: ['G099', 'G100'] } as never)
})

describe('dedicated employee edit page', () => {
  it('renders the correction-only task in Arabic in the main content', async () => {
    i18n.addResourceBundle('ar', 'translation', ar)
    await i18n.changeLanguage('ar')
    has.mockImplementation((cap) => cap === 'employees.change_id')
    renderPage()
    expect(await screen.findByRole('heading', { name: 'تصحيح رقم الموظف' })).toBeInTheDocument()
    const panel = within(screen.getByRole('main')).getByRole('region', { name: 'تصحيح رقم الموظف' })
    expect(within(panel).getByLabelText('الرقم الصحيح')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(api.updateEmployee).not.toHaveBeenCalled()
  })

  it('offers only number correction without profile-edit permission and keeps it after success', async () => {
    has.mockImplementation((cap) => cap === 'employees.change_id')
    vi.mocked(api.getEmployeeDetail).mockImplementation(async (id) => ({ ...detail, employee: { ...employee, id } }) as never)
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Correct employee number' })).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByRole('region', { name: 'Correct employee number' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Name (English)' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Correct number'), { target: { value: 'G200' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Correct transposed digits' } })
    fireEvent.change(screen.getByLabelText('Type G200 again to confirm'), { target: { value: 'G200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change G100 to G200' }))
    expect(await screen.findByText(/Employee number changed from G100 to G200/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Name (English)' })).not.toBeInTheDocument()
    expect(api.updateEmployee).not.toHaveBeenCalled()
  })

  it('hides the entire correction workflow without employees.change_id', async () => {
    has.mockImplementation((cap) => cap !== 'employees.change_id')
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Edit employee information' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Correct employee number' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Correct employee number' })).not.toBeInTheDocument()
    expect(api.getEmployeeIdChangePreview).not.toHaveBeenCalled()
  })

  it('opens the inline correction panel with the capability and blocks a taken preview', async () => {
    vi.mocked(api.getEmployeeIdChangePreview).mockResolvedValue({ new_id: 'G200', status: 'taken', owner_id: 'G200', owner_name_en: 'Mary Smith', owner_name_ar: 'مريم', impact: [] } as never)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Correct employee number' }))
    const panel = screen.getByRole('region', { name: 'Correct employee number' })
    fireEvent.change(within(panel).getByLabelText('Correct number'), { target: { value: 'G200' } })
    expect(await within(panel).findByText(/already belongs to \u2068?Mary Smith/)).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Open that record' })).toHaveAttribute('href', '/employees/G200')
    expect(within(panel).getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(api.changeEmployeeId).not.toHaveBeenCalled()
  })

  it('reviews changed fields and submits only after Confirm and save', async () => {
    renderPage()
    const name = await screen.findByRole('textbox', { name: 'Name (English)' })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(name, { target: { value: 'John Smith' } })
    expect(screen.getByText('Was:')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const tray = await screen.findByRole('region', { name: 'Review changes before saving' })
    expect(within(tray).getByRole('rowheader', { name: 'Name (English)' })).toBeInTheDocument()
    expect(within(tray).getByRole('cell', { name: 'John Doe' })).toBeInTheDocument()
    expect(within(tray).getByRole('cell', { name: 'John Smith' })).toBeInTheDocument()
    expect(api.updateEmployee).not.toHaveBeenCalled()
    fireEvent.click(within(tray).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('region', { name: 'Review changes before saving' })).not.toBeInTheDocument()
    expect(api.updateEmployee).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm and save' }))
    await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledWith('G100', expect.objectContaining({ name_en: 'John Smith' })))
    expect(await screen.findByText('Employee file')).toBeInTheDocument()
    expect(screen.getByTestId('edit-location')).toHaveTextContent('/employees/G100')
  })

  it('requires the reason and matching number, then replaces the edit URL and shows confirmation', async () => {
    vi.mocked(api.getEmployeeDetail).mockImplementation(async (id) => ({ ...detail, employee: id === 'G200' ? { ...employee, id: 'G200', former_ids: ['G099', 'G100'] } : employee }) as never)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Correct employee number' }))
    fireEvent.change(screen.getByLabelText('Correct number'), { target: { value: 'g200' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Generated documents')).toBeInTheDocument()
    expect(screen.queryByText('Leave records')).not.toBeInTheDocument()
    expect(screen.getByText(/Documents already issued keep G100/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const apply = screen.getByRole('button', { name: 'Change G100 to G200' })
    expect(apply).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Correct transposed digits' } })
    fireEvent.change(screen.getByLabelText('Type G200 again to confirm'), { target: { value: 'G201' } })
    expect(apply).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Type G200 again to confirm'), { target: { value: 'G200' } })
    fireEvent.click(apply)
    await waitFor(() => expect(api.changeEmployeeId).toHaveBeenCalledWith('G100', { new_id: 'G200', reason: 'Correct transposed digits' }))
    expect(await screen.findByText(/Employee number changed from G100 to G200/)).toBeInTheDocument()
    expect(screen.getByTestId('edit-location')).toHaveTextContent('/employees/G200/edit')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss confirmation' }))
    expect(screen.queryByText(/Employee number changed from G100 to G200/)).not.toBeInTheDocument()
  })

  it('blocks the correction while profile edits are unsaved until they are discarded', async () => {
    renderPage()
    const contact = await screen.findByRole('textbox', { name: 'Contact' })
    fireEvent.change(contact, { target: { value: '0509876543' } })
    fireEvent.click(screen.getByRole('button', { name: 'Correct employee number' }))
    const panel = screen.getByRole('region', { name: 'Correct employee number' })
    fireEvent.change(within(panel).getByLabelText('Correct number'), { target: { value: 'G200' } })
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Continue' })).toBeEnabled())
    fireEvent.click(within(panel).getByRole('button', { name: 'Continue' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Continue' }))
    fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'Correct transposed digits' } })
    fireEvent.change(within(panel).getByLabelText('Type G200 again to confirm'), { target: { value: 'G200' } })
    const apply = within(panel).getByRole('button', { name: 'Change G100 to G200' })
    expect(within(panel).getByRole('alert')).toHaveTextContent(/unsaved changes/)
    expect(apply).toBeDisabled()
    fireEvent.submit(apply.closest('form')!)
    expect(api.changeEmployeeId).not.toHaveBeenCalled()
    fireEvent.click(within(panel).getByRole('button', { name: 'Discard unsaved changes' }))
    expect(await screen.findByRole('textbox', { name: 'Contact' })).toHaveValue('0501234567')
    await waitFor(() => expect(apply).toBeEnabled())
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument()
  })
})
