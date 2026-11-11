import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '@/lib/api'
import type { LeaveRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import i18n from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { EditLeaveDialog } from './EditLeaveDialog'

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>()
  return { ...mod, api: { ...mod.api, updateLeave: vi.fn() } }
})
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const leave: LeaveRead = {
  id: 5,
  employee_id: 'G1',
  employee_name_en: 'Ahmed Ali',
  employee_name_ar: 'أحمد علي',
  leave_type: 'Annual Leave',
  start_date: '2026-08-01',
  end_date: '2026-08-25',
  days: 25,
  status: 'Pending',
  notes: 'Original notes',
  request_date: null,
  doc_path: null,
  certificate_path: null,
  created_at: '2026-07-01T10:00:00',
}

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onOpenChange = vi.fn()
  const onEdited = vi.fn()
  const view = render(
    <QueryClientProvider client={qc}>
      <EditLeaveDialog open leave={leave} onOpenChange={onOpenChange} onEdited={onEdited} />
    </QueryClientProvider>,
  )
  return { ...view, qc, onOpenChange, onEdited }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(api.updateLeave).mockReset().mockResolvedValue(leave)
  await i18n.changeLanguage('en')
})

describe('EditLeaveDialog', () => {
  it('prefills dates and notes, shows inclusive days and read-only employee/type', () => {
    renderIt()
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('End date')).toHaveValue('2026-08-25')
    expect(screen.getByLabelText('Notes')).toHaveValue('Original notes')
    expect(screen.getByLabelText('Days')).toHaveValue('25')
    expect(screen.getByLabelText('Days')).toHaveAttribute('readonly')
    expect(screen.getByText('Ahmed Ali')).toBeInTheDocument()
    expect(screen.getByText('Annual Leave')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('recalculates inclusive duration from either date, including a single day', () => {
    renderIt()
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-08-10' } })
    expect(screen.getByLabelText('Days')).toHaveValue('10')
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-10' } })
    expect(screen.getByLabelText('Days')).toHaveValue('1')
  })

  it.each(['en', 'ar'])('blocks end-before-start with localized validation in %s', async (language) => {
    await i18n.changeLanguage(language)
    renderIt()
    fireEvent.change(screen.getByLabelText(i18n.t('leaves.edit.endDate')), { target: { value: '2026-07-31' } })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('leaves.edit.save') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('leaves.edit.errors.endBeforeStart'))
    expect(screen.getByLabelText(i18n.t('leaves.edit.endDate'))).toHaveAttribute('aria-invalid', 'true')
    expect(api.updateLeave).not.toHaveBeenCalled()
  })

  it('requires both dates and does not submit cleared dates', async () => {
    renderIt()
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a date.')
    expect(api.updateLeave).not.toHaveBeenCalled()
  })

  it('sends only the changed date, invalidates all leave and book queries, then closes', async () => {
    const updated = { ...leave, end_date: '2026-08-20', days: 20 }
    vi.mocked(api.updateLeave).mockResolvedValueOnce(updated)
    const { qc, onOpenChange, onEdited } = renderIt()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-08-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onEdited).toHaveBeenCalledOnce())
    expect(api.updateLeave).toHaveBeenCalledExactlyOnceWith(5, { end_date: '2026-08-20' })
    expect(qc.getQueryData(['leave', 5])).toEqual(updated)
    for (const queryKey of [['leave', 5], ['leaves-list'], ['leave-balance', 'G1'], ['books']]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey })
    }
    expect(toast.success).toHaveBeenCalledWith('Leave updated')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('sends all changed fields but omits reverted dates', async () => {
    renderIt()
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-02' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-08-26' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Changed notes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.updateLeave).toHaveBeenCalledExactlyOnceWith(5, {
      start_date: '2026-08-02', end_date: '2026-08-26', notes: 'Changed notes',
    }))
  })

  it('allows clearing notes without sending unchanged or reverted dates', async () => {
    renderIt()
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-02' } })
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.updateLeave).toHaveBeenCalledExactlyOnceWith(5, { notes: '' }))
  })

  it.each(['en', 'ar'])('shows localized LEAVE_DUPLICATE and preserves the open form in %s', async (language) => {
    await i18n.changeLanguage(language)
    vi.mocked(api.updateLeave).mockRejectedValueOnce(new ApiError(409, 'LEAVE_DUPLICATE', 'Raw backend message'))
    const { onOpenChange, onEdited } = renderIt()
    fireEvent.change(screen.getByLabelText(i18n.t('leaves.edit.endDate')), { target: { value: '2026-08-20' } })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('leaves.edit.save') }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(i18n.t('leaves.edit.errors.duplicate')))
    expect(onEdited).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText(i18n.t('leaves.edit.endDate'))).toHaveValue('2026-08-20')
  })

  it('uses Arabic employee/type labels and isolated LTR dates and day count', async () => {
    await i18n.changeLanguage('ar')
    renderIt()
    expect(screen.getByText('أحمد علي')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('leaves.type.Annual Leave'))).toBeInTheDocument()
    for (const label of ['leaves.edit.startDate', 'leaves.edit.endDate', 'leaves.columns.days']) {
      expect(screen.getByLabelText(i18n.t(label))).toHaveAttribute('dir', 'ltr')
    }
  })

  it('resets unsaved changes and picks up current notes when reopened', () => {
    const { rerender, qc, onOpenChange, onEdited } = renderIt()
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Discard this' } })
    const renderDialog = (open: boolean, currentLeave: LeaveRead) => (
      <QueryClientProvider client={qc}>
        <EditLeaveDialog open={open} leave={currentLeave} onOpenChange={onOpenChange} onEdited={onEdited} />
      </QueryClientProvider>
    )
    rerender(renderDialog(false, leave))
    rerender(renderDialog(true, { ...leave, notes: 'Current notes', end_date: '2026-08-24' }))
    expect(screen.getByLabelText('Notes')).toHaveValue('Current notes')
    expect(screen.getByLabelText('End date')).toHaveValue('2026-08-24')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })
})
