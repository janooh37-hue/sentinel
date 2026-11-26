import type { ArmoryMovementLineRead, ArmoryPersonRead, ArmoryPostingRead, ArmorySafeRead } from '@/lib/api'
import type { AuthContextValue } from '@/lib/authContext'

export const movementAuth: AuthContextValue = {
  user: {
    id: 71, email: 'movements@example.test', employee_id: null, name_en: 'Test User', name_ar: null,
    position: null, department: null, photo_url: null, role: 'operator', scoped_role: null,
    status: 'active', is_admin: false, is_manager: false, has_signature: false, idle_lock_seconds: 0, lock_layout: '',
  },
  status: 'authed',
  login: async () => { throw new Error('Login not used by movement tests') },
  logout: async () => {},
  refetch: async () => {},
  setUser: () => {},
}

export const movementInstant = '2026-02-13T14:05:00Z'

export const movementSafe: ArmorySafeRead = {
  id: 6,
  name_en: 'Test Safe One',
  name_ar: 'خزنة اختبار أولى',
  vehicle_site: null,
  duty_post: null,
  created_at: movementInstant,
}

export const movementWitness: ArmoryPersonRead = {
  employee_id: 'T-0001',
  name_en: 'Test Witness One',
  name_ar: 'شاهد الاختبار الأول',
  employee_status: 'active',
  is_former: false,
}

export const voidWitness: ArmoryPersonRead = {
  ...movementWitness,
  employee_id: 'T-0002',
  name_en: 'Test Witness Two',
  name_ar: 'شاهد الاختبار الثاني',
}

export function movementFixture(overrides: Partial<ArmoryPostingRead> = {}): ArmoryPostingRead {
  return {
    id: 31,
    record_ref: 'TEST-MOV-031',
    kind: 'receipt',
    safe_id: movementSafe.id,
    occurred_on: '2026-02-13',
    occurred_at: movementInstant,
    voided_at: null,
    safe: movementSafe,
    destination_safe: null,
    related_posting_id: null,
    created_at: movementInstant,
    actor: { user_id: 2, employee: null, display_name: 'Test Recorder One' },
    witness: null,
    person: null,
    reference: null,
    source: null,
    reason: null,
    note: null,
    serial_action: null,
    decision_outcome: null,
    voided_by: null,
    void_reason: null,
    void_witness: null,
    lines: [],
    discrepancy_ids: [],
    ...overrides,
  }
}

export function movementLineFixture(overrides: Partial<ArmoryMovementLineRead> = {}): ArmoryMovementLineRead {
  return {
    id: 4,
    item: { id: 28, name_en: 'Test Radio', name_ar: 'جهاز اتصال اختباري', kind: 'serial', category: 'comms', drawing: 'radio' },
    qty: 1,
    serial_id: 19,
    serial_code: 'TEST-SERIAL-019',
    batch: null,
    stock_delta: 0,
    before_on_hand: null,
    after_on_hand: null,
    before_state: 'in_safe',
    after_state: 'in_safe',
    before_safe_id: 6,
    after_safe_id: 7,
    assignment_line_id: null,
    remaining_before: null,
    remaining_after: null,
    condition: null,
    fault_note: null,
    ...overrides,
  }
}
