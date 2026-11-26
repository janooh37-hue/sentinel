import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import type {
  ArmoryCountRead,
  ArmoryDiscrepancyRead,
  ArmoryItemRef,
  ArmoryPersonCandidateRead,
  ArmoryPersonRead,
  ArmorySafeRead,
  SessionUser,
} from '@/lib/api'
import { AuthContext } from '@/lib/authContext'
import i18n from '@/lib/i18n'

export const testInstant = '2025-02-04T10:15:00Z'

export const testUser: SessionUser = {
  id: 18,
  employee_id: 'T-0003',
  email: 'operator@example.invalid',
  name_en: 'Test Operator',
  name_ar: 'موظف الاختبار',
  position: null,
  department: null,
  photo_url: null,
  role: 'admin',
  scoped_role: null,
  status: 'active',
  is_admin: true,
  is_manager: false,
  has_signature: false,
  idle_lock_seconds: 0,
  lock_layout: '',
}

export const testSafe: ArmorySafeRead = {
  id: 7,
  name_en: 'Test Vault',
  name_ar: 'خزنة الاختبار',
  vehicle_site: null,
  duty_post: null,
  created_at: testInstant,
}

export const testAccessory: ArmoryItemRef = {
  id: 11,
  name_en: 'Test Accessory',
  name_ar: 'ملحق الاختبار',
  kind: 'quantity',
  category: 'accessories',
  drawing: 'case',
}

export const testSerialItem: ArmoryItemRef = {
  id: 12,
  name_en: 'Test Radio',
  name_ar: 'جهاز الاختبار',
  kind: 'serial',
  category: 'comms',
  drawing: 'radio',
}

export function testPerson(employeeId: string, name: string): ArmoryPersonRead {
  return {
    employee_id: employeeId,
    name_en: name,
    name_ar: null,
    employee_status: 'active',
    is_former: false,
  }
}

export const testRecorder = testPerson('T-0001', 'Test Recorder')
export const testInvolved = testPerson('T-0002', 'Test Involved Employee')
export const testWitness = testPerson('T-0004', 'Test Witness')

export function testCandidate(person: ArmoryPersonRead): ArmoryPersonCandidateRead {
  return {
    person,
    on_duty_here: true,
    course_round: null,
    licence_status: 'missing',
    licence_expires_on: null,
    open_firearm: null,
  }
}

export function testDiscrepancy(overrides: Partial<ArmoryDiscrepancyRead> = {}): ArmoryDiscrepancyRead {
  return {
    id: 51,
    kind: 'missing_serial',
    status: 'open',
    source: {
      id: 42,
      record_ref: 'TEST-CHECK-01',
      kind: 'shift_check',
      safe_id: testSafe.id,
      occurred_on: '2025-02-04',
      occurred_at: testInstant,
      voided_at: null,
    },
    safe: testSafe,
    item: testSerialItem,
    serial_id: 9,
    serial_code: 'TEST-A-01',
    assignment_line_id: null,
    person: testInvolved,
    expected_qty: 1,
    observed_qty: 0,
    recorder: { user_id: 15, employee: testRecorder, display_name: null },
    source_witness: testWitness,
    shortfall_reason: null,
    reference: null,
    note: null,
    allowed_outcomes: ['found', 'recording_error'],
    can_decide: true,
    decision: null,
    ...overrides,
  }
}

export const testCount: ArmoryCountRead = {
  posting: {
    id: 43,
    record_ref: 'TEST-COUNT-01',
    kind: 'monthly_count',
    safe_id: testSafe.id,
    occurred_on: '2025-02-04',
    occurred_at: testInstant,
    voided_at: null,
  },
  safe: testSafe,
  actor: { user_id: 15, employee: testRecorder, display_name: null },
  witness: testWitness,
  window: null,
  month: '2025-02',
  reconciliation: null,
  lines: [{
    item: testAccessory,
    expected_qty: 3,
    observed_qty: 0,
    expected_serials: [],
    observed_serial_codes: [],
    expected_unrecorded_qty: null,
    observed_unrecorded_qty: null,
  }],
  discrepancy_ids: [51],
}

export function renderAudit(node: ReactNode, href = '/holdings/armory?tab=audit') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AuthContext.Provider value={{
      status: 'authed',
      user: testUser,
      login: vi.fn(),
      logout: vi.fn(),
      refetch: vi.fn(),
      setUser: vi.fn(),
    }}>
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[href]}>{node}</MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>
    </AuthContext.Provider>,
  )
}
