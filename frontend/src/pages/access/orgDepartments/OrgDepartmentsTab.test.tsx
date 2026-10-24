import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AuthContextModule from '@/lib/authContext'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>(), scopeKind: 'organization' }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))

vi.mock('@/lib/authContext', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthContextModule>()),
  useAuth: () => ({ status: 'authed', user: { id: 1, department_scope_kind: capabilityState.scopeKind } }),
}))

import i18n from '@/lib/i18n'
import { api, type DepartmentRead, type OrgNodeRead } from '@/lib/api'
import { OrgTreeView } from '@/pages/employees/orgTree/OrgTreeView'
import { OrgDepartmentsTab } from './OrgDepartmentsTab'
import { PermissionsPage } from '../PermissionsPage'

const UNIT = 'Admin office'

function person(id: string, name: string, supervisor_id: string | null, over: Partial<OrgNodeRead> = {}): OrgNodeRead {
  return {
    id, name_en: name, name_ar: null, position: null, position_ar: null, department: null,
    duty_unit: UNIT, duty_post: null, status: 'Active', supervisor_id, department_id: null, ...over,
  }
}

// Mona heads Operations; Huda manages Omar inside it. Lina's line is outside every department.
const PEOPLE = [
  person('G1', 'Mona Chief', null, { head_of_department_id: 7, department_id: 7 }),
  person('G2', 'Sami Staff', 'G1', { department_id: 7 }),
  person('G5', 'Huda Manager', 'G1', { department_id: 7 }),
  person('G6', 'Omar Clerk', 'G5', { department_id: 7 }),
  person('G3', 'Lina Orphan', null, { duty_unit: 'First company' }),
  person('G4', 'Ziad Report', 'G3', { duty_unit: 'First company' }),
]

function department(over: Partial<DepartmentRead>): DepartmentRead {
  return {
    id: 7, name_en: 'Operations', name_ar: 'العمليات', head_employee_id: 'G1', head_name_en: 'Mona Chief',
    head_name_ar: null, head_user_id: 3, parent_id: null, active: true, employee_count: 4,
    deputies: [], viewers: [], service_ids: ['leave'], exception_count: 0, ...over,
  }
}

const OPERATIONS = department({})

/** Names are wrapped in Unicode isolates (see `bidi`); compare what the reader sees. */
const strip = (text: string): string => text.replace(/[\u2066-\u2069]/g, '')
const iso = (expected: string) => (content: string): boolean => strip(content) === expected

