import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AuthContextModule from '@/lib/authContext'

const session = vi.hoisted(() => ({ allowed: new Set<string>(), role: 'admin' }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: session.allowed,
    isLoading: false,
    has: (capability: string) => session.allowed.has(capability),
  }),
}))

vi.mock('@/lib/authContext', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthContextModule>()),
  useAuth: () => ({ status: 'authed', user: { id: 1, role: session.role, department_scope_kind: 'organization' } }),
}))

import i18n from '@/lib/i18n'
import { api, type AccountAccessRead, type DepartmentRead, type OrgNodeRead } from '@/lib/api'
import { OrgDepartmentsTab } from './OrgDepartmentsTab'

const strip = (text: string): string => text.replace(/[\u2066-\u2069]/g, '')
const iso = (expected: string) => (content: string): boolean => strip(content) === expected

function person(id: string, name: string, supervisor_id: string | null, over: Partial<OrgNodeRead> = {}): OrgNodeRead {
  return {
    id, name_en: name, name_ar: null, position: null, position_ar: null, department: null,
    duty_unit: 'Admin office', duty_post: null, status: 'Active', supervisor_id, department_id: null, ...over,
  }
}

const PEOPLE = [
  person('G1', 'Mona Chief', null, { department_id: 7, head_of_department_id: 7 }),
  person('G5', 'Huda Manager', 'G1', { department_id: 7 }),
  person('G6', 'Omar Clerk', 'G5', { department_id: 7 }),
  person('G3', 'Lina Orphan', null, { duty_unit: 'First company', position: 'Tree title', position_ar: 'لقب الشجرة' }),
  person('G4', 'Ziad Report', 'G3', { duty_unit: 'First company' }),
]

const OPERATIONS: DepartmentRead = {
  id: 7, name_en: 'Operations', name_ar: 'العمليات', head_employee_id: 'G1', head_name_en: 'Mona Chief',
  head_name_ar: null, head_user_id: 3, parent_id: null, active: true, employee_count: 3,
  deputies: [], viewers: [{ user_id: 13, display_name: 'Viewer Vera', role: 'viewer' }], service_ids: ['leave'], exception_count: 0,
}

function account(user_id: number, display_name: string, over: Partial<AccountAccessRead> = {}): AccountAccessRead {
  return {
    user_id, display_name, email: `${display_name.split(' ')[0]!.toLowerCase()}@gssg.ae`, role: 'operator',
    employee_id: null, employee_name_en: null, employee_name_ar: null, position: null, position_ar: null, designation_en: null, designation_ar: null,
    duty_unit: null, reports_to_name_en: null, reports_to_name_ar: null, sees: 'self', organization_reason: null,
    team_size: 0, visible_count: 1, departments: [], receives_department_records: [], ...over,
  }
}

const ACCOUNTS: AccountAccessRead[] = [
  account(1, 'Admin Amal', { role: 'admin', sees: 'organization', organization_reason: 'admin', visible_count: 5 }),
  account(2, 'Aisha Wide', { sees: 'organization', organization_reason: 'all_departments', visible_count: 5 }),
  account(3, 'Saeed Lead', {
    employee_id: 'G1', employee_name_en: 'Saeed Lead', designation_en: 'Project Manager', designation_ar: 'مدير المشروع', sees: 'branch',
    team_size: 70, visible_count: 71,
  }),
  account(4, 'Huda Manager', {
    employee_id: 'G5', employee_name_en: 'Huda Manager', position: 'Operations lead', position_ar: 'قائدة العمليات',
    designation_en: 'Branch Manager', designation_ar: 'مدير فرع', sees: 'department',
    visible_count: 40, reports_to_name_en: 'Mona Chief',
    departments: [{ department_id: 7, name_en: 'Operations', name_ar: 'العمليات', role: 'deputy', sub_department_count: 2 }],
    receives_department_records: [7],
  }),
  account(5, 'Omar Clerk', { employee_id: 'G6', employee_name_en: 'Omar Clerk', designation_en: 'Guard', reports_to_name_en: 'Huda Manager' }),
  account(6, 'Nadia Unlinked'),
  account(13, 'Viewer Vera', {
    employee_id: 'G4', employee_name_en: 'Viewer Vera', sees: 'department', visible_count: 3,
    departments: [{ department_id: 7, name_en: 'Operations', name_ar: 'العمليات', role: 'viewer', sub_department_count: 0 }],
  }),
  account(8, 'Hana Head', {
    employee_id: 'G1', employee_name_en: 'Mona Chief', sees: 'department', visible_count: 3,
    departments: [{ department_id: 7, name_en: 'Operations', name_ar: 'العمليات', role: 'head', sub_department_count: 0 }],
  }),
  account(9, 'Rami Role', { role: 'manager', sees: 'organization', organization_reason: 'all_departments', visible_count: 5 }),
]

