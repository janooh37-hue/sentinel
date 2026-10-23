import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))

import i18n from '@/lib/i18n'
import { api, type DepartmentRead, type OrgNodeRead } from '@/lib/api'
import { OrgTreeView } from '@/pages/employees/orgTree/OrgTreeView'
import { OrgDepartmentsTab } from './OrgDepartmentsTab'

const UNIT = 'Admin office'

function person(id: string, name: string, supervisor_id: string | null, over: Partial<OrgNodeRead> = {}): OrgNodeRead {
  return {
    id, name_en: name, name_ar: null, position: null, position_ar: null, department: null,
    duty_unit: UNIT, duty_post: null, status: 'Active', supervisor_id, ...over,
  }
}

const PEOPLE = [
  person('G1', 'Mona Chief', null, { head_of_department_id: 7, department_id: 7 }),
  person('G2', 'Sami Staff', 'G1', { department_id: 7 }),
]

const OPERATIONS: DepartmentRead = {
  id: 7, name_en: 'Operations', name_ar: 'العمليات', head_employee_id: 'G1', head_name_en: 'Mona Chief',
  head_name_ar: null, head_user_id: 3, parent_id: null, active: true, employee_count: 2,
  deputies: [], viewers: [], service_ids: [], exception_count: 0,
}

function renderWithClient(ui: React.ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/permissions?tab=org&unit=${encodeURIComponent(UNIT)}`]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  capabilityState.allowed = new Set()
  vi.spyOn(api, 'listOrgTree').mockResolvedValue(PEOPLE)
  vi.spyOn(api, 'listEmployees').mockResolvedValue({
    items: PEOPLE.map((p) => ({ id: p.id, name_en: p.name_en, name_ar: null, status: 'Active', department: null, position: null, has_photo: false, duty_unit: UNIT })),
    total: PEOPLE.length,
  } as never)
  vi.spyOn(api.departments, 'list').mockResolvedValue([OPERATIONS])
  vi.spyOn(api.departments, 'listExceptions').mockResolvedValue([])
  vi.spyOn(api.departments, 'unassignedEmployees').mockResolvedValue([])
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
    renderWithClient(<OrgTreeView unit={UNIT} />)

    const head = (await screen.findByText('Mona Chief')).closest('article')!
    expect(await within(head).findByText('Head of Operations')).toBeInTheDocument()
    expect(screen.getByText('View only')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Edit links' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Department actions/ })).not.toBeInTheDocument()
  })
})

describe('Organization & departments editor', () => {
  it('lets employees.edit relink supervisors but hides department actions', async () => {
    capabilityState.allowed = new Set(['employees.edit'])
    renderWithClient(<OrgDepartmentsTab />)

    expect(await screen.findByRole('button', { name: 'Edit links' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Department actions/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Departments and exceptions' })).not.toBeInTheDocument()
    expect(api.departments.listExceptions).not.toHaveBeenCalled()
  })

  it('offers department actions to departments.manage without supervisor relinking', async () => {
    capabilityState.allowed = new Set(['departments.manage'])
    renderWithClient(<OrgDepartmentsTab />)

    expect(await screen.findByRole('complementary', { name: 'Departments and exceptions' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Edit links' })).not.toBeInTheDocument()

    const staff = (await screen.findByText('Sami Staff')).closest('article')!
    await userEvent.click(within(staff).getByRole('button', { name: 'Department actions for Sami Staff' }))
    expect(await screen.findByRole('menuitem', { name: 'Make department head…' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Edit department…' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    const head = screen.getByText('Mona Chief', { selector: 'article p' }).closest('article')!
    await userEvent.click(within(head).getByRole('button', { name: 'Department actions for Mona Chief' }))
    expect(await screen.findByRole('menuitem', { name: 'Edit department…' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Deputies & department viewers…' })).toBeVisible()
    // An active department's head cannot take an exception.
    expect(screen.queryByRole('menuitem', { name: 'Place in a department…' })).not.toBeInTheDocument()
  })
})