function renderAt(ui: React.ReactElement, path = '/permissions?tab=org'): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  capabilityState.allowed = new Set()
  capabilityState.scopeKind = 'organization'
  vi.spyOn(api, 'listOrgTree').mockResolvedValue(PEOPLE)
  vi.spyOn(api.departments, 'list').mockResolvedValue([OPERATIONS])
  vi.spyOn(api.departments, 'listExceptions').mockResolvedValue([])
  vi.spyOn(api.departments, 'unassignedEmployees').mockResolvedValue([])
  vi.spyOn(api.departments, 'candidateUsers').mockResolvedValue([])
  vi.spyOn(api.departments, 'serviceOptions').mockResolvedValue([{ id: 'leave', label_en: 'Leave', label_ar: 'إجازة' }] as never)
  vi.spyOn(api.departments, 'getScoping').mockResolvedValue({
    enabled: false, records_backfilled: 0, users_without_department: [],
    departments_without_receiver: [], departments_without_services: [],
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Employees org tree', () => {
  it('stays read-only even for employees.edit, and badges department heads', async () => {
    capabilityState.allowed = new Set(['employees.edit', 'departments.manage'])
    renderAt(<OrgTreeView unit={UNIT} />)

    const head = (await screen.findByText('Mona Chief')).closest('article')!
    expect(await within(head).findByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('View only')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Edit links' })).not.toBeInTheDocument()
  })
})

describe('Department register', () => {
  it('names one plain next step per department and counts coverage once per employee', async () => {
    capabilityState.allowed = new Set(['employees.view', 'departments.manage'])
    vi.mocked(api.departments.list).mockResolvedValue([
      department({ service_ids: [] }),
      department({ id: 8, name_en: 'Finance', head_employee_id: 'G5', head_name_en: 'Huda Manager', head_user_id: null, parent_id: 7 }),
      department({ id: 9, name_en: 'Archive', head_employee_id: 'G6', head_name_en: 'Omar Clerk', active: false, service_ids: [] }),
      department({ id: 10, name_en: 'Field', head_employee_id: 'G3', head_name_en: 'Lina Orphan' }),
    ])
    renderAt(<OrgDepartmentsTab />)

    const table = await screen.findByRole('table')
    const row = (name: string): HTMLElement => within(table).getByRole('button', { name }).closest('tr')!
    expect(within(row('Operations')).getByRole('button', { name: 'Choose services' })).toBeVisible()
    expect(within(row('Finance')).getByRole('button', { name: 'No one can receive Records' })).toBeVisible()
    expect(within(row('Archive')).getByText('Inactive')).toBeVisible()
    expect(within(row('Field')).getByText('Ready')).toBeVisible()
    expect(screen.getByText('4 of 6 working employees are in a department')).toBeVisible()
    expect(screen.getByText(/2 outside all departments/)).toBeVisible()

    await userEvent.click(within(row('Operations')).getByRole('button', { name: 'Choose services' }))
    expect(await screen.findByRole('dialog', { name: iso('Services: Operations') })).toBeVisible()
  })
})

describe('Guided setup', () => {
  it('suggests unit tops, splits a unit into its managers, and previews the derived department before creating it', async () => {
    capabilityState.allowed = new Set(['employees.view', 'departments.manage'])
    const create = vi.spyOn(api.departments, 'create').mockResolvedValue(department({ id: 8, name_en: 'Field team', head_employee_id: 'G5' }))
    renderAt(<OrgDepartmentsTab />, '/permissions?tab=org&view=setup&step=1')

    // Nothing is preselected; a current head is shown, not offered.
    expect(await screen.findByText(iso('Already heads Operations'))).toBeVisible()
    expect(screen.getByText('Manager + team: 2 people')).toBeVisible()
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0)
    expect(screen.queryByText('Omar Clerk')).not.toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Split this unit into departments' })[0]!)
    const managers = screen.getByRole('list', { name: 'Managers under Mona Chief' })
    expect(within(managers).getByText('Huda Manager')).toBeVisible()
    expect(within(managers).queryByText('Sami Staff')).not.toBeInTheDocument()
    await userEvent.click(within(managers).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Review 1 selection' }))

    expect(await screen.findByText(iso('Headed by Huda Manager'))).toBeVisible()
    expect(screen.getByText(iso('Part of Operations'))).toBeVisible()
    expect(screen.getByText('2 people in this department')).toBeVisible()
    expect(screen.getByText(iso('2 move from Operations'))).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Create 1 department' }))
    expect(await screen.findAllByText('Enter a department name.')).toHaveLength(2)
    expect(create).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText('English name'), 'Field team')
    await userEvent.type(screen.getByLabelText('Arabic name'), 'الفريق الميداني')
    await userEvent.click(screen.getByRole('button', { name: 'Create 1 department' }))
    expect(create).toHaveBeenCalledWith({ name_en: 'Field team', name_ar: 'الفريق الميداني', head_employee_id: 'G5' })
    expect((await screen.findAllByText('Created 1 department.')).length).toBeGreaterThan(0)
  })
})

describe('Department page', () => {
  it('explains why each person is included', async () => {
    capabilityState.allowed = new Set(['employees.view', 'departments.manage'])
    vi.mocked(api.listOrgTree).mockResolvedValue(PEOPLE.map((item) => (
      item.id === 'G3' || item.id === 'G4' ? { ...item, department_id: 7 } : item
    )))
    vi.mocked(api.departments.listExceptions).mockResolvedValue([{
      employee_id: 'G3', name_en: 'Lina Orphan', name_ar: null, department_id: 7, tree_department_id: null,
      created_by: null, created_at: '2026-10-24T00:00:00Z',
    }])
    renderAt(<OrgDepartmentsTab />, '/permissions?tab=org&view=department&dept=7')

    const table = await screen.findByRole('table')
    await within(table).findByText(iso('Follows Lina Orphan, placed by hand'))
    const why = (name: string): string => {
      const row = within(table).getAllByRole('row').find((item) => item.querySelector('td bdi')?.textContent === name)!
      return strip(row.querySelectorAll('td')[2]!.textContent!)
    }
    expect(why('Mona Chief')).toBe('Department head')
    expect(why('Omar Clerk')).toBe('Reporting structure')
    expect(why('Lina Orphan')).toBe('Placed by hand')
    expect(why('Ziad Report')).toBe('Follows Lina Orphan, placed by hand')
  })

  it('keeps an existing deputy with an inactive account visible and removable, and offers only active candidates', async () => {
    capabilityState.allowed = new Set(['employees.view', 'departments.manage'])
    vi.mocked(api.departments.list).mockResolvedValue([department({ deputies: [{ user_id: 40, display_name: 'Gone Deputy', role: 'deputy' }] })])
    vi.mocked(api.departments.candidateUsers).mockResolvedValue([
      { user_id: 41, display_name: 'Active Aide', email: 'aide@gssg.ae', employee_id: null },
    ])
    const setPeople = vi.spyOn(api.departments, 'setPeople').mockResolvedValue(OPERATIONS)
    renderAt(<OrgDepartmentsTab />, '/permissions?tab=org&view=department&dept=7&section=access')

    await userEvent.click(await screen.findByRole('button', { name: 'Choose deputies' }))
    const dialog = await screen.findByRole('dialog', { name: iso('Deputies: Operations') })
    const gone = await within(dialog).findByRole('checkbox', { name: /Gone Deputy/ })
    const aide = within(dialog).getByRole('checkbox', { name: /Active Aide/ })
    expect(gone).toBeChecked()
    expect(aide).not.toBeChecked()
    await userEvent.click(gone)
    await userEvent.click(aide)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(setPeople).toHaveBeenCalledWith(7, { deputy_user_ids: [41], viewer_user_ids: [] })
  })
})

