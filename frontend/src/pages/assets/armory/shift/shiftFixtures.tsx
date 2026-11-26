import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'

import type {
  ArmoryActorRead, ArmoryAssignmentLineRead, ArmoryAssignmentRead, ArmoryCountRead, ArmoryItemRef,
  ArmoryPersonCandidateRead, ArmoryPostingRead, ArmorySafeRead, ArmorySerialRead, ArmoryShiftCheckDraftRead,
  ArmoryShiftRead, ArmoryShiftWindowRead,
} from '@/lib/api'
import i18n from '@/lib/i18n'

export const instant = '2026-10-03T06:45:00+04:00'
export const testSafe: ArmorySafeRead = { id: 1, name_en: 'Test Safe A', name_ar: 'خزنة اختبار أ', vehicle_site: null, duty_post: null, created_at: instant }
export const otherSafe: ArmorySafeRead = { ...testSafe, id: 2, name_en: 'Test Safe B', name_ar: 'خزنة اختبار ب' }
export const testWindow: ArmoryShiftWindowRead = {
  time_zone: 'Asia/Dubai', shift_date: '2026-10-03', shift_kind: 'day', starts_at: '2026-10-03T02:00:00Z', ends_at: '2026-10-03T14:00:00Z',
  next_ends_at: '2026-10-04T02:00:00Z', grace_minutes: 30,
}
export const firearm: ArmoryItemRef = { id: 1, name_en: 'Test Firearm', name_ar: 'سلاح اختبار', kind: 'firearm', category: 'firearms', drawing: 'rifle' }
export const rounds: ArmoryItemRef = { id: 2, name_en: 'Test Ammunition', name_ar: 'ذخيرة اختبار', kind: 'ammunition', category: 'ammo', drawing: 'rounds' }
export const sling: ArmoryItemRef = { id: 3, name_en: 'Test Sling', name_ar: 'حمالة اختبار', kind: 'quantity', category: 'accessories', drawing: 'sling' }
export const guard = { employee_id: 'T-0002', name_en: 'Test Guard One', name_ar: 'حارس الاختبار الأول', employee_status: 'Active', is_former: false }
export const witness = { ...guard, employee_id: 'T-0003', name_en: 'Test Witness', name_ar: 'شاهد الاختبار' }
export const otherGuard = { ...guard, employee_id: 'T-0004', name_en: 'Test Guard Two', name_ar: 'حارس الاختبار الثاني' }
const armorer = { ...guard, employee_id: 'T-0001', name_en: 'Test Armorer' }
export const actor: ArmoryActorRead = { user_id: 1, employee: armorer, display_name: 'Test Armorer' }
export const candidates: ArmoryPersonCandidateRead[] = [armorer, guard, witness, otherGuard].map(person => ({
  person, on_duty_here: true, course_round: 1, licence_status: 'valid', licence_expires_on: '2027-01-01', open_firearm: null,
}))

export const serial: ArmorySerialRead = {
  id: 1, item: firearm, serial_code: 'TEST-R-0001', safe: testSafe, state: 'in_safe', state_at: instant,
  last_posting_id: 100, assignment_id: null, holder: null, overdue_minutes: null,
}
export const secondSerial: ArmorySerialRead = { ...serial, id: 2, serial_code: 'TEST-S-0001' }

