import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TemplateForm } from '@/components/application/TemplateForm'
import type { TemplateDetailResponse } from '@/components/application/types'
import { api, type ArmoryClearanceRead } from '@/lib/api'
import { AuthContext, type AuthContextValue } from '@/lib/authContext'
import i18n from '@/lib/i18n'

const caps = vi.hoisted(() => new Set<string>())
vi.mock(import('@/lib/api'), async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, api: { ...original.api, getArmoryClearance: vi.fn() } }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => caps.has(cap), isLoading: false }),
}))

const clearanceTemplateId = 'Employee Clearance Form'
const requiredCaps = [
  'armory.view', 'documents.generate', 'books.view', 'books.service.Employee Clearance Form',
]
const auth: AuthContextValue = {
  status: 'authed',
  user: {
    id: 1, employee_id: null, email: 'test@example.invalid', name_en: 'Test Operator', name_ar: null,
    position: null, department: null, photo_url: null, role: 'operator', status: 'active',
    is_admin: false, is_manager: false, has_signature: false, idle_lock_seconds: 300,
    lock_layout: 'default', scoped_role: null,
  },
  login: vi.fn(), logout: vi.fn(), refetch: vi.fn(), setUser: vi.fn(),
}
const schema: TemplateDetailResponse = {
  meta: {
    id: clearanceTemplateId, name_en: clearanceTemplateId, name_ar: 'نموذج إخلاء طرف الموظف',
    form_number: 'TEST', category: 'personnel', signing_path: 'chain',
    has_code: false, feature_minted: false, notifies_employee: false,
  },
  needs_manager: false,
  needs_submitter: false,
  fields: [{ id: 'clearance_table', type: 'clearance_table', label_en: 'Clearance', label_ar: 'إخلاء الطرف' }],
}
const firstId = 'T-0001'
const secondId = 'T-0002'
const open: ArmoryClearanceRead = {
  employee_id: firstId,
  records: [
    {
      id: 1, record_ref: 'TEST-CUSTODY-1', kind: 'custody', safe: { name_en: 'Test Safe', name_ar: 'خزنة اختبار' },
      issued_at: '2030-01-01T08:00:00Z', due_at: null,
      lines: [{ item: { name_en: 'Test Radio', name_ar: 'جهاز اختبار' }, serial_code: 'TEST-SERIAL-1', remaining_qty: 1 }],
    },
    {
      id: 2, record_ref: 'TEST-SHIFT-1', kind: 'shift', safe: { name_en: 'Second Test Safe', name_ar: 'خزنة اختبار ثانية' },
      issued_at: '2030-01-01T08:00:00Z', due_at: '2030-01-01T20:00:00Z',
      lines: [{ item: { name_en: 'Test Accessory', name_ar: 'ملحق اختبار' }, serial_code: null, remaining_qty: 2 }],
    },
  ],
}

function TestForm({ employeeId, templateId, onSubmit }: {
  employeeId: string | null
  templateId: string
  onSubmit: (values: Record<string, unknown>) => void
}) {
  const form = useForm({ defaultValues: { clearance_table: { clearance_marks: {}, clearance_remarks: {} } } })
  return (
    <form onSubmit={form.handleSubmit((values) => onSubmit(values))}>
      <TemplateForm templateId={templateId} schema={schema} form={form} employeeId={employeeId} />
      <button type="submit">Generate test form</button>
    </form>
  )
}

function renderForm(employeeId: string | null = firstId, templateId = clearanceTemplateId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, placeholderData: keepPreviousData } } })
  const onSubmit = vi.fn()
  const ui = (id: string | null) => (
    <AuthContext.Provider value={auth}>
      <QueryClientProvider client={client}>
        <MemoryRouter><TestForm employeeId={id} templateId={templateId} onSubmit={onSubmit} /></MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>
  )
  const { rerender } = render(ui(employeeId))
  return { select: (id: string | null) => rerender(ui(id)), onSubmit }
}

beforeEach(async () => {
  caps.clear()
  requiredCaps.forEach((cap) => caps.add(cap))
  vi.mocked(api.getArmoryClearance).mockReset().mockResolvedValue(open)
  await i18n.changeLanguage('en')
})