describe('Gating', () => {
  it('gives employees.edit reporting lines but no department actions', async () => {
    capabilityState.allowed = new Set(['employees.view', 'employees.edit'])
    renderAt(<OrgDepartmentsTab />)

    expect(await screen.findByRole('heading', { name: 'Departments' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add department' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set up departments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /People placed by hand/ })).not.toBeInTheDocument()
    expect(api.departments.listExceptions).not.toHaveBeenCalled()
    expect(api.departments.getScoping).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Fix reporting lines' }))
    await userEvent.type(await screen.findByLabelText('Find an employee'), 'Sami')
    await userEvent.click(screen.getByRole('button', { name: /Sami Staff/ }))
    expect(screen.getByRole('button', { name: 'Change supervisor' })).toBeVisible()
  })

  it('gives departments.manage department actions but not reporting-line edits', async () => {
    capabilityState.allowed = new Set(['employees.view', 'departments.manage'])
    renderAt(<OrgDepartmentsTab />, '/permissions?tab=org&view=reporting')

    expect(await screen.findByRole('button', { name: 'Add department' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Fix reporting lines' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Fix reporting lines' })).not.toBeInTheDocument()
  })

  it('shows a notice instead of derived numbers without organization-wide scope, and keeps reporting lines', async () => {
    capabilityState.allowed = new Set(['employees.view', 'employees.edit', 'departments.manage'])
    capabilityState.scopeKind = 'department'
    renderAt(<OrgDepartmentsTab />, '/permissions?tab=org&view=setup&step=1')

    expect(await screen.findByText('Department setup needs organization-wide access. Ask an administrator for the All departments permission.')).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/employees are in a department/)).not.toBeInTheDocument()
    expect(screen.queryByText('Choose department heads')).not.toBeInTheDocument()
    expect(api.departments.listExceptions).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Fix reporting lines' }))
    await userEvent.type(await screen.findByLabelText('Find an employee'), 'Sami')
    await userEvent.click(screen.getByRole('button', { name: /Sami Staff/ }))
    expect(screen.getByRole('button', { name: 'Change supervisor' })).toBeVisible()
  })
})

describe('Required reads', () => {
  it('withholds previews and create actions until placements load, and offers a retry', async () => {
    capabilityState.allowed = new Set(['employees.view', 'departments.manage'])
    vi.mocked(api.departments.listExceptions).mockRejectedValueOnce(new Error('offline'))
    const create = vi.spyOn(api.departments, 'create')
    renderAt(<OrgDepartmentsTab />, '/permissions?tab=org&view=setup&step=1')

    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.queryByText('Choose department heads')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument()

    await userEvent.click(retry)
    expect(await screen.findByText('Choose department heads')).toBeVisible()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('Permissions tabs', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listAuthUsers').mockResolvedValue([])
    vi.spyOn(api, 'listTemplates').mockResolvedValue({ items: [] } as never)
    vi.spyOn(api, 'listBookClassifications').mockResolvedValue([] as never)
    vi.spyOn(api, 'listPermissionRequests').mockResolvedValue([])
  })

  it('hides the Organization & departments tab from a user lacking employees.view', async () => {
    capabilityState.allowed = new Set(['users.manage', 'employees.edit', 'departments.manage'])
    renderAt(<PermissionsPage />)

    expect(await screen.findByText('Permissions studio')).toBeVisible()
    expect(screen.queryByRole('tab', { name: 'Organization & departments' })).not.toBeInTheDocument()
    expect(api.listOrgTree).not.toHaveBeenCalled()
  })

  it('shows both tabs once employees.view is held too', async () => {
    capabilityState.allowed = new Set(['users.manage', 'employees.view', 'departments.manage'])
    renderAt(<PermissionsPage />)

    expect(await screen.findByRole('tab', { name: 'Organization & departments' })).toHaveAttribute('aria-selected', 'true')
  })
})
