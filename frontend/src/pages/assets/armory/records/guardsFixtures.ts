import type { ArmoryAssignmentSummary, ArmoryGuardRead, ArmoryPersonCandidateRead } from '@/lib/api'

export const testGuard: ArmoryGuardRead = {
  person: {
    employee_id: 'T-0001',
    name_en: 'Test Guard One',
    name_ar: 'حارس الاختبار الأول',
    employee_status: 'Active',
    is_former: false,
  },
  qualification: {
    version: 3,
    course_round: 4,
    licence_number: 'TEST-LICENCE-A',
    licence_expires_on: '2032-05-28',
    licence_status: 'expiring',
    licence_days_left: 10,
    updated_at: '2031-04-02T09:00:00Z',
  },
  open_assignments: [],
}

export const testEmployee: ArmoryGuardRead = {
  person: { ...testGuard.person, employee_id: 'T-0002', name_en: 'Test Employee Two', name_ar: 'موظف الاختبار الثاني' },
  qualification: {
    version: 0,
    course_round: null,
    licence_number: null,
    licence_expires_on: null,
    licence_status: 'missing',
    licence_days_left: null,
    updated_at: null,
  },
  open_assignments: [],
}

export const testCandidate: ArmoryPersonCandidateRead = {
  person: testEmployee.person,
  on_duty_here: false,
  course_round: null,
  licence_status: 'missing',
  licence_expires_on: null,
  open_firearm: null,
}

const formerPerson = {
  ...testGuard.person, employee_id: 'T-0003', name_en: 'Test Former Guard', name_ar: 'حارس اختبار سابق',
  employee_status: 'Resigned', is_former: true,
}
const custody: ArmoryAssignmentSummary = {
  id: 17,
  record_ref: 'TEST-CUSTODY-A',
  kind: 'custody',
  state: 'active',
  safe: {
    id: 5, name_en: 'Test Safe', name_ar: 'خزنة الاختبار', vehicle_site: null, duty_post: null, created_at: '2031-01-01T00:00:00Z',
  },
  holder: { kind: 'person', employee: formerPerson, site_safe: null, supervisor: null },
  issuer: { user_id: 20, employee: null, display_name: 'Test Recorder' },
  issued_at: '2031-04-02T10:00:00Z',
  due_at: null,
  overdue_minutes: null,
  licence_warning_acknowledged: false,
  changed_kit: false,
  lines: [{
    id: 12,
    item: { id: 8, name_en: 'Test Radio', name_ar: 'جهاز اختبار', kind: 'serial', category: 'comms', drawing: 'radio' },
    qty: 1,
    remaining_qty: 1,
    serial_id: 9,
    serial_code: 'TEST-SERIAL-A',
    batch: null,
  }],
}

export const testFormerGuard: ArmoryGuardRead = {
  person: formerPerson,
  qualification: testGuard.qualification,
  open_assignments: [
    custody,
    {
      ...custody,
      id: 18,
      record_ref: 'TEST-SHIFT-A',
      kind: 'shift',
      due_at: '2031-04-02T17:00:00Z',
      lines: custody.lines.map((line) => ({ ...line, id: 13, serial_id: 10, serial_code: 'TEST-SERIAL-B' })),
    },
  ],
}
