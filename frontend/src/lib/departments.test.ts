import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'
import { ApiError, type DepartmentRead } from './api'
import { departmentDescendantIds, departmentErrorMessage, departmentName, orderDepartments } from './departments'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'

const departments: DepartmentRead[] = [
  { id: 3, parent_id: 2, name_en: 'Child', name_ar: 'فرعي', active: true, member_count: 0, employee_count: 0, service_ids: [], heads: [] },
  { id: 1, parent_id: null, name_en: 'First', name_ar: 'الأول', active: true, member_count: 0, employee_count: 0, service_ids: [], heads: [] },
  { id: 2, parent_id: 1, name_en: 'Second', name_ar: 'الثاني', active: true, member_count: 0, employee_count: 0, service_ids: [], heads: [] },
  { id: 4, parent_id: null, name_en: 'Other', name_ar: 'آخر', active: false, member_count: 0, employee_count: 0, service_ids: [], heads: [] },
]

describe('department tree', () => {
  it('orders parents before children without changing the catalogue', () => {
    expect(orderDepartments(departments).map(({ department, depth }) => [department.id, depth]))
      .toEqual([[1, 0], [2, 1], [3, 2], [4, 0]])
    expect(departments.map((department) => department.id)).toEqual([3, 1, 2, 4])
    expect(orderDepartments([])).toEqual([])
  })

  it('excludes self and all descendants but not other branches from parent choices', () => {
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
})

describe('department error messages', () => {
  it.each(['en', 'ar'])('localizes department API errors in %s without exposing server text', async (language) => {
    const i18n = createInstance()
    await i18n.init({ lng: language, resources: { en: { translation: en }, ar: { translation: ar } } })
    const t = i18n.getFixedT(language)
    const messages = language === 'ar' ? ar.departments.errors : en.departments.errors
    const expected = {
      DEPARTMENT_IN_USE: messages.inUse,
      DEPARTMENT_NAME_TAKEN: messages.nameTaken,
      DEPARTMENT_CYCLE: messages.cycle,
      DEPARTMENT_PRIMARY_REQUIRED: messages.primaryRequired,
      DEPARTMENT_MEMBERSHIP_DUPLICATE: messages.membershipDuplicate,
      DEPARTMENT_SERVICE_UNKNOWN: messages.serviceUnknown,
      DEPARTMENT_NOT_FOUND: messages.notFound,
      DEPARTMENT_OUT_OF_SCOPE: messages.outOfScope,
      EMPLOYEE_NOT_FOUND: messages.employeeNotFound,
    }
    for (const [code, message] of Object.entries(expected)) {
      expect(departmentErrorMessage(new ApiError(409, code, 'Raw English server message'), t)).toBe(message)
    }
    expect(t('access.history.actions.department_memberships')).toBe(
      language === 'ar' ? 'تم تعديل عضويات الأقسام' : 'Department memberships changed',
    )
    expect(departmentErrorMessage(new ApiError(500, 'OTHER_ERROR', 'Other message'), t)).toBe('Other message')
    expect(departmentErrorMessage('Network failed', t)).toBe('Network failed')
  })
})
