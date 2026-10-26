import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'
import { ApiError, apiErrorMessage, type AdminUserRead, type DepartmentRead, type UserDepartmentRead } from './api'
import {
  departmentDescendantIds,
  departmentErrorMessage,
  departmentHasReceiver,
  departmentName,
  groupDepartmentUsers,
  orderDepartments,
  visibleDepartmentIds,
} from './departments'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'

function department(id: number, parent_id: number | null, over: Partial<DepartmentRead> = {}): DepartmentRead {
  return {
    id, parent_id, name_en: `Department ${id}`, name_ar: `قسم ${id}`, active: true,
    head_employee_id: `G${id}`, head_name_en: `Head ${id}`, head_name_ar: null, head_user_id: null,
    employee_count: 0, deputies: [], viewers: [], service_ids: [], exception_count: 0, ...over,
  }
}

const departments: DepartmentRead[] = [
  department(3, 2, { name_en: 'Child', name_ar: 'فرعي' }),
  department(1, null),
  department(2, 1),
  department(4, null, { active: false }),
]

describe('department tree', () => {
  it('orders parents before children without changing the catalogue', () => {
    expect(orderDepartments(departments).map(({ department, depth }) => [department.id, depth]))
      .toEqual([[1, 0], [2, 1], [3, 2], [4, 0]])
    expect(departments.map((department) => department.id)).toEqual([3, 1, 2, 4])
    expect(orderDepartments([])).toEqual([])
  })

  it('collects a department and all of its nested departments', () => {
    expect([...departmentDescendantIds(departments, 2)]).toEqual([2, 3])
    expect(departmentDescendantIds(departments, 1)).toEqual(new Set([1, 2, 3]))
  })

  it('keeps orphaned departments visible and terminates on malformed cycles', () => {
    const malformed = departments.map((department) => ({
      ...department,
      parent_id: department.id === 1 ? 3 : department.id === 4 ? 99 : department.parent_id,
    }))
    expect(orderDepartments(malformed).map(({ department }) => department.id)).toEqual([4, 3, 1, 2])
    expect(departmentDescendantIds(malformed, 1)).toEqual(new Set([1, 2, 3]))
  })

  it('uses the current UI language for department names', () => {
    expect(departmentName(departments[0]!, 'ar-AE')).toBe('فرعي')
    expect(departmentName(departments[0]!, 'en')).toBe('Child')
  })

  it('gives heads and deputies nested departments, viewers only theirs, and members none', () => {
    const grant = (department_id: number, role: UserDepartmentRead['role']): UserDepartmentRead =>
      ({ department_id, name_en: '', name_ar: '', role })
    expect(visibleDepartmentIds(departments, [grant(1, 'member')])).toEqual(new Set())
    expect(visibleDepartmentIds(departments, [grant(1, 'head')])).toEqual(new Set([1, 2, 3]))
    expect(visibleDepartmentIds(departments, [grant(2, 'deputy')])).toEqual(new Set([2, 3]))
    expect(visibleDepartmentIds(departments, [grant(1, 'viewer'), grant(4, 'viewer')])).toEqual(new Set([1, 4]))
    expect(visibleDepartmentIds(departments, [])).toEqual(new Set())
  })

  it('needs a head account or a deputy to receive a department send', () => {
    expect(departmentHasReceiver(department(1, null))).toBe(false)
    expect(departmentHasReceiver(department(1, null, { head_user_id: 9 }))).toBe(true)
    expect(departmentHasReceiver(department(1, null, { deputies: [{ user_id: 5, display_name: 'D', role: 'deputy' }] }))).toBe(true)
  })
})

describe('department user grouping', () => {
  function user(id: number, departments: UserDepartmentRead[]): AdminUserRead {
    return {
      id, email: `${id}@example.com`, employee_id: null, display_name: null, name_en: null,
      role: 'operator', status: 'active', failed_attempts: 0, last_login_at: null, created_at: null,
      is_default_manager: false, password_change_required: false, departments,
    }
  }
  const grant = (department_id: number, role: UserDepartmentRead['role']): UserDepartmentRead =>
    ({ department_id, name_en: `Department ${department_id}`, name_ar: 'قسم', role })

  it('groups by the tree department, puts users without one first, and filters across grants', () => {
    const users = [user(1, [grant(2, 'viewer'), grant(1, 'member')]), user(2, []), user(3, [grant(2, 'head')])]
    expect(groupDepartmentUsers(users, 'all').map(([id, rows]) => [id, rows.map((u) => u.id)])).toEqual([[null, [2]], [1, [1]], [2, [3]]])
    expect(groupDepartmentUsers(users, 'none').map(([, rows]) => rows.map((u) => u.id))).toEqual([[2]])
    expect(groupDepartmentUsers(users, 2).map(([, rows]) => rows.map((u) => u.id))).toEqual([[1, 3]])
  })
})

describe('department error messages', () => {
  it.each(['en', 'ar'])('localizes department API errors in %s without exposing server text', async (language) => {
    const i18n = createInstance()
    await i18n.init({ lng: language, resources: { en: { translation: en }, ar: { translation: ar } } })
    const t = i18n.getFixedT(language)
    const messages = language === 'ar' ? ar.departments.errors : en.departments.errors
    const sendMessages = language === 'ar' ? ar.books.send.errors : en.books.send.errors
    const expected = {
      DEPARTMENT_IN_USE: messages.inUse,
      DEPARTMENT_NAME_TAKEN: messages.nameTaken,
      DEPARTMENT_HEAD_TAKEN: messages.headTaken,
      DEPARTMENT_HEAD_EXCEPTION: messages.headException,
      DEPARTMENT_SERVICE_UNKNOWN: messages.serviceUnknown,
      DEPARTMENT_NOT_FOUND: messages.notFound,
      DEPARTMENT_OUT_OF_SCOPE: messages.outOfScope,
      EMPLOYEE_NOT_FOUND: messages.employeeNotFound,
      PERSONAL_DEPARTMENT_SEND: sendMessages.personalDepartment,
      DEPARTMENT_HAS_NO_HEAD: sendMessages.noHead,
      DEPARTMENT_NO_CLEARED_HEAD: sendMessages.noClearedHead,
      DEPARTMENT_SEND_REVOKED: sendMessages.revoked,
      DISTRIBUTE_NOT_MEMBER: sendMessages.notMember,
      DISTRIBUTE_NOT_SUBDEPARTMENT: sendMessages.notSubdepartment,
      DEPARTMENT_SEND_NOT_FOUND: sendMessages.sendNotFound,
    }
    for (const [code, message] of Object.entries(expected)) {
      expect(departmentErrorMessage(new ApiError(409, code, 'Raw English server message'), t)).toBe(message)
    }
    expect(departmentErrorMessage(new ApiError(500, 'OTHER_ERROR', 'Other message'), t)).toBe('Other message')
    expect(departmentErrorMessage('Network failed', t)).toBe(apiErrorMessage('Network failed'))
    expect(departmentErrorMessage(new TypeError('Network failed'), t)).toBe(apiErrorMessage(new TypeError('Network failed')))
    const pendingAccount = new ApiError(403, 'ACCOUNT_PENDING', 'Raw English server message')
    expect(departmentErrorMessage(pendingAccount, t)).toBe(apiErrorMessage(pendingAccount))
  })
})
