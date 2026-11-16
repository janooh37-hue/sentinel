import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { ApprovalLogItem, BookRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import i18n from '@/lib/i18n'
import { ApprovalPreviewActions } from '@/pages/books/ApprovalPreviewActions'
import { ForwardToBranchDialog } from './ForwardToBranchDialog'

const gates = vi.hoisted(() => ({ canApprove: true }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 7 } }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => gates.canApprove }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof ApiModule>()
  return { ...actual, api: { ...actual.api, getBook: vi.fn(), listBranchCandidates: vi.fn(), forwardToBranch: vi.fn(), signBook: vi.fn(), decideBook: vi.fn() } }
})

const pendingBook: BookRead = {
  id: 42, ref_number: 'FLEET-42', category_id: 'GS', subject: 'Fleet paper', direction: 'outgoing',
  stamp_style: null, created_at: '2026-11-01T09:00:00', deleted_at: null, priority: 'Normal',
  approval_state: 'pending', access_scope: 'assigned_revision', confidentiality: 'general',
  can_write: false, can_send: false, can_change_confidentiality: false, can_sign: true, can_review: false,
  is_draft: false, is_word_book: false, doc_manager_has_signature: true,
  included_papers_revision: 0, included_papers_fixed_page_count: 1, included_papers_total_page_count: 1,
  current_template_id: 'General Book', service_id: 'General Book', selected_version_id: 101,
  can_forward_to_branch: true,
  can_rebuild_vehicle_letter: false,
  versions: [{
    id: 101, version_no: 2, trigger: 'generated', status: 'pending', has_fields: true,
    template_id: 'General Book', document_id: 55, created_at: '2026-11-01T09:00:00', manager_sig_embedded: false,
    approval_steps: [{ id: 3, step_order: 0, stage_label: 'line_manager', assignee_user_id: 7, state: 'pending', note: null, decided_at: null, kind: 'approver' }],
  }],
}
const logItem: ApprovalLogItem = {
  book_id: 42, ref_number: 'FLEET-42', subject: 'Fleet paper', category_name_ar: null, category_name_en: null,
  status: 'pending', record_status: 'pending', priority: 'Normal', submitted_by_user_id: 8,
  submitted_by_name: 'Reporter', doc_manager_user_id: null, doc_manager_name: null, approver_name: 'Line manager',
  reviewer_names: [], submitted_at: '2026-11-01T09:00:00', decided_at: null, outcome_unseen: false, verdict: null,
  document_id: 55, version_id: 101, version_no: 2, assignment_version_no: 2, assigned_signer_user_id: 7, access_scope: 'assigned_revision',
}

beforeEach(async () => {
  vi.resetAllMocks()
  gates.canApprove = true
  await i18n.changeLanguage('en')
  vi.mocked(api.getBook).mockResolvedValue(pendingBook)
  vi.mocked(api.listBranchCandidates).mockResolvedValue([{ id: 9, name: 'Branch manager', name_ar: 'مدير الفرع', is_default: false }])
  vi.mocked(api.forwardToBranch).mockResolvedValue({ ...pendingBook, can_forward_to_branch: false })
})

it('forwards the chosen branch candidate and note against the current version', async () => {
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(<QueryClientProvider client={client}><ForwardToBranchDialog bookId={42} versionId={101} onClose={onClose} /></QueryClientProvider>)
  const picker = await screen.findByRole('combobox', { name: 'Branch Manager' })
  expect(api.listBranchCandidates).toHaveBeenCalledWith(42)
  await userEvent.selectOptions(picker, '9')
  await userEvent.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'Please review the vehicle allocation.')
  await userEvent.click(screen.getByRole('button', { name: 'Forward to branch manager' }))
  await waitFor(() => expect(api.forwardToBranch).toHaveBeenCalledWith(42, 101, 9, 'Please review the vehicle allocation.'))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
})

it.each([true, false])('preview exposes Forward only when the detail flag is %s', async (can_forward_to_branch) => {
  vi.mocked(api.getBook).mockResolvedValue({ ...pendingBook, can_forward_to_branch })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ApprovalPreviewActions item={logItem} onClose={vi.fn()} /></QueryClientProvider>)
  expect(await screen.findByRole('button', { name: can_forward_to_branch ? 'Approve and finish' : 'Sign & approve' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Return for changes' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Reject' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Forward to branch manager' }) !== null).toBe(can_forward_to_branch)
  expect(api.getBook).toHaveBeenCalledWith(42, 101)
})

it('hides all approval controls and avoids loading detail without books.approve', () => {
  gates.canApprove = false
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ApprovalPreviewActions item={logItem} onClose={vi.fn()} /></QueryClientProvider>)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(api.getBook).not.toHaveBeenCalled()
})
