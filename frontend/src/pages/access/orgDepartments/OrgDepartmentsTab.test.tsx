import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AuthContextModule from '@/lib/authContext'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))

vi.mock('@/lib/authContext', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthContextModule>()),
  useAuth: () => ({ status: 'authed', user: { id: 1 } }),
}))

import i18n from '@/lib/i18n'
// jsdom has no Web Animations; "Show in tree" pulses the centred card.
Element.prototype.animate ??= vi.fn() as never
import { api, type DepartmentRead, type OrgNodeRead } from '@/lib/api'
import { OrgTreeView } from '@/pages/employees/orgTree/OrgTreeView'
import { OrgDepartmentsTab } from './OrgDepartmentsTab'
import { PermissionsPage } from '../PermissionsPage'

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
  // A second supervisor-less root: drawn as an orphan chip, not a card.
  person('G3', 'Lina Orphan', null),
  person('G4', 'Ziad Report', 'G3'),
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
  vi.spyOn(api.departments, 'candidateUsers').mockResolvedValue([])
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

describe('Orphan roots in the editor', () => {
  it('gives orphan chips department actions', async () => {
    capabilityState.allowed = new Set(['employees.view', 'departments.manage'])
    renderWithClient(<OrgDepartmentsTab />)

    await userEvent.click(await screen.findByRole('button', { name: 'Department actions for Lina Orphan' }))
    expect(await screen.findByRole('menuitem', { name: 'Make department head…' })).toBeVisible()
  })

  it('shows people under an orphan root in the tree from the side list', async () => {
    capabilityState.allowed = new Set(['employees.view', 'departments.manage'])
    vi.mocked(api.departments.unassignedEmployees).mockResolvedValue([{
      top_employee_id: 'G3', top_name_en: 'Lina Orphan', top_name_ar: null, duty_unit: UNIT, count: 2, employee_ids: ['G3', 'G4'],
    }])
    renderWithClient(<OrgDepartmentsTab />)
    await screen.findByText('Mona Chief', { selector: 'article p' })
    expect(screen.queryByText('Ziad Report')).not.toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Show in tree' }))
    const card = (await screen.findByText('Ziad Report', { selector: 'article p' })).closest('article')!
    expect(within(card).getByRole('button', { name: 'Department actions for Ziad Report' })).toBeInTheDocument()
  })
})

describe('Deputies & viewers dialog', () => {
  it('keeps an existing deputy with an inactive account visible and removable, and offers only active candidates', async () => {
    capabilityState.allowed = new Set(['employees.view', 'departments.manage'])
    vi.mocked(api.departments.list).mockResolvedValue([{
      ...OPERATIONS, deputies: [{ user_id: 40, display_name: 'Gone Deputy', role: 'deputy' }],
    }])
    vi.mocked(api.departments.candidateUsers).mockResolvedValue([
      { user_id: 41, display_name: 'Active Aide', email: 'aide@gssg.ae', employee_id: null },
    ])
    const setPeople = vi.spyOn(api.departments, 'setPeople').mockResolvedValue(OPERATIONS)
    renderWithClient(<OrgDepartmentsTab />)

    const head = (await screen.findByText('Mona Chief', { selector: 'article p' })).closest('article')!
    await userEvent.click(within(head).getByRole('button', { name: 'Department actions for Mona Chief' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Deputies & department viewers…' }))

    const gone = await screen.findByRole('combobox', { name: 'Department role for Gone Deputy' })
    expect(gone).toHaveValue('deputy')
    const aide = await screen.findByRole('combobox', { name: 'Department role for Active Aide' })
    expect(aide).toHaveValue('none')
    await userEvent.selectOptions(gone, 'none')
    await userEvent.selectOptions(aide, 'viewer')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(setPeople).toHaveBeenCalledWith(7, { deputy_user_ids: [], viewer_user_ids: [41] })
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
    renderWithClient(<PermissionsPage />)

    expect(await screen.findByText('Permissions studio')).toBeVisible()
    expect(screen.queryByRole('tab', { name: 'Organization & departments' })).not.toBeInTheDocument()
    expect(api.listOrgTree).not.toHaveBeenCalled()
  })

  it('shows both tabs once employees.view is held too', async () => {
    capabilityState.allowed = new Set(['users.manage', 'employees.view', 'departments.manage'])
    renderWithClient(<PermissionsPage />)

    expect(await screen.findByRole('tab', { name: 'Organization & departments' })).toHaveAttribute('aria-selected', 'true')
  })
})