describe('Armory clearance guidance', () => {
  it.each(requiredCaps)('is hidden without %s while leaving the clearance table usable', (cap) => {
    caps.delete(cap)
    renderForm()
    expect(screen.queryByRole('region', { name: 'Armory holdings' })).not.toBeInTheDocument()
    expect(api.getArmoryClearance).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'All Cleared' })).toBeEnabled()
  })

  it.each([null, ''])('makes no request without a selected employee (%s)', (employeeId) => {
    renderForm(employeeId)
    expect(screen.queryByRole('region', { name: 'Armory holdings' })).not.toBeInTheDocument()
    expect(api.getArmoryClearance).not.toHaveBeenCalled()
  })

  it('does not run on another template with a clearance_table field', () => {
    renderForm(firstId, 'Test Other Form')
    expect(screen.queryByRole('region', { name: 'Armory holdings' })).not.toBeInTheDocument()
    expect(api.getArmoryClearance).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'All Cleared' })).toBeEnabled()
  })

  it('links each open record and its remaining lines without changing the clearance payload', async () => {
    const { onSubmit } = renderForm()
    const notice = screen.getByRole('region', { name: 'Armory holdings' })
    const custody = await within(notice).findByRole('link', { name: 'TEST-CUSTODY-1' })
    expect(api.getArmoryClearance).toHaveBeenCalledWith(firstId)
    expect(custody).toHaveAttribute('href', '/holdings/armory?tab=custody&custody=1')
    expect(within(notice).getByRole('link', { name: 'TEST-SHIFT-1' })).toHaveAttribute('href', '/holdings/armory?tab=shift&issue=2')
    expect(notice).toHaveTextContent('Custody')
    expect(notice).toHaveTextContent('Second Test Safe')
    expect(notice).toHaveTextContent('01/01/2030 12:00')
    expect(notice).toHaveTextContent('02/01/2030 00:00')
    expect(notice).toHaveTextContent('Test Radio')
    expect(notice).toHaveTextContent('TEST-SERIAL-1')
    expect(notice).toHaveTextContent(/Remaining quantity:\s*2/)
    expect(notice).toHaveClass('print:hidden')

    fireEvent.click(screen.getByRole('button', { name: 'Generate test form' }))
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith({
      clearance_table: { clearance_marks: {}, clearance_remarks: {} },
    }))

    const firstRow = screen.getAllByRole('row')[1]
    fireEvent.click(within(firstRow).getByRole('radio', { name: 'Cleared' }))
    fireEvent.change(within(firstRow).getByRole('textbox'), { target: { value: 'Test note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate test form' }))
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith({
      clearance_table: { clearance_marks: { '2_2': true }, clearance_remarks: { '2_2': 'Test note' } },
    }))
  })

  it('shows the new employee’s loading state instead of previous rows before resolving empty', async () => {
    let resolveSecond!: (result: ArmoryClearanceRead) => void
    // The ES2023 lib predates Promise.withResolvers.
    vi.mocked(api.getArmoryClearance).mockImplementation((id) => id === firstId
      ? Promise.resolve(open)
      : new Promise((resolve) => { resolveSecond = resolve }))
    const { select } = renderForm()
    expect(await screen.findByRole('link', { name: 'TEST-CUSTODY-1' })).toBeInTheDocument()

    select(secondId)
    expect(screen.getByRole('status')).toHaveTextContent('Loading armory records…')
    expect(screen.queryByRole('link', { name: 'TEST-CUSTODY-1' })).not.toBeInTheDocument()
    expect(api.getArmoryClearance).toHaveBeenLastCalledWith(secondId)
    resolveSecond({ employee_id: secondId, records: [] })
    expect(await screen.findByText('No open Armory holdings.')).toBeInTheDocument()
  })

  it('shows a scoped error and retries without submitting or marking the employee cleared', async () => {
    vi.mocked(api.getArmoryClearance).mockRejectedValue(new Error('Test network failure'))
    const { onSubmit } = renderForm()
    const notice = screen.getByRole('region', { name: 'Armory holdings' })
    expect(await within(notice).findByRole('alert')).toHaveTextContent('Could not check Armory holdings.')
    expect(within(notice).queryByText('No open Armory holdings.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate test form' })).toBeEnabled()

    vi.mocked(api.getArmoryClearance).mockResolvedValue(open)
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }))
    expect(await within(notice).findByRole('link', { name: 'TEST-CUSTODY-1' })).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