export const firearmLine: ArmoryAssignmentLineRead = { id: 101, item: firearm, qty: 1, remaining_qty: 1, serial_id: 1, serial_code: serial.serial_code, batch: null }
export const roundsLine: ArmoryAssignmentLineRead = { id: 102, item: rounds, qty: 9, remaining_qty: 9, serial_id: null, serial_code: null, batch: null }
export const slingLine: ArmoryAssignmentLineRead = { id: 103, item: sling, qty: 1, remaining_qty: 1, serial_id: null, serial_code: null, batch: null }
export const issue: ArmoryAssignmentRead = {
  id: 10, record_ref: 'TEST-ISSUE-10', kind: 'shift', state: 'active', safe: testSafe,
  holder: { kind: 'person', employee: guard, site_safe: null, supervisor: null }, issuer: actor,
  issued_at: instant, due_at: '2026-10-03T08:30:00+04:00', overdue_minutes: 65, licence_warning_acknowledged: true,
  changed_kit: true, lines: [firearmLine, roundsLine, slingLine], kit_id: 1, course_round_snapshot: 1, licence_status_at_issue: 'expired',
  shift_window: testWindow, grace_minutes: 30, off_duty_reason: 'other', off_duty_note: 'Test duty change',
  excess_rounds_reason: null, condition_note: null, ended_at: null, ended_by: null,
  return_ids: [20], voided_at: null, voided_by: null, void_reason: null, receipt: null,
}
export const otherIssue: ArmoryAssignmentRead = {
  ...issue, id: 11, record_ref: 'TEST-ISSUE-11', holder: { ...issue.holder, employee: otherGuard }, return_ids: [],
  lines: [{ ...firearmLine, id: 111, serial_id: secondSerial.id, serial_code: secondSerial.serial_code }],
}

export const returnPosting: ArmoryPostingRead = {
  id: 20, record_ref: 'TEST-RETURN-20', kind: 'return', safe_id: 1, occurred_on: '2026-10-03', occurred_at: instant,
  voided_at: null, safe: testSafe, destination_safe: null, related_posting_id: issue.id, created_at: instant,
  actor, witness, person: guard, reference: null, source: null, reason: null, note: null, serial_action: null, decision_outcome: null,
  voided_by: null, void_reason: null, void_witness: null, discrepancy_ids: [200],
  lines: [{
    id: 201, item: rounds, qty: 2, serial_id: null, serial_code: null, batch: null, stock_delta: 2,
    before_on_hand: 1, after_on_hand: 3, before_state: null, after_state: null, before_safe_id: null, after_safe_id: null,
    assignment_line_id: roundsLine.id, remaining_before: 9, remaining_after: 0, condition: null, fault_note: null,
  }],
}

export const testShift: ArmoryShiftRead = {
  window: testWindow,
  safes: [{
    safe: testSafe, firearms: [{ ...serial, state: 'signed_out', assignment_id: issue.id, holder: issue.holder, overdue_minutes: issue.overdue_minutes }],
    out: [issue, otherIssue], returned_today: [{ posting: returnPosting, assignment: issue }], on_duty: candidates.slice(1, 2),
    check_history: [{ window: testWindow, status: 'due', count_id: null, missing_count: null }],
  }],
  attention: {
    now_at: '2026-10-03T09:35:00+04:00', missing_firearm_count: 1,
    missing_firearms: [{ ...secondSerial, safe: otherSafe, state: 'missing' }],
    overdue_count: 1, overdue: [issue], decision_count: 1, due_check_count: 1, expired_batch_count: 0,
    expiring_batch_count: 0, licences: { missing: 0, expired: 0, expiring: 0, valid: 1 }, former_open_count: 0,
  },
}

export const testDraft: ArmoryShiftCheckDraftRead = {
  safe: testSafe, window: testWindow, snapshot_token: 'test-check-one', expected: [serial, secondSerial],
  reconciliation: { signed_out: [], in_custody: [], in_repair: [], missing: [], lost: [], assigned_count: 2 },
}
export const savedCount: ArmoryCountRead = {
  posting: { id: 21, record_ref: 'TEST-CHECK-21', kind: 'shift_check', safe_id: 1, occurred_on: '2026-10-03', occurred_at: instant, voided_at: null },
  safe: testSafe, actor, witness, window: testWindow, month: null, reconciliation: testDraft.reconciliation, lines: [], discrepancy_ids: [],
}

export function renderArmory(ui: ReactNode, entry = '/holdings/armory?tab=shift&safe=1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const frame = (child: ReactNode) => <QueryClientProvider client={client}><I18nextProvider i18n={i18n}>
    <MemoryRouter initialEntries={[entry]}>{child}</MemoryRouter>
  </I18nextProvider></QueryClientProvider>
  const view = render(frame(ui))
  return { ...view, rerender: (child: ReactNode) => view.rerender(frame(child)) }
}