function renderTab(path = '/permissions?tab=org'): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><OrgDepartmentsTab /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const rowOf = async (name: string): Promise<HTMLElement> =>
  (await screen.findByRole('table')).querySelector<HTMLElement>(`tr[data-account="${name}"]`)!

beforeEach(async () => {
  await i18n.changeLanguage('en')
  window.localStorage.clear()
  session.allowed = new Set(['employees.view', 'employees.edit', 'departments.manage', 'users.manage'])
  session.role = 'admin'
  vi.spyOn(api, 'listOrgTree').mockResolvedValue(PEOPLE)
  vi.spyOn(api.departments, 'list').mockResolvedValue([OPERATIONS])
  vi.spyOn(api.departments, 'listExceptions').mockResolvedValue([])
  vi.spyOn(api.departments, 'getScoping').mockResolvedValue({
    enabled: false, records_backfilled: 0, users_without_department: [],
    departments_without_receiver: [], departments_without_services: [],
  })
  vi.spyOn(api.departments, 'accountAccess').mockResolvedValue({
    limits_enabled: false,
    accounts: ACCOUNTS,
    unattached_units: [{
      top_employee_id: 'G3', name_en: 'Lina Orphan', name_ar: 'لينا', position: 'Profile title', position_ar: 'لقب الملف',
      designation_en: 'Commander', designation_ar: 'قائد', duty_unit: 'First company', team_size: 2, team_with_manager: 3,
    }],
  })
  vi.spyOn(api, 'getUserPermissions').mockImplementation(async (id: number) => ({
    user_id: id, role: id === 9 ? 'manager' : 'operator', is_admin: false, effective: ['departments.all'],
    role_defaults: id === 9 ? ['departments.all'] : [],
    overrides: id === 2 ? { 'departments.all': 'grant' } : {},
  }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Accounts', () => {
  it('is the default sub-section and says what each account sees in plain words', async () => {
    renderTab()

    expect(await screen.findByRole('tab', { name: 'Accounts' })).toHaveAttribute('aria-selected', 'true')
    const sees = async (name: string): Promise<string> => strip((await rowOf(name)).querySelector('[data-sees]')!.textContent!)
    expect(await sees('Admin Amal')).toBe('Everything (admin)')
    expect(await sees('Aisha Wide')).toBe('Everything (All departments permission)')
    expect(await sees('Saeed Lead')).toBe("Saeed Lead's team · 71 people")
    expect(await sees('Huda Manager')).toBe('Department: Operations (+2 sub-departments) · 40 people')
    expect(await sees('Omar Clerk')).toBe('Own work only')
    expect(within(await rowOf('Huda Manager')).getByText('Yes')).toBeVisible()

    await userEvent.click(within(await rowOf('Huda Manager')).getByRole('button', { name: 'Why' }))
    expect(within(await rowOf('Huda Manager')).getByText(iso('Reports to Mona Chief'))).toBeVisible()
    expect(within(await rowOf('Huda Manager')).getByText(iso('Deputy of Operations'))).toBeVisible()
  })

  it('lists units that report to nobody and opens Reporting lines on the chosen person', async () => {
    renderTab()

    expect(await screen.findByText('1 unit reports to nobody: its people are visible only to admins and to people inside it.')).toBeVisible()
    // Same convention as Reporting lines and setup; the title follows the org tree: position first.
    const unit = screen.getByRole('button', { name: iso('Set who Lina Orphan reports to') }).closest('li')!
    expect(strip(unit.textContent!)).toBe('Lina Orphan · Profile title · First company · Manager + team: 3 peopleSet who Lina Orphan reports to')
    await userEvent.click(screen.getByRole('button', { name: iso('Set who Lina Orphan reports to') }))

    expect(await screen.findByRole('tab', { name: 'Reporting lines' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Lina Orphan' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Change supervisor' })).toBeVisible()
  })

  it('shows unit titles and team counts in Arabic by the same rule', async () => {
    await i18n.changeLanguage('ar')
    renderTab()

    const unit = (await screen.findByRole('button', { name: iso('تحديد من يتبعه لينا') })).closest('li')!
    expect(strip(unit.textContent!)).toContain('لينا · لقب الملف · First company · المدير وفريقه: 3 موظفين')
  })

  it('titles accounts like the org tree: position when set, else the roster designation', async () => {
    renderTab()
    expect(within(await rowOf('Huda Manager')).getByText('Operations lead')).toBeVisible()
    expect(within(await rowOf('Saeed Lead')).getByText('Project Manager')).toBeVisible()

    cleanup()
    await i18n.changeLanguage('ar')
    renderTab()
    expect(within(await rowOf('Huda Manager')).getByText('قائدة العمليات')).toBeVisible()
    expect(within(await rowOf('Saeed Lead')).getByText('مدير المشروع')).toBeVisible()
  })

  it('gives an account extra access to an existing department and removes it again', async () => {
    const setPeople = vi.spyOn(api.departments, 'setPeople').mockResolvedValue(OPERATIONS)
    renderTab()

    await userEvent.click(within(await rowOf('Omar Clerk')).getByRole('button', { name: 'Give more access…' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: /Extra access to a department/ }))
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Department' }), '7')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Give access' }))
    expect(setPeople).toHaveBeenCalledWith(7, { deputy_user_ids: [], viewer_user_ids: [13, 5] })

    await userEvent.click(within(await rowOf('Viewer Vera')).getByRole('button', { name: iso('Remove extra access to Operations') }))
    expect(setPeople).toHaveBeenLastCalledWith(7, { deputy_user_ids: [], viewer_user_ids: [] })
  })

  it("returns to Give access after creating a department from a manager's team, and grants only on confirmation", async () => {
    const created: DepartmentRead = { ...OPERATIONS, id: 9, name_en: 'Field team', head_employee_id: 'G5', viewers: [] }
    const create = vi.spyOn(api.departments, 'create').mockResolvedValue(created)
    const setPeople = vi.spyOn(api.departments, 'setPeople').mockResolvedValue(created)
    renderTab()

    await userEvent.click(within(await rowOf('Omar Clerk')).getByRole('button', { name: 'Give more access…' }))
    let dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: /Deputy of a department/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: "Choose a manager's team" }))
    await userEvent.type(within(dialog).getByLabelText('Whose team?'), 'Huda')
    await userEvent.click(within(dialog).getByRole('button', { name: /Huda Manager/ }))

    const add = await screen.findByRole('dialog', { name: 'Add department' })
    expect(within(add).getByText(iso('Head: Huda Manager'))).toBeVisible()
    expect(within(add).getByText(iso('After creating it, you choose what Omar Clerk gets in this department.'))).toBeVisible()
    expect(within(add).getByLabelText('English name')).toHaveValue('')
    await userEvent.type(within(add).getByLabelText('English name'), 'Field team')
    await userEvent.type(within(add).getByLabelText('Arabic name'), 'الفريق الميداني')
    await userEvent.click(within(add).getByRole('button', { name: 'Create department' }))
    expect(create).toHaveBeenCalledWith({ name_en: 'Field team', name_ar: 'الفريق الميداني', head_employee_id: 'G5' })

    dialog = await screen.findByRole('dialog', { name: iso('Give more access: Omar Clerk') })
    expect(within(dialog).getByRole('combobox', { name: 'Department' })).toHaveValue('9')
    expect(within(dialog).getByRole('radio', { name: /Deputy of a department/ })).toBeChecked()
    expect(setPeople).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Give access' }))
    expect(setPeople).toHaveBeenCalledWith(9, { deputy_user_ids: [5], viewer_user_ids: [] })
  })

  it('starts Give access with no role chosen and leaves out departments the account heads', async () => {
    renderTab()

    await userEvent.click(within(await rowOf('Hana Head')).getByRole('button', { name: 'Give more access…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryAllByRole('radio', { checked: true })).toHaveLength(0)
    expect(within(dialog).getByRole('button', { name: 'Give access' })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('radio', { name: /Extra access to a department/ }))
    const options = within(within(dialog).getByRole('combobox', { name: 'Department' })).getAllByRole('option').map((option) => option.getAttribute('value'))
    expect(options).not.toContain('7')
  })

  it('offers whole-organization access only with users.manage, and linking only to admins', async () => {
    const grant = vi.spyOn(api, 'setUserPermission').mockResolvedValue({} as never)
    const link = vi.spyOn(api, 'setAuthUserLink').mockResolvedValue({} as never)
    renderTab()

    expect(within(await rowOf('Omar Clerk')).queryByRole('button', { name: 'Link to employee…' })).not.toBeInTheDocument()
    await userEvent.click(within(await rowOf('Nadia Unlinked')).getByRole('button', { name: 'Link to employee…' }))
    let dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Employee'), 'Ziad')
    await userEvent.click(within(dialog).getByRole('button', { name: /Ziad Report/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Link' }))
    expect(link).toHaveBeenCalledWith(6, 'G4')

    await userEvent.click(within(await rowOf('Omar Clerk')).getByRole('button', { name: 'Give more access…' }))
    dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: /Whole organization/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Give access' }))
    expect(grant).toHaveBeenCalledWith(5, 'departments.all', 'grant')
  })

  it('says where whole-organization access comes from and removes it truthfully', async () => {
    const set = vi.spyOn(api, 'setUserPermission').mockResolvedValue({} as never)
    renderTab()

    const given = await rowOf('Aisha Wide')
    expect(await within(given).findByText('Given to this account')).toBeVisible()
    await userEvent.click(within(given).getByRole('button', { name: 'Remove whole-organization access' }))
    expect(set).toHaveBeenLastCalledWith(2, 'departments.all', null)

    const fromRole = await rowOf('Rami Role')
    expect(await within(fromRole).findByText(iso('From the Manager role'))).toBeVisible()
    await userEvent.click(within(fromRole).getByRole('button', { name: 'Turn off whole-organization access for this account' }))
    expect(set).toHaveBeenLastCalledWith(9, 'departments.all', 'deny')
  })

  it('hides the override and linking from a department manager who is not an admin', async () => {
    session.allowed = new Set(['employees.view', 'departments.manage'])
    session.role = 'manager'
    renderTab()

    expect(within(await rowOf('Nadia Unlinked')).queryByRole('button', { name: 'Link to employee…' })).not.toBeInTheDocument()
    expect(within(await rowOf('Nadia Unlinked')).getByText(/only their own work/)).toBeVisible()
    expect(within(await rowOf('Aisha Wide')).queryByRole('button', { name: /whole-organization access/ })).not.toBeInTheDocument()
    expect(api.getUserPermissions).not.toHaveBeenCalled()
    await userEvent.click(within(await rowOf('Omar Clerk')).getByRole('button', { name: 'Give more access…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('radio', { name: /Whole organization/ })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Whole-organization access needs an administrator. Ask one to give this account the All departments permission.')).toBeVisible()
  })

  it('offers to set who a unit reports to only with employees.edit', async () => {
    session.allowed = new Set(['employees.view', 'departments.manage'])
    renderTab()

    expect(await screen.findByText(/1 unit reports to nobody/)).toBeVisible()
    expect(screen.queryByRole('button', { name: iso('Set who Lina Orphan reports to') })).not.toBeInTheDocument()
    expect(screen.getByText('Changing reporting lines needs the Edit employees permission.')).toBeVisible()
  })

  it('states a missing employee link, and claims own work only when that is what the account sees', async () => {
    renderTab()

    const admin = await rowOf('Admin Amal')
    expect(within(admin).getByText('Not linked to an employee')).toBeVisible()
    expect(within(admin).queryByText(/only their own work/)).not.toBeInTheDocument()
    expect(within(await rowOf('Nadia Unlinked')).getByText('Not linked to an employee: this account sees only their own work.')).toBeVisible()
  })

  it('asks before section tabs discard setup choices, and locks them while a batch runs', async () => {
    // A create that never settles keeps the batch running (lib is pre-ES2024: no withResolvers).
    vi.spyOn(api.departments, 'create').mockReturnValue(new Promise<DepartmentRead>(() => {}))
    renderTab('/permissions?tab=org&view=setup&step=1')

    await userEvent.type(await screen.findByLabelText('Find another manager'), 'Huda')
    await userEvent.click(screen.getByRole('button', { name: /Huda Manager/ }))
    await userEvent.click(screen.getByRole('tab', { name: 'Accounts' }))
    const confirm = await screen.findByRole('dialog', { name: 'Leave setup?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('tab', { name: 'Departments' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Review 1 selection' }))
    await userEvent.type(await screen.findByLabelText('English name'), 'Field team')
    await userEvent.type(screen.getByLabelText('Arabic name'), 'الفريق الميداني')
    await userEvent.click(screen.getByRole('button', { name: 'Create 1 department' }))
    await vi.waitFor(() => expect(screen.getByRole('tab', { name: 'Accounts' })).toBeDisabled())
  })

  it('offers the same sections, with the same guards, as a compact picker for phones', async () => {
    vi.spyOn(api.departments, 'create').mockReturnValue(new Promise<DepartmentRead>(() => {}))
    renderTab('/permissions?tab=org&view=setup&step=1')

    const picker = await screen.findByRole('combobox', { name: 'Organization & departments sections' })
    expect(within(picker).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Accounts', 'Departments', 'Reporting lines', 'Placed by hand'])
    expect(picker).toHaveValue('departments')

    await userEvent.type(await screen.findByLabelText('Find another manager'), 'Huda')
    await userEvent.click(screen.getByRole('button', { name: /Huda Manager/ }))
    await userEvent.selectOptions(picker, 'accounts')
    const confirm = await screen.findByRole('dialog', { name: 'Leave setup?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(picker).toHaveValue('departments')

    await userEvent.click(screen.getByRole('button', { name: 'Review 1 selection' }))
    await userEvent.type(await screen.findByLabelText('English name'), 'Field team')
    await userEvent.type(screen.getByLabelText('Arabic name'), 'الفريق الميداني')
    await userEvent.click(screen.getByRole('button', { name: 'Create 1 department' }))
    await vi.waitFor(() => expect(picker).toBeDisabled())
  })
})
